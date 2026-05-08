require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const { runSignalEngine } = require("./signalEngine");
const { getAuthURL, generateToken, fetchCandles, validateToken, loadToken } = require("./fyers");

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
// Per-resolution cache: Map<resolution, { candles, result, lastFetch }>
const resolutionCache = new Map();

let autoRefreshTimer = null;

const SYMBOL = process.env.SYMBOL || "NSE:NIFTY50-INDEX";
const RESOLUTION = parseInt(process.env.CANDLE_RESOLUTION || "3");
const CANDLES_TO_FETCH = parseInt(process.env.CANDLES_TO_FETCH || "10000");

// AUTO-REFRESH: every 65 seconds (1min 5sec).
// Enough for a 1m candle to fully close before fetching.
// We fetch ALL active resolutions so 1m and 3m clients both get live updates.
const REFRESH_MS = parseInt(process.env.SCHEDULE_INTERVAL_MS || "65000");

// Track which resolution each socket is viewing: Map<socketId, resolution>
const socketResolutions = new Map();

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
    resolution: Number(resolution),  // always numeric so frontend filter works
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
  const candles = await fetchCandles(symbol, resolution, CANDLES_TO_FETCH);
  const result = runSignalEngine(candles);
  const cache = getCache(resolution);
  cache.candles = candles;
  cache.result = result;
  cache.lastFetch = Date.now();
  return { candles, result };
}

// Fetch for a given resolution and broadcast ONLY to clients watching that resolution.
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
  res.json({ status: "ok", time: new Date().toISOString() });
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
    res.json({ success: true, message: "Token saved successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chart — serve from cache when fresh, otherwise fetch
app.get("/api/chart", async (req, res) => {
  const symbol = req.query.symbol || SYMBOL;
  const resolution = parseInt(req.query.resolution || RESOLUTION);
  const cache = getCache(resolution);

  if (
    cache.result &&
    cache.candles.length > 0 &&
    Date.now() - cache.lastFetch < 60000
  ) {
    return res.json(buildPayload(cache.candles, cache.result, symbol, resolution));
  }

  try {
    const { candles, result } = await fetchAndProcess(symbol, resolution);
    res.json(buildPayload(candles, result, symbol, resolution));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chart/refresh — user-triggered; isAutoRefresh=false → frontend resets view
app.post("/api/chart/refresh", async (req, res) => {
  const symbol = req.query.symbol || SYMBOL;
  const resolution = parseInt(req.query.resolution || RESOLUTION);
  try {
    const { candles, result } = await fetchAndProcess(symbol, resolution);
    const payload = { ...buildPayload(candles, result, symbol, resolution, false), success: true };

    // Also push to room so any other sockets on this resolution update too
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

// ─── Auto-refresh ─────────────────────────────────────────────────────────────
// Runs every REFRESH_MS. Fetches all resolutions with active subscribers so
// BOTH 1m and 3m clients receive live candle updates without a manual refresh.
function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);

  autoRefreshTimer = setInterval(async () => {
    const valid = await validateToken();
    if (!valid) return;

    // Collect unique resolutions currently being watched by any socket
    const activeResolutions = new Set(socketResolutions.values());
    // Always keep default resolution warm even with no connections
    activeResolutions.add(RESOLUTION);

    for (const res of activeResolutions) {
      console.log(`[AUTO] Refreshing ${SYMBOL} res=${res}m...`);
      fetchAndBroadcast(SYMBOL, res, true).catch((e) =>
        console.error(`[AUTO] Error res=${res}:`, e.message)
      );
    }
  }, REFRESH_MS);

  console.log(`[AUTO] Refresh every ${REFRESH_MS / 1000}s — tracking all active resolutions`);
}

// ─── Socket.IO connections ────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  // Default to backend default resolution until client tells us otherwise
  let currentResolution = RESOLUTION;
  socketResolutions.set(socket.id, currentResolution);
  socket.join(`res:${currentResolution}`);

  // Push cached data immediately for the default resolution
  const initialCache = getCache(currentResolution);
  if (initialCache.result && initialCache.candles.length > 0) {
    socket.emit("chart_update", buildPayload(
      initialCache.candles, initialCache.result, SYMBOL, currentResolution, true
    ));
  }

  // ── set_resolution: client switched timeframe ──────────────────────────────
  // Called whenever the user clicks a TF button. We move the socket to the
  // correct room so it only receives auto-refresh broadcasts for that resolution.
  socket.on("set_resolution", (res) => {
    const newRes = parseInt(res);
    if (isNaN(newRes)) return;
    if (newRes === currentResolution) return;

    socket.leave(`res:${currentResolution}`);
    currentResolution = newRes;
    socketResolutions.set(socket.id, newRes);
    socket.join(`res:${newRes}`);

    console.log(`[WS] ${socket.id} → res=${newRes}`);

    // Immediately send cached data for the new resolution if available and fresh
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
server.listen(PORT, () => {
  console.log(`\n✅ TGG Backend running on http://localhost:${PORT}`);
  console.log(`   Health : http://localhost:${PORT}/health`);
  console.log(`   Chart  : http://localhost:${PORT}/api/chart`);
  console.log(`   Auth   : http://localhost:${PORT}/api/auth/status\n`);
  startAutoRefresh();
});

module.exports = { app, server };