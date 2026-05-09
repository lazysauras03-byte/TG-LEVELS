require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const { runSignalEngine } = require("./signalEngine");
const { getAuthURL, generateToken, fetchCandles, validateToken, loadToken } = require("./fyers");
const { CandleBuilder, deriveTimeframe } = require("./candleBuilder");
const { TickStream, isMarketOpen, isTradingDay } = require("./tickStream");
const symbolsRouter = require("./symbolsRouter");

const app = express();
const server = http.createServer(app);

// Trust the first proxy hop (needed when running behind a reverse proxy or
// any middleware that sets X-Forwarded-For, including some local setups).
// This silences the express-rate-limit ERR_ERL_UNEXPECTED_X_FORWARDED_FOR error.
app.set("trust proxy", 1);

// ─── Socket.IO ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] }));
app.use(express.json());
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    // Skip rate limiting for localhost and private LAN IPs
    skip: (req) => {
      const ip = req.ip || "";
      return (
        ip === "127.0.0.1" ||
        ip === "::1" ||
        ip.startsWith("::ffff:127.") ||
        ip.startsWith("::ffff:192.168.") ||
        ip.startsWith("192.168.") ||
        ip.startsWith("10.") ||
        ip.startsWith("172.")
      );
    },
  })
);

// ─── State ────────────────────────────────────────────────────────────────────
const resolutionCache = new Map();
let autoRefreshTimer = null;

const SYMBOL = process.env.SYMBOL || "NSE:NIFTY50-INDEX";
const RESOLUTION = parseInt(process.env.CANDLE_RESOLUTION || "3");
const CANDLES_TO_FETCH = parseInt(process.env.CANDLES_TO_FETCH || "10000");
// Fallback REST poll used ONLY when WebSocket is down (market open but no ticks).
// Kept tight (5s) so candle appears within 5s of a minute close if WS fails.
// When WS is live, this interval is skipped entirely — no extra API calls.
const REFRESH_MS = parseInt(process.env.SCHEDULE_INTERVAL_MS || "5000");
// Watchdog: restart WebSocket if no tick arrives for this many ms during market hours
const TICK_WATCHDOG_MS = parseInt(process.env.TICK_WATCHDOG_MS || "10000");
// Grace period after a fresh WebSocket connect before watchdog starts firing.
// Fyers can take a few seconds to start sending ticks after subscription.
const WATCHDOG_GRACE_MS = parseInt(process.env.WATCHDOG_GRACE_MS || "30000");

const socketResolutions = new Map();
let lastTickAt = 0;      // epoch ms of the most recent tick received
let lastConnectAt = 0;   // epoch ms of the most recent WebSocket connect

// ─── Candle Builder ───────────────────────────────────────────────────────────
const candleBuilders = new Map();

function getOrCreateBuilder(symbol) {
  if (!candleBuilders.has(symbol)) {
    const builder = new CandleBuilder({
      onTick: (formingCandles) => {
        // Emit candle_update immediately on every tick — no batching, no delay.
        emitCandleUpdate(symbol, formingCandles);
      },
      onFinalize: (finalizedCandle, formingCandles) => {
        console.log(`[Builder:${symbol}] Candle finalized @ ${new Date(finalizedCandle.time).toISOString()} close=${finalizedCandle.close}`);

        // 1. Immediately emit the new forming candle for all active rooms
        emitCandleUpdate(symbol, formingCandles);

        // 2. Emit the finalized candle as a new_candle event (lightweight)
        //    so the frontend can append it before the signal engine runs.
        emitFinalCandle(symbol, finalizedCandle);

        // 3. Defer the heavy signal-engine work so it doesn't block ticks.
        setImmediate(() => {
          const b = candleBuilders.get(symbol);
          if (!b) return;
          for (const res of [1, 3, 5, 15, 60, 1440]) {
            const room = `res:${res}`;
            const roomSockets = io.sockets.adapter.rooms.get(room);
            if (!roomSockets || roomSockets.size === 0) continue;
            const candles = b.getCandlesForResolution(res);
            if (candles.length === 0) continue;
            try {
              const result = runSignalEngine(candles);
              io.to(room).emit("chart_update", buildPayload(candles, result, symbol, res, true));
            } catch (err) {
              console.error(`[Builder:${symbol}] Signal engine error res=${res}:`, err.message);
            }
          }
          updateCacheFromBuilder(symbol, RESOLUTION);
        });
      },
    });
    candleBuilders.set(symbol, builder);
  }
  return candleBuilders.get(symbol);
}

