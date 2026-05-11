require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const { runSignalEngine } = require("./signalEngine");
const { getAuthURL, generateToken, fetchCandles, validateToken, loadToken } = require("./fyers");
const { CandleBuilder, deriveTimeframe } = require("./candleBuilder");
const { TickStream, isMarketOpen, isLiveMarket, isTradingDay } = require("./tickStream");
const symbolsRouter = require("./symbolsRouter");

const app = express();
const server = http.createServer(app);

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

// ─── Config ───────────────────────────────────────────────────────────────────
const SYMBOL = process.env.SYMBOL || "NSE:NIFTY50-INDEX";
const RESOLUTION = parseInt(process.env.CANDLE_RESOLUTION || "3");
const CANDLES_TO_FETCH = parseInt(process.env.CANDLES_TO_FETCH || "10000");
const REFRESH_MS = parseInt(process.env.SCHEDULE_INTERVAL_MS || "5000");
const TICK_WATCHDOG_MS = parseInt(process.env.TICK_WATCHDOG_MS || "10000");
const WATCHDOG_GRACE_MS = parseInt(process.env.WATCHDOG_GRACE_MS || "30000");

// ─── State ────────────────────────────────────────────────────────────────────
// symbolCacheMap: "SYMBOL:resolution" → { candles, result, lastFetch }
const symbolCacheMap = new Map();
let autoRefreshTimer = null;
const socketResolutions = new Map();
let lastTickAt = 0;
let lastConnectAt = 0;

// ─── Cache helpers ────────────────────────────────────────────────────────────
function cacheKey(symbol, resolution) {
  return `${symbol}:${resolution}`;
}

function getCache(symbol, resolution) {
  const k = cacheKey(symbol, resolution);
  if (!symbolCacheMap.has(k)) {
    symbolCacheMap.set(k, { candles: [], result: null, lastFetch: 0 });
  }
  return symbolCacheMap.get(k);
}

function setCache(symbol, resolution, candles, result) {
  symbolCacheMap.set(cacheKey(symbol, resolution), {
    candles,
    result,
    lastFetch: Date.now(),
  });
}

// ─── Candle Builder ───────────────────────────────────────────────────────────
const candleBuilders = new Map();

function getOrCreateBuilder(symbol) {
  if (!candleBuilders.has(symbol)) {
    const builder = new CandleBuilder({
      onTick: (formingCandles) => {
        emitCandleUpdate(symbol, formingCandles);
      },
      onFinalize: (finalizedCandle, formingCandles) => {
        console.log(
          `[Builder:${symbol}] Candle finalized @ ${new Date(finalizedCandle.time).toISOString()} close=${finalizedCandle.close}`
        );
        emitCandleUpdate(symbol, formingCandles);
        emitFinalCandle(symbol, finalizedCandle);

        // Update cache for all resolutions immediately (silent — no emit).
        // We already emitted tick_update/candle_update above for the forming
        // state; sending chart_update on top of that within the same event loop
        // turn causes the frontend to do a redundant full setData() which
        // flashes the chart and can cause viewport jumps.
        // Instead we schedule a single chart_update 200ms later — by then the
        // tick_update has been processed and the chart is stable. Only rooms
        // that are actually occupied get the broadcast.
        setImmediate(() => {
          const b = candleBuilders.get(symbol);
          if (!b) return;
          for (const res of [1, 3, 5, 15, 60, 1440]) {
            const candles = b.getCandlesForResolution(res);
            if (candles.length === 0) continue;
            try {
              const result = runSignalEngine(candles);
              setCache(symbol, res, candles, result);
            } catch (err) {
              console.error(`[Builder:${symbol}] Signal engine error res=${res}:`, err.message);
            }
          }
        });
        // Deferred broadcast: send chart_update once per candle finalize,
        // but only after the incremental tick_update has settled on the client.
        setTimeout(() => {
          const b = candleBuilders.get(symbol);
          if (!b) return;
          for (const res of [1, 3, 5, 15, 60, 1440]) {
            const room = `res:${res}`;
            if (!io.sockets.adapter.rooms.get(room)?.size) continue;
            const cache = getCache(symbol, res);
            if (!cache.result || !cache.candles.length) continue;
            io.to(room).emit("chart_update", buildPayload(cache.candles, cache.result, symbol, res, true));
          }
        }, 250);
      },
    });
    candleBuilders.set(symbol, builder);
  }
  return candleBuilders.get(symbol);
}

