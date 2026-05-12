require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const { runSignalEngine } = require("./signalEngine");
const { getAuthURL, generateToken, fetchCandles,
  validateToken, loadToken } = require("./fyers");
const { CandleBuilder, deriveTimeframe } = require("./candleBuilder");
const { TickStream, isLiveMarket, isTradingDay } = require("./tickStream");
const symbolsRouter = require("./symbolsRouter");

const app = express();
const server = http.createServer(app);

app.set("trust proxy", 1);

// ─── CORS — allow all origins (browser direct + LAN) ─────────────────────────
const CORS_OPTS = { origin: "*", methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] };

// ─── Socket.IO ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: CORS_OPTS,
  // Allow both websocket and polling transports
  transports: ["websocket", "polling"],
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors(CORS_OPTS));
app.use(express.json());
app.use(rateLimit({
  windowMs: 60_000, max: 300,
  standardHeaders: true, legacyHeaders: false,
  skip: req => {
    const ip = req.ip || "";
    return ip === "127.0.0.1" || ip === "::1" ||
      ip.startsWith("::ffff:127.") || ip.startsWith("::ffff:192.168.") ||
      ip.startsWith("192.168.") || ip.startsWith("10.") || ip.startsWith("172.");
  },
}));

// ─── Config ───────────────────────────────────────────────────────────────────
const SYMBOL = process.env.SYMBOL || "NSE:NIFTY50-INDEX";
const RESOLUTION = parseInt(process.env.CANDLE_RESOLUTION || "3");
const CANDLES_TO_FETCH = parseInt(process.env.CANDLES_TO_FETCH || "10000");
const REFRESH_MS = parseInt(process.env.SCHEDULE_INTERVAL_MS || "5000");
const TICK_WATCHDOG_MS = parseInt(process.env.TICK_WATCHDOG_MS || "10000");
const WATCHDOG_GRACE = parseInt(process.env.WATCHDOG_GRACE_MS || "30000");

// ─── State ────────────────────────────────────────────────────────────────────
const symbolCacheMap = new Map();   // "SYM:RES" → { candles, result, lastFetch }
const socketResolutions = new Map();   // socketId → resolution
let autoRefreshTimer = null;
let lastTickAt = 0;
let lastConnectAt = 0;
let initialFetchDone = false;       // flips true when initialRestFetch() finishes

// ─── Cache helpers ─────────────────────────────────────────────────────────────
const cacheKey = (sym, res) => `${sym}:${res}`;

function getCache(sym, res) {
  const k = cacheKey(sym, res);
  if (!symbolCacheMap.has(k)) symbolCacheMap.set(k, { candles: [], result: null, lastFetch: 0 });
  return symbolCacheMap.get(k);
}

function setCache(sym, res, candles, result) {
  symbolCacheMap.set(cacheKey(sym, res), { candles, result, lastFetch: Date.now() });
}