/**
 * emitCandleUpdate — sent on every tick with the currently-forming candle.
 * Frontend uses this to update the live candle visually tick-by-tick.
 */
function emitCandleUpdate(symbol, formingCandles) {
  for (const [res, candle] of Object.entries(formingCandles)) {
    const numRes = Number(res);
    const room = `res:${numRes}`;
    const roomSockets = io.sockets.adapter.rooms.get(room);
    if (!roomSockets || roomSockets.size === 0) continue;
    if (!candle) continue;
    const payload = {
      symbol,
      resolution: numRes,
      formingCandle: candle,
      timestamp: Date.now(),
    };
    // Emit to both event names: tick_update (legacy compat) and candle_update (new)
    io.to(room).emit("tick_update", payload);
    io.to(room).emit("candle_update", payload);
  }
}

/**
 * emitFinalCandle — sent once when a 1m candle completes.
 * Frontend appends this as a new completed candle.
 */
function emitFinalCandle(symbol, finalizedCandle) {
  for (const res of [1, 3, 5, 15, 60, 1440]) {
    const room = `res:${res}`;
    const roomSockets = io.sockets.adapter.rooms.get(room);
    if (!roomSockets || roomSockets.size === 0) continue;
    io.to(room).emit("new_candle", {
      symbol,
      resolution: res,
      candle: finalizedCandle,
      timestamp: Date.now(),
    });
  }
}

// Alias for backwards compat with any internal usages
const emitTickUpdate = emitCandleUpdate;

function updateCacheFromBuilder(symbol, resolution) {
  const builder = candleBuilders.get(symbol);
  if (!builder) return;
  try {
    const candles = builder.getCandlesForResolution(resolution);
    if (candles.length === 0) return;
    const result = runSignalEngine(candles);
    const cache = getCache(resolution);
    cache.candles = candles;
    cache.result = result;
    cache.lastFetch = Date.now();
  } catch { }
}

// ─── Tick Stream ──────────────────────────────────────────────────────────────
const tickStream = new TickStream();

tickStream.on("tick", (tick) => {
  lastTickAt = Date.now();
  const builder = getOrCreateBuilder(tick.symbol);
  builder.processTick(tick);
});
tickStream.on("connected", () => {
  console.log("[TickStream] Fyers WebSocket connected ✓");
  // Reset tick timer so watchdog doesn't immediately fire on reconnect.
  // lastTickAt=0 means "no tick yet this session" — watchdog won't fire
  // until we've received at least one real tick AND silence exceeds threshold.
  lastTickAt = 0;
  lastConnectAt = Date.now();
  io.emit("market_status", { tickStreamActive: true });
});
tickStream.on("disconnected", () => {
  console.log("[TickStream] Fyers WebSocket disconnected");
  io.emit("market_status", { tickStreamActive: false });
});
tickStream.on("error", (err) => {
  console.error("[TickStream] Error:", err?.message || err);
});