function emitCandleUpdate(symbol, formingCandles) {
  for (const [res, candle] of Object.entries(formingCandles)) {
    const numRes = Number(res);
    const room = `res:${numRes}`;
    if (!io.sockets.adapter.rooms.get(room)?.size) continue;
    if (!candle) continue;
    const payload = { symbol, resolution: numRes, formingCandle: candle, timestamp: Date.now() };
    io.to(room).emit("tick_update", payload);
    io.to(room).emit("candle_update", payload);
  }
}

function emitFinalCandle(symbol, finalizedCandle) {
  for (const res of [1, 3, 5, 15, 60, 1440]) {
    const room = `res:${res}`;
    if (!io.sockets.adapter.rooms.get(room)?.size) continue;
    io.to(room).emit("new_candle", {
      symbol,
      resolution: res,
      candle: finalizedCandle,
      timestamp: Date.now(),
    });
  }
}

// ─── Tick Stream ──────────────────────────────────────────────────────────────
const tickStream = new TickStream();

tickStream.on("tick", (tick) => {
  lastTickAt = Date.now();
  getOrCreateBuilder(tick.symbol).processTick(tick);
});
tickStream.on("connected", () => {
  console.log("[TickStream] Fyers WebSocket connected ✓");
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

/**
 * maybeStartTickStream
 * Only starts on Mon–Fri between 09:15–15:30 IST.
 * Safe to call any time — all guards are internal.
 */
async function maybeStartTickStream() {
  if (!isTradingDay()) {
    console.log("[TickStream] Weekend — tick stream not needed.");
    return;
  }
  if (!isLiveMarket()) {
    console.log("[TickStream] Outside 09:15–15:30 IST — tick stream not needed.");
    return;
  }
  if (tickStream.isConnected()) return;

  const valid = await validateToken().catch(() => false);
  if (!valid) {
    console.log("[TickStream] Not authenticated — skipping tick stream.");
    return;
  }
  tickStream.start([SYMBOL]);
}

// ─── Payload builder ──────────────────────────────────────────────────────────
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
/**
 * fetchAndProcess
 * Always uses Fyers REST — works 24/7 including weekends and after-hours.
 * Fyers history endpoint returns the last available trading session data
 * regardless of when you call it.
 */
async function fetchAndProcess(symbol = SYMBOL, resolution = RESOLUTION) {
  const raw1m = await fetchCandles(symbol, 1, CANDLES_TO_FETCH);

  // Reset builder if instrument changed drastically (price scale mismatch)
  if (candleBuilders.has(symbol)) {
    const existing = candleBuilders.get(symbol).getOneMinHistory();
    if (existing.length > 0 && raw1m.length > 0) {
      const ratio =
        existing[0].close > 0
          ? Math.abs(raw1m[0].close - existing[0].close) / existing[0].close
          : 1;
      if (ratio > 0.5) {
        console.log(`[Server] Price scale mismatch for ${symbol} — resetting builder`);
        candleBuilders.delete(symbol);
      }
    }
  }

  const builder = getOrCreateBuilder(symbol);
  builder.seedHistory(raw1m);

  let candles;
  if (resolution === 1) {
    candles = raw1m;
  } else {
    candles = deriveTimeframe(raw1m, resolution);
    if (candles.length === 0) {
      candles = await fetchCandles(symbol, resolution, CANDLES_TO_FETCH);
    }
  }

  const result = runSignalEngine(candles);
  setCache(symbol, resolution, candles, result);

  if (resolution !== 1) {
    try {
      setCache(symbol, 1, raw1m, runSignalEngine(raw1m));
    } catch { }
  }

  return { candles, result };
}

async function fetchAndBroadcast(symbol, resolution, isAutoRefresh = true) {
  const { candles, result } = await fetchAndProcess(symbol, resolution);
  const payload = buildPayload(candles, result, symbol, resolution, isAutoRefresh);
  io.to(`res:${resolution}`).emit("chart_update", payload);
  console.log(`[BROADCAST] res=${resolution}m → ${candles.length} candles → room "res:${resolution}"`);
  return { candles, result };
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    time: new Date().toISOString(),
    tickStreamActive: tickStream.isConnected(),
    liveMarket: isLiveMarket(),
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

/**
 * GET /api/chart?symbol=X&resolution=Y
 * Works any time, any day, any symbol (including Excel imports).
 *
 * Cache TTL:
 *   Live market (Mon–Fri 9:15–15:30):  60 seconds  (tick stream keeps it fresher)
 *   Weekday outside hours:             5 minutes   (data is settled)
 *   Weekend / holiday:                 24 hours    (data will not change)
 */
app.get("/api/chart", async (req, res) => {
  const symbol = req.query.symbol || SYMBOL;
  const resolution = parseInt(req.query.resolution || RESOLUTION);
  const cache = getCache(symbol, resolution);

  const cacheTTL = isLiveMarket()
    ? 60_000
    : isTradingDay()
      ? 5 * 60_000
      : 24 * 60 * 60_000;

  if (cache.result && cache.candles.length > 0 && Date.now() - cache.lastFetch < cacheTTL) {
    return res.json(buildPayload(cache.candles, cache.result, symbol, resolution));
  }

  try {
    const { candles, result } = await fetchAndProcess(symbol, resolution);
    res.json(buildPayload(candles, result, symbol, resolution));
  } catch (err) {
    // Serve stale cache rather than a blank error
    if (cache.result && cache.candles.length > 0) {
      console.warn(`[/api/chart] Fetch failed (${err.message}), serving stale cache`);
      return res.json(buildPayload(cache.candles, cache.result, symbol, resolution));
    }
    console.error("[/api/chart] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/chart/refresh?symbol=X&resolution=Y
 * Manual refresh — always fetches fresh from Fyers REST.
 * Works on weekends, after hours, for any symbol from Excel.
 * Broadcasts fresh data to all connected socket clients.
 */
app.post("/api/chart/refresh", async (req, res) => {
  const symbol = req.query.symbol || SYMBOL;
  const resolution = parseInt(req.query.resolution || RESOLUTION);

  console.log(
    `[REFRESH] symbol=${symbol} res=${resolution}m liveMarket=${isLiveMarket()} tradingDay=${isTradingDay()}`
  );

  try {
    const { candles, result } = await fetchAndProcess(symbol, resolution);
    const payload = { ...buildPayload(candles, result, symbol, resolution, false), success: true };
    io.to(`res:${resolution}`).emit("chart_update", { ...payload, isAutoRefresh: true });
    res.json(payload);
  } catch (err) {
    const cache = getCache(symbol, resolution);
    if (cache.result && cache.candles.length > 0) {
      console.warn(`[REFRESH] Fetch failed (${err.message}), serving stale cache`);
      return res.json({
        ...buildPayload(cache.candles, cache.result, symbol, resolution, false),
        success: true,
      });
    }
    console.error("[REFRESH] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/signals", async (req, res) => {
  const resolution = parseInt(req.query.resolution || RESOLUTION);
  const cache = getCache(SYMBOL, resolution);
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
// Only fires during live market hours. Restarts WS if silent for TICK_WATCHDOG_MS.
function startTickWatchdog() {
  setInterval(() => {
    if (!isTradingDay()) return;   // weekend — never fire
    if (!isLiveMarket()) return;   // outside 9:15–15:30 — never fire
    if (!tickStream.isConnected()) return;

    const now = Date.now();
    // Grace period after connect — don't watchdog during initial subscription
    if (lastConnectAt > 0 && now - lastConnectAt < WATCHDOG_GRACE_MS) return;
    if (lastTickAt === 0) return;  // haven't seen a tick yet — wait

    const silenceMs = now - lastTickAt;
    if (silenceMs > TICK_WATCHDOG_MS) {
      console.warn(`[Watchdog] No tick for ${(silenceMs / 1000).toFixed(1)}s — reconnecting WebSocket`);
      lastTickAt = 0;
      lastConnectAt = 0;
      tickStream.stop();
      setTimeout(() => maybeStartTickStream(), 1000);
    }
  }, TICK_WATCHDOG_MS);

  console.log(
    `[Watchdog] Started (timeout: ${TICK_WATCHDOG_MS / 1000}s, grace: ${WATCHDOG_GRACE_MS / 1000}s)`
  );
}

// ─── Auto-refresh fallback ────────────────────────────────────────────────────
// REST fallback poll — only runs when tick stream is DOWN during live market hours.
// On weekends / after-hours: does nothing (data is static, no point polling).
function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);

  autoRefreshTimer = setInterval(async () => {
    if (!isTradingDay()) return;      // weekend — skip
    if (!isLiveMarket()) return;      // outside 9:15–15:30 — skip
    if (tickStream.isConnected()) return; // tick stream live — skip

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

  console.log(`[AUTO] Refresh every ${REFRESH_MS / 1000}s (live market + tick stream down only)`);
}

// ─── Initial REST fetch ───────────────────────────────────────────────────────
// Runs at startup. Fetches historical candles via REST so the chart is populated
// immediately — works 24/7 including weekends. Fyers REST returns the last
// available trading session candles regardless of the current day/time.
async function initialRestFetch() {
  const valid = await validateToken().catch(() => false);
  if (!valid) {
    console.log("[INIT] Not authenticated — skipping initial REST fetch. Chart will be empty.");
    return;
  }

  const dayLabel = isTradingDay()
    ? isLiveMarket()
      ? "live market"
      : "weekday (market closed)"
    : "weekend/holiday";

  console.log(`[INIT] Fetching historical candles via REST (${dayLabel}) for ${SYMBOL}...`);

  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await fetchAndBroadcast(SYMBOL, RESOLUTION, false);
      console.log("[INIT] Historical data loaded ✓  Chart is ready.");
      return;
    } catch (err) {
      console.error(`[INIT] Attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        const wait = 3000 * attempt;
        console.log(`[INIT] Waiting ${wait / 1000}s before retry...`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  console.error("[INIT] All attempts failed — chart will be empty until manual Refresh.");
}

// ─── Socket.IO connections ────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  let currentResolution = RESOLUTION;
  socketResolutions.set(socket.id, currentResolution);
  socket.join(`res:${currentResolution}`);

  // Send cached data immediately — chart appears without a round-trip
  const initialCache = getCache(SYMBOL, currentResolution);
  if (initialCache.result && initialCache.candles.length > 0) {
    socket.emit(
      "chart_update",
      buildPayload(initialCache.candles, initialCache.result, SYMBOL, currentResolution, true)
    );
  }

  socket.emit("market_status", {
    tickStreamActive: tickStream.isConnected(),
    liveMarket: isLiveMarket(),
    tradingDay: isTradingDay(),
  });

  socket.on("set_resolution", (res) => {
    const newRes = parseInt(res);
    if (isNaN(newRes) || newRes === currentResolution) return;

    socket.leave(`res:${currentResolution}`);
    currentResolution = newRes;
    socketResolutions.set(socket.id, newRes);
    socket.join(`res:${newRes}`);
    console.log(`[WS] ${socket.id} → res=${newRes}`);

    const newCache = getCache(SYMBOL, newRes);
    if (newCache.result && newCache.candles.length > 0 && Date.now() - newCache.lastFetch < 120_000) {
      socket.emit(
        "chart_update",
        buildPayload(newCache.candles, newCache.result, SYMBOL, newRes, true)
      );
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

  // Step 1: Always seed chart from Fyers REST (works 24/7, any symbol, any day)
  await initialRestFetch();

  // Step 2: Start tick stream only if the market is currently live
  if (isLiveMarket()) {
    console.log("[INIT] Market is live — starting tick stream for real-time candles.");
    await maybeStartTickStream();
  } else if (isTradingDay()) {
    console.log("[INIT] Weekday outside market hours — REST data ready. Tick stream inactive.");
  } else {
    console.log("[INIT] Weekend/holiday — REST data loaded from last session. No tick stream.");
  }
});

module.exports = { app, server };