// ─── Payload builder ──────────────────────────────────────────────────────────
function buildPayload(candles, result, symbol, resolution, isAutoRefresh = false) {
  return {
    symbol, resolution: Number(resolution), candles,
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

// ─── Candle Builder ───────────────────────────────────────────────────────────
const candleBuilders = new Map();

function getOrCreateBuilder(symbol) {
  if (candleBuilders.has(symbol)) return candleBuilders.get(symbol);

  const builder = new CandleBuilder({
    onTick: (forming) => emitTickUpdate(symbol, forming),
    onFinalize: (finalCandle, forming) => {
      console.log(`[Builder:${symbol}] Finalized @ ${new Date(finalCandle.time).toISOString()} close=${finalCandle.close}`);
      emitTickUpdate(symbol, forming);
      emitNewCandle(symbol, finalCandle);

      // Update cache for all resolutions
      setImmediate(() => {
        const b = candleBuilders.get(symbol);
        if (!b) return;
        for (const res of [1, 3, 5, 15, 60, 1440]) {
          const candles = b.getCandlesForResolution(res);
          if (!candles.length) continue;
          try { setCache(symbol, res, candles, runSignalEngine(candles)); }
          catch (e) { console.error(`[Builder] signal error res=${res}:`, e.message); }
        }
      });

      // Broadcast updated chart to socket rooms
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
  return builder;
}

function emitTickUpdate(symbol, forming) {
  for (const [res, candle] of Object.entries(forming)) {
    const numRes = Number(res);
    const room = `res:${numRes}`;
    if (!io.sockets.adapter.rooms.get(room)?.size || !candle) continue;
    const payload = { symbol, resolution: numRes, formingCandle: candle, timestamp: Date.now() };
    io.to(room).emit("tick_update", payload);
    io.to(room).emit("candle_update", payload);
  }
}

function emitNewCandle(symbol, candle) {
  for (const res of [1, 3, 5, 15, 60, 1440]) {
    const room = `res:${res}`;
    if (!io.sockets.adapter.rooms.get(room)?.size) continue;
    io.to(room).emit("new_candle", { symbol, resolution: res, candle, timestamp: Date.now() });
  }
}

// ─── Tick Stream ──────────────────────────────────────────────────────────────
const tickStream = new TickStream();

tickStream.on("tick", tick => { lastTickAt = Date.now(); getOrCreateBuilder(tick.symbol).processTick(tick); });
tickStream.on("connected", () => { console.log("[TickStream] ✓"); lastTickAt = 0; lastConnectAt = Date.now(); io.emit("market_status", { tickStreamActive: true }); });
tickStream.on("disconnected", () => { console.log("[TickStream] ✗"); io.emit("market_status", { tickStreamActive: false }); });
tickStream.on("error", err => console.error("[TickStream]", err?.message || err));

async function maybeStartTickStream() {
  if (!isTradingDay() || !isLiveMarket() || tickStream.isConnected()) return;
  const ok = await validateToken().catch(() => false);
  if (!ok) { console.log("[TickStream] Not authenticated"); return; }
  tickStream.start([SYMBOL]);
}

// ─── Core data fetch ──────────────────────────────────────────────────────────
async function fetchAndProcess(symbol = SYMBOL, resolution = RESOLUTION) {
  const raw1m = await fetchCandles(symbol, 1, CANDLES_TO_FETCH);

  // Safety: reset builder if price scale looks wrong (symbol change)
  if (candleBuilders.has(symbol)) {
    const existing = candleBuilders.get(symbol).getOneMinHistory();
    if (existing.length && raw1m.length) {
      const ratio = existing[0].close > 0
        ? Math.abs(raw1m[0].close - existing[0].close) / existing[0].close : 1;
      if (ratio > 0.5) { console.log(`[Server] Price mismatch for ${symbol} — resetting`); candleBuilders.delete(symbol); }
    }
  }

  getOrCreateBuilder(symbol).seedHistory(raw1m);

  let candles = resolution === 1 ? raw1m : deriveTimeframe(raw1m, resolution);
  if (!candles.length) candles = await fetchCandles(symbol, resolution, CANDLES_TO_FETCH);

  const result = runSignalEngine(candles);
  setCache(symbol, resolution, candles, result);

  if (resolution !== 1) {
    try { setCache(symbol, 1, raw1m, runSignalEngine(raw1m)); } catch { }
  }

  return { candles, result };
}

async function fetchAndBroadcast(symbol, resolution, isAuto = true) {
  const { candles, result } = await fetchAndProcess(symbol, resolution);
  const payload = buildPayload(candles, result, symbol, resolution, isAuto);
  io.to(`res:${resolution}`).emit("chart_update", payload);
  console.log(`[BROADCAST] ${symbol} res=${resolution}m → ${candles.length} candles`);
  return { candles, result };
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({
  status: "ok", time: new Date().toISOString(),
  tickStreamActive: tickStream.isConnected(),
  liveMarket: isLiveMarket(), tradingDay: isTradingDay(),
  initialFetchDone,
}));

app.get("/api/auth/status", async (req, res) => {
  try { const ok = await validateToken(); res.json({ authenticated: ok, authUrl: ok ? null : getAuthURL() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/auth/url", (req, res) => {
  try { res.json({ url: getAuthURL() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/auth/token", async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "auth_code required" });
  try { await generateToken(code); await maybeStartTickStream(); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * GET /api/chart?symbol=X&resolution=Y
 *
 * NEVER blocks. Returns one of:
 *   { initializing: true }       — cache empty, backend warming up → frontend waits for socket push
 *   { candles: [...], ... }      — cached or freshly fetched data
 *   HTTP 500                     — only if cache empty AND fetch failed
 *
 * Stale-while-revalidate: if cache is stale, return it immediately and
 * trigger a background refresh (socket will push fresh data).
 */
app.get("/api/chart", async (req, res) => {
  const symbol = req.query.symbol || SYMBOL;
  const resolution = parseInt(req.query.resolution || RESOLUTION);
  const cache = getCache(symbol, resolution);

  // ── Cache hit: serve immediately ──────────────────────────────────────────
  if (cache.result && cache.candles.length) {
    const ttl = isLiveMarket() ? 60_000 : isTradingDay() ? 5 * 60_000 : 24 * 60 * 60_000;
    if (Date.now() - cache.lastFetch >= ttl && initialFetchDone) {
      // Stale — trigger background refresh; client gets update via socket
      fetchAndBroadcast(symbol, resolution, true).catch(e =>
        console.error("[/api/chart] bg refresh failed:", e.message)
      );
    }
    return res.json(buildPayload(cache.candles, cache.result, symbol, resolution));
  }

  // ── Cache miss + still initializing → tell frontend to wait for socket ────
  if (!initialFetchDone) {
    return res.json({ initializing: true, symbol, resolution: Number(resolution) });
  }

  // ── Cache miss + init done → fetch now (e.g. new symbol) ─────────────────
  try {
    const { candles, result } = await fetchAndProcess(symbol, resolution);
    res.json(buildPayload(candles, result, symbol, resolution));
  } catch (e) {
    const stale = getCache(symbol, resolution);
    if (stale.result && stale.candles.length) {
      console.warn("[/api/chart] fetch failed, serving stale cache:", e.message);
      return res.json(buildPayload(stale.candles, stale.result, symbol, resolution));
    }
    console.error("[/api/chart]", e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/chart/refresh?symbol=X&resolution=Y
 * Triggered by user pressing Refresh / changing symbol / changing timeframe.
 * Always fetches fresh data. Falls back to stale cache on error.
 */
app.post("/api/chart/refresh", async (req, res) => {
  const symbol = req.query.symbol || SYMBOL;
  const resolution = parseInt(req.query.resolution || RESOLUTION);
  console.log(`[REFRESH] ${symbol} res=${resolution}m`);

  try {
    const { candles, result } = await fetchAndProcess(symbol, resolution);
    const payload = { ...buildPayload(candles, result, symbol, resolution, false), success: true };
    io.to(`res:${resolution}`).emit("chart_update", { ...payload, isAutoRefresh: true });
    res.json(payload);
  } catch (e) {
    const cache = getCache(symbol, resolution);
    if (cache.result && cache.candles.length) {
      console.warn("[REFRESH] failed, serving cache:", e.message);
      return res.json({ ...buildPayload(cache.candles, cache.result, symbol, resolution, false), success: true });
    }
    console.error("[REFRESH]", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/signals", (req, res) => {
  const resolution = parseInt(req.query.resolution || RESOLUTION);
  const cache = getCache(SYMBOL, resolution);
  if (!cache.result) return res.status(404).json({ error: "No data yet" });
  res.json({ signals: cache.result.signals, currentState: cache.result.currentState, lastUpdate: new Date(cache.lastFetch).toISOString() });
});

app.use("/api/symbols", symbolsRouter);

// ─── Tick Watchdog ─────────────────────────────────────────────────────────────
function startTickWatchdog() {
  setInterval(() => {
    if (!isTradingDay() || !isLiveMarket() || !tickStream.isConnected()) return;
    const now = Date.now();
    if (lastConnectAt > 0 && now - lastConnectAt < WATCHDOG_GRACE) return;
    if (!lastTickAt) return;
    if (now - lastTickAt > TICK_WATCHDOG_MS) {
      console.warn(`[Watchdog] No tick for ${((now - lastTickAt) / 1000).toFixed(1)}s — reconnecting`);
      lastTickAt = 0; lastConnectAt = 0;
      tickStream.stop();
      setTimeout(maybeStartTickStream, 1000);
    }
  }, TICK_WATCHDOG_MS);
  console.log(`[Watchdog] Started (${TICK_WATCHDOG_MS / 1000}s timeout, ${WATCHDOG_GRACE / 1000}s grace)`);
}

// ─── Auto-refresh fallback ─────────────────────────────────────────────────────
function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(async () => {
    if (!isTradingDay() || !isLiveMarket() || tickStream.isConnected()) return;
    const ok = await validateToken();
    if (!ok) return;
    const resolutions = new Set([...socketResolutions.values(), RESOLUTION]);
    for (const res of resolutions) {
      fetchAndBroadcast(SYMBOL, res, true).catch(e => console.error(`[AUTO] res=${res}:`, e.message));
    }
  }, REFRESH_MS);
  console.log(`[AUTO] Refresh every ${REFRESH_MS / 1000}s`);
}

// ─── Initial REST fetch (runs in background, never blocks server start) ────────
async function initialRestFetch() {
  const ok = await validateToken().catch(() => false);
  if (!ok) { console.log("[INIT] Not authenticated — chart empty until Refresh."); return; }

  const label = isTradingDay() ? (isLiveMarket() ? "live market" : "market closed") : "weekend/holiday";
  console.log(`[INIT] Fetching candles (${label}) for ${SYMBOL}…`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await fetchAndBroadcast(SYMBOL, RESOLUTION, false);
      console.log("[INIT] ✓ Historical data ready.");
      return;
    } catch (e) {
      console.error(`[INIT] Attempt ${attempt}/3 failed: ${e.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  console.error("[INIT] All attempts failed — use Refresh button.");
}

// ─── Socket connections ────────────────────────────────────────────────────────
io.on("connection", socket => {
  console.log(`[WS] Connected: ${socket.id}`);

  let currentRes = RESOLUTION;
  socketResolutions.set(socket.id, currentRes);
  socket.join(`res:${currentRes}`);

  // Send cached data immediately if available
  const initCache = getCache(SYMBOL, currentRes);
  if (initCache.result && initCache.candles.length) {
    socket.emit("chart_update", buildPayload(initCache.candles, initCache.result, SYMBOL, currentRes, true));
  }

  socket.emit("market_status", {
    tickStreamActive: tickStream.isConnected(),
    liveMarket: isLiveMarket(),
    tradingDay: isTradingDay(),
  });

  socket.on("set_resolution", res => {
    const newRes = parseInt(res);
    if (isNaN(newRes) || newRes === currentRes) return;
    socket.leave(`res:${currentRes}`);
    currentRes = newRes;
    socketResolutions.set(socket.id, newRes);
    socket.join(`res:${newRes}`);
    console.log(`[WS] ${socket.id} → res=${newRes}`);

    const cache = getCache(SYMBOL, newRes);
    if (cache.result && cache.candles.length && Date.now() - cache.lastFetch < 120_000) {
      socket.emit("chart_update", buildPayload(cache.candles, cache.result, SYMBOL, newRes, true));
    }
  });

  socket.on("request_refresh", async () => {
    const ok = await validateToken();
    if (!ok) { socket.emit("error", { message: "Not authenticated." }); return; }
    fetchAndProcess(SYMBOL, currentRes)
      .then(({ candles, result }) => socket.emit("chart_update", buildPayload(candles, result, SYMBOL, currentRes, false)))
      .catch(e => socket.emit("error", { message: e.message }));
  });

  socket.on("disconnect", () => { socketResolutions.delete(socket.id); console.log(`[WS] Disconnected: ${socket.id}`); });
});

// ─── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3299");
server.listen(PORT, () => {
  console.log(`\n✅ TGG Backend → http://localhost:${PORT}`);
  console.log(`   Health  : http://localhost:${PORT}/health`);
  console.log(`   Chart   : http://localhost:${PORT}/api/chart`);
  console.log(`   Auth    : http://localhost:${PORT}/api/auth/status`);
  console.log(`   Symbols : http://localhost:${PORT}/api/symbols\n`);

  startAutoRefresh();
  startTickWatchdog();

  // Kick off initial data fetch in BACKGROUND — server is immediately ready.
  // GET /api/chart returns { initializing:true } until cache is warm.
  // When fetchAndBroadcast() resolves, all connected sockets get chart_update.
  initialRestFetch()
    .then(() => { initialFetchDone = true; })
    .catch(e => { console.error("[INIT] Fatal:", e.message); initialFetchDone = true; });

  // Start tick stream immediately if market is live (don't wait for init)
  if (isLiveMarket()) {
    console.log("[INIT] Market live — starting tick stream.");
    maybeStartTickStream().catch(() => { });
  } else {
    console.log(`[INIT] ${isTradingDay() ? "Market closed" : "Weekend"} — tick stream not started.`);
  }
});

module.exports = { app, server };