async function maybeStartTickStream() {
  const valid = await validateToken().catch(() => false);
  if (!valid) { console.log("[TickStream] Not authenticated — skipping tick stream."); return; }
  if (!isTradingDay()) { console.log("[TickStream] Weekend/holiday — tick stream not starting."); return; }
  if (!isMarketOpen()) { console.log("[TickStream] Market closed (outside hours) — tick stream not starting."); return; }
  if (tickStream.isConnected()) return;
  tickStream.start([SYMBOL]);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getCache(resolution) {
  if (!resolutionCache.has(resolution)) {
    resolutionCache.set(resolution, { candles: [], result: null, lastFetch: 0 });
  }
  return resolutionCache.get(resolution);
}

function buildPayload(candles, result, symbol, resolution, isAutoRefresh = false) {
  return {
    symbol,
    resolution: Number(resolution),
    candles,
    emaHighs: result.emaHighs,
    emaLows: result.emaLows,
    signals: result.signals,
    currentState: result.currentState,
    bestPrice: result.bestPrice,
    bestBar: result.bestBar,
    lastUpdate: new Date().toISOString(),
    balance: parseFloat(process.env.CURRENT_BALANCE || 0),
    isAutoRefresh,
  };
}

// ─── Core fetch & process ─────────────────────────────────────────────────────
async function fetchAndProcess(symbol = SYMBOL, resolution = RESOLUTION) {
  // Always fetch 1m candles from Fyers — derive higher TFs locally
  const raw1m = await fetchCandles(symbol, 1, CANDLES_TO_FETCH);

  // ── Symbol change: if the builder already exists for this symbol but its
  //    history belongs to a different price scale (e.g. switching from NIFTY
  //    ~24000 to GAIL ~200), we must replace it entirely so the chart
  //    auto-scales correctly.  We detect this by comparing the first candle's
  //    close price ratio vs the incoming data — if they differ by >50% we
  //    treat it as a "different instrument" and drop the old builder.
  if (candleBuilders.has(symbol)) {
    const existingBuilder = candleBuilders.get(symbol);
    const existingHistory = existingBuilder.getOneMinHistory();
    if (existingHistory.length > 0 && raw1m.length > 0) {
      const existingPrice = existingHistory[0].close;
      const newPrice = raw1m[0].close;
      const ratio = existingPrice > 0 ? Math.abs(newPrice - existingPrice) / existingPrice : 1;
      if (ratio > 0.5) {
        // Price scale mismatch — stale builder from a different instrument
        console.log(`[Server] Price scale mismatch for ${symbol} (${existingPrice} vs ${newPrice}) — resetting builder`);
        candleBuilders.delete(symbol);
      }
    }
  }

  // Seed the candle builder with this fresh 1m history
  const builder = getOrCreateBuilder(symbol);
  builder.seedHistory(raw1m);

  let candles;
  if (resolution === 1) {
    candles = raw1m;
  } else {
    candles = deriveTimeframe(raw1m, resolution);
    if (candles.length === 0 && resolution !== 1) {
      // Fallback: if derive failed (e.g., very short history), fetch directly
      candles = await fetchCandles(symbol, resolution, CANDLES_TO_FETCH);
    }
  }

  const result = runSignalEngine(candles);
  const cache = getCache(resolution);
  cache.candles = candles;
  cache.result = result;
  cache.lastFetch = Date.now();

  // Cache 1m data as well
  if (resolution !== 1) {
    const cache1m = getCache(1);
    if (raw1m.length > (cache1m.candles?.length || 0)) {
      try {
        const result1m = runSignalEngine(raw1m);
        cache1m.candles = raw1m;
        cache1m.result = result1m;
        cache1m.lastFetch = Date.now();
      } catch { }
    }
  }

  return { candles, result };
}

async function fetchAndBroadcast(symbol, resolution, isAutoRefresh = true) {
  const { candles, result } = await fetchAndProcess(symbol, resolution);
  const payload = buildPayload(candles, result, symbol, resolution, isAutoRefresh);
  const room = `res:${resolution}`;
  io.to(room).emit("chart_update", payload);
  console.log(`[BROADCAST] res=${resolution}m → ${candles.length} candles → room "${room}"`);
  return { candles, result };
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    time: new Date().toISOString(),
    tickStreamActive: tickStream.isConnected(),
    marketOpen: isMarketOpen(),
    tradingDay: isTradingDay(),
  });
});

