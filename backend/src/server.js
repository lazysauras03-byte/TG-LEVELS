require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const { runSignalEngine } = require("./signalEngine");
const { getAuthURL, generateToken, fetchCandles, validateToken, loadToken } = require("./fyers");
const { CandleBuilder, deriveTimeframe } = require("./candleBuilder");
const { TickStream, isMarketOpen } = require("./tickStream");
const symbolsRouter = require("./symbolsRouter");

const app = express();
const server = http.createServer(app);

// ─── Socket.IO ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ─── State ────────────────────────────────────────────────────────────────────
const resolutionCache = new Map();
let autoRefreshTimer = null;

const SYMBOL = process.env.SYMBOL || "NSE:NIFTY50-INDEX";
const RESOLUTION = parseInt(process.env.CANDLE_RESOLUTION || "3");
const CANDLES_TO_FETCH = parseInt(process.env.CANDLES_TO_FETCH || "10000");
const REFRESH_MS = parseInt(process.env.SCHEDULE_INTERVAL_MS || "65000");

const socketResolutions = new Map();

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
  const builder = getOrCreateBuilder(tick.symbol);
  builder.processTick(tick);
});
tickStream.on("connected", () => {
  console.log("[TickStream] Fyers WebSocket connected ✓");
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
  if (!isMarketOpen()) { console.log("[TickStream] Market closed — tick stream not starting."); return; }
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

  if (cache.result && cache.candles.length > 0 && Date.now() - cache.lastFetch < 60000) {
    return res.json(buildPayload(cache.candles, cache.result, symbol, resolution));
  }

  try {
    const { candles, result } = await fetchAndProcess(symbol, resolution);
    res.json(buildPayload(candles, result, symbol, resolution));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/chart/refresh", async (req, res) => {
  const symbol = req.query.symbol || SYMBOL;
  const resolution = parseInt(req.query.resolution || RESOLUTION);
  try {
    const { candles, result } = await fetchAndProcess(symbol, resolution);
    const payload = { ...buildPayload(candles, result, symbol, resolution, false), success: true };
    const room = `res:${resolution}`;
    io.to(room).emit("chart_update", { ...payload, isAutoRefresh: true });
    res.json(payload);
  } catch (err) {
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

// ─── Auto-refresh fallback ────────────────────────────────────────────────────
function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);

  autoRefreshTimer = setInterval(async () => {
    // Skip if tick stream is live — it keeps the candle builder current
    if (tickStream.isConnected() && isMarketOpen()) return;

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

  console.log(`[AUTO] Refresh every ${REFRESH_MS / 1000}s (fallback when tick stream inactive)`);
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
  await maybeStartTickStream();
});

module.exports = { app, server };