app.get("/api/auth/status", async (req, res) => {
  try {
    const valid = await validateToken();
    res.json({ authenticated: valid, authUrl: valid ? null : getAuthURL() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/auth/url", (req, res) => {
  try {
    res.json({ url: getAuthURL() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/token", async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "auth_code required" });
  try {
    await generateToken(code);
    await maybeStartTickStream();
    res.json({ success: true, message: "Token saved successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/chart", async (req, res) => {
  const symbol = req.query.symbol || SYMBOL;
  const resolution = parseInt(req.query.resolution || RESOLUTION);
  const cache = getCache(resolution);

  // On non-trading days (weekends/holidays) serve the cache indefinitely —
  // there's no new data to fetch and Fyers may reject calls outside market days.
  // On trading days use a 60-second freshness window.
  const cacheTTL = isTradingDay() ? 60_000 : 24 * 60 * 60 * 1000;
  if (cache.result && cache.candles.length > 0 && Date.now() - cache.lastFetch < cacheTTL) {
    return res.json(buildPayload(cache.candles, cache.result, symbol, resolution));
  }

  try {
    const { candles, result } = await fetchAndProcess(symbol, resolution);
    res.json(buildPayload(candles, result, symbol, resolution));
  } catch (err) {
    // If we have stale cache, return it rather than a 500 error
    if (cache.result && cache.candles.length > 0) {
      console.warn(`[/api/chart] Fetch failed (${err.message}), serving stale cache`);
      return res.json(buildPayload(cache.candles, cache.result, symbol, resolution));
    }
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/chart/refresh", async (req, res) => {
  const symbol = req.query.symbol || SYMBOL;
  const resolution = parseInt(req.query.resolution || RESOLUTION);

  // On non-trading days, skip the Fyers API call entirely — return cached data.
  // Fyers historical API works on weekends, but there's no new data to show,
  // and hammering the API causes unnecessary failures and rate-limit errors.
  if (!isTradingDay()) {
    const cache = getCache(resolution);
    if (cache.result && cache.candles.length > 0) {
      console.log(`[/api/chart/refresh] Weekend — serving cached data (${cache.candles.length} candles)`);
      const payload = { ...buildPayload(cache.candles, cache.result, symbol, resolution, false), success: true };
      return res.json(payload);
    }
  }

  try {
    const { candles, result } = await fetchAndProcess(symbol, resolution);
    const payload = { ...buildPayload(candles, result, symbol, resolution, false), success: true };
    const room = `res:${resolution}`;
    io.to(room).emit("chart_update", { ...payload, isAutoRefresh: true });
    res.json(payload);
  } catch (err) {
    // Fallback to stale cache on any error
    const cache = getCache(resolution);
    if (cache.result && cache.candles.length > 0) {
      console.warn(`[/api/chart/refresh] Fetch failed (${err.message}), serving stale cache`);
      return res.json({ ...buildPayload(cache.candles, cache.result, symbol, resolution, false), success: true });
    }
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/signals", async (req, res) => {
  const resolution = parseInt(req.query.resolution || RESOLUTION);
  const cache = getCache(resolution);
  if (!cache.result) {
    return res.status(404).json({ error: "No data yet. Call /api/chart first." });
  }
  res.json({
    signals: cache.result.signals,
    currentState: cache.result.currentState,
    lastUpdate: new Date(cache.lastFetch).toISOString(),
  });
});

app.use("/api/symbols", symbolsRouter);

// ─── Tick Watchdog ────────────────────────────────────────────────────────────
// If WebSocket is "connected" but no tick arrives for TICK_WATCHDOG_MS during
// market hours, force a reconnect. This catches silent socket stalls (Fyers
// sometimes stops sending without firing a close event).
//
// Guards:
//   1. Only fires on actual trading days (Mon–Fri) — never on weekends
//   2. Only fires during market hours (09:15–15:30 IST)
//   3. lastTickAt=0 means "just connected, no tick yet" — give it grace period
//   4. Grace period (WATCHDOG_GRACE_MS) after each fresh connect before counting
function startTickWatchdog() {
  setInterval(() => {
    // Guard 1: Never run on weekends / holidays
    if (!isTradingDay()) return;
    // Guard 2: Only during live market hours
    if (!isMarketOpen()) return;
    // Guard 3: Only when stream appears connected
    if (!tickStream.isConnected()) return;

    const now = Date.now();

    // Guard 4: Give WATCHDOG_GRACE_MS after each fresh connect before firing.
    // This prevents the "just connected, ticks haven't started yet" false alarm.
    if (lastConnectAt > 0 && (now - lastConnectAt) < WATCHDOG_GRACE_MS) return;

    // Guard 5: lastTickAt=0 means we haven't received any tick yet this session.
    // Don't fire until at least one real tick has been seen.
    if (lastTickAt === 0) return;

    const silenceMs = now - lastTickAt;
    if (silenceMs > TICK_WATCHDOG_MS) {
      console.warn(`[Watchdog] No tick for ${(silenceMs / 1000).toFixed(1)}s — reconnecting WebSocket`);
      lastTickAt = 0;       // reset so watchdog won't re-fire immediately after reconnect
      lastConnectAt = 0;
      tickStream.stop();
      setTimeout(() => maybeStartTickStream(), 1000);
    }
  }, TICK_WATCHDOG_MS);
  console.log(`[Watchdog] Tick watchdog started (timeout: ${TICK_WATCHDOG_MS / 1000}s, grace: ${WATCHDOG_GRACE_MS / 1000}s)`);
}

// ─── Auto-refresh fallback ────────────────────────────────────────────────────
function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);

  autoRefreshTimer = setInterval(async () => {
    // Only poll during live market hours on actual trading days
    if (!isTradingDay()) return;
    if (!isMarketOpen()) return;

    // Skip if tick stream is live — it keeps the candle builder current
    if (tickStream.isConnected()) return;

    const valid = await validateToken();
    if (!valid) return;

    const activeResolutions = new Set(socketResolutions.values());
    activeResolutions.add(RESOLUTION);

    for (const res of activeResolutions) {
      console.log(`[AUTO] Refreshing ${SYMBOL} res=${res}m...`);
      fetchAndBroadcast(SYMBOL, res, true).catch((e) =>
        console.error(`[AUTO] Error res=${res}:`, e.message)
      );
    }
  }, REFRESH_MS);

  console.log(`[AUTO] Refresh every ${REFRESH_MS / 1000}s (fallback when tick stream inactive, market hours only)`);
}

/**
 * Fetch historical candles once on startup so the chart has data even when
 * the market is closed (weekends, holidays, after-hours).
 * This is a one-shot REST call — no polling, no WebSocket needed.
 */
async function initialRestFetch() {
  const valid = await validateToken().catch(() => false);
  if (!valid) {
    console.log("[INIT] Not authenticated — skipping initial REST fetch.");
    return;
  }
  console.log(`[INIT] Market closed or weekend — fetching historical candles via REST for ${SYMBOL}...`);
  try {
    await fetchAndBroadcast(SYMBOL, RESOLUTION, false);
    console.log("[INIT] Historical data loaded ✓ Chart is ready.");
  } catch (err) {
    console.error("[INIT] Initial REST fetch failed:", err.message);
  }
}

// ─── Socket.IO connections ────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  let currentResolution = RESOLUTION;
  socketResolutions.set(socket.id, currentResolution);
  socket.join(`res:${currentResolution}`);

  const initialCache = getCache(currentResolution);
  if (initialCache.result && initialCache.candles.length > 0) {
    socket.emit("chart_update", buildPayload(
      initialCache.candles, initialCache.result, SYMBOL, currentResolution, true
    ));
  }

  socket.emit("market_status", {
    tickStreamActive: tickStream.isConnected(),
    marketOpen: isMarketOpen(),
    tradingDay: isTradingDay(),
  });

  socket.on("set_resolution", (res) => {
    const newRes = parseInt(res);
    if (isNaN(newRes)) return;
    if (newRes === currentResolution) return;

    socket.leave(`res:${currentResolution}`);
    currentResolution = newRes;
    socketResolutions.set(socket.id, newRes);
    socket.join(`res:${newRes}`);

    console.log(`[WS] ${socket.id} → res=${newRes}`);

    const newCache = getCache(newRes);
    if (newCache.result && newCache.candles.length > 0 && Date.now() - newCache.lastFetch < 120000) {
      socket.emit("chart_update", buildPayload(
        newCache.candles, newCache.result, SYMBOL, newRes, true
      ));
    }
  });

  socket.on("request_refresh", async () => {
    const valid = await validateToken();
    if (!valid) {
      socket.emit("error", { message: "Not authenticated. Please set up Fyers token." });
      return;
    }
    fetchAndProcess(SYMBOL, currentResolution)
      .then(({ candles, result }) => {
        socket.emit("chart_update", buildPayload(candles, result, SYMBOL, currentResolution, false));
      })
      .catch((e) => socket.emit("error", { message: e.message }));
  });

  socket.on("disconnect", () => {
    socketResolutions.delete(socket.id);
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3299");
server.listen(PORT, async () => {
  console.log(`\n✅ TGG Backend running on http://localhost:${PORT}`);
  console.log(`   Health  : http://localhost:${PORT}/health`);
  console.log(`   Chart   : http://localhost:${PORT}/api/chart`);
  console.log(`   Auth    : http://localhost:${PORT}/api/auth/status`);
  console.log(`   Symbols : http://localhost:${PORT}/api/symbols\n`);
  startAutoRefresh();
  startTickWatchdog();
  if (isMarketOpen()) {
    // Live market — start WebSocket tick stream
    await maybeStartTickStream();
  } else {
    // Weekend / after-hours / holiday — load historical data via REST once
    await initialRestFetch();
  }
});

module.exports = { app, server };