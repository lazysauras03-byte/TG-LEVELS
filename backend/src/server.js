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
let cachedCandles = [];
let cachedResult = null;
let lastFetch = 0;
let autoRefreshTimer = null;

const SYMBOL = process.env.SYMBOL || "NSE:NIFTY50-INDEX";
const RESOLUTION = parseInt(process.env.CANDLE_RESOLUTION || "3");
// 1m candles for 1 month ≈ 8580, 3m ≈ 2860, set high so all timeframes get full month
const CANDLES_TO_FETCH = parseInt(process.env.CANDLES_TO_FETCH || "10000");
// FIXED: 70 seconds — 1 minute 10 seconds.
// This gives the 1-min candle time to fully close before we fetch it,
// while staying close enough to real-time for all timeframes.
const REFRESH_MS = parseInt(process.env.SCHEDULE_INTERVAL_MS || "70000");

// ─── Core fetch & process ─────────────────────────────────────────────────────
async function fetchAndProcess(symbol = SYMBOL, resolution = RESOLUTION) {
  const candles = await fetchCandles(symbol, resolution, CANDLES_TO_FETCH);
  const result = runSignalEngine(candles);
  cachedCandles = candles;
  cachedResult = result;
  lastFetch = Date.now();

  // IMPORTANT: Always include the resolution in the payload so the frontend
  // can filter out updates that don't match the currently selected timeframe.
  // isAutoRefresh=true so frontend knows to preserve scroll position.
  io.emit("chart_update", buildPayload(candles, result, symbol, resolution, true));
  return { candles, result };
}

function buildPayload(candles, result, symbol, resolution, isAutoRefresh = false) {
  return {
    symbol,
    resolution,           // ← always present so frontend can filter by timeframe
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

// Get chart data
app.get("/api/chart", async (req, res) => {
  const symbol = req.query.symbol || SYMBOL;
  const resolution = parseInt(req.query.resolution || RESOLUTION);

  if (
    cachedResult &&
    cachedCandles.length > 0 &&
    Date.now() - lastFetch < 60000 &&
    symbol === SYMBOL &&
    resolution === RESOLUTION
  ) {
    return res.json(buildPayload(cachedCandles, cachedResult, symbol, resolution));
  }

  try {
    const { candles, result } = await fetchAndProcess(symbol, resolution);
    res.json(buildPayload(candles, result, symbol, resolution));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Force refresh (user action — isAutoRefresh=false → frontend will reset chart position)
app.post("/api/chart/refresh", async (req, res) => {
  const symbol = req.query.symbol || SYMBOL;
  const resolution = parseInt(req.query.resolution || RESOLUTION);
  try {
    const { candles, result } = await fetchAndProcess(symbol, resolution);
    // Mark as user-triggered: frontend will call resetView()
    const payload = { ...buildPayload(candles, result, symbol, resolution, false), success: true };
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/signals", async (req, res) => {
  if (!cachedResult) {
    return res.status(404).json({ error: "No data yet. Call /api/chart first." });
  }
  res.json({
    signals: cachedResult.signals,
    currentState: cachedResult.currentState,
    lastUpdate: new Date(lastFetch).toISOString(),
  });
});

// ─── Auto-refresh ─────────────────────────────────────────────────────────────
function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(async () => {
    const valid = await validateToken();
    if (valid) {
      console.log(`[AUTO] Refreshing chart data (${SYMBOL}, ${RESOLUTION}m)...`);
      fetchAndProcess().catch((e) => console.error("[AUTO] Error:", e.message));
    }
  }, REFRESH_MS);
  console.log(`[AUTO] Refresh every ${REFRESH_MS / 1000}s (${(REFRESH_MS / 60000).toFixed(1)}min)`);
}

// ─── Socket.IO connections ────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  if (cachedResult && cachedCandles.length > 0) {
    socket.emit("chart_update", buildPayload(cachedCandles, cachedResult, SYMBOL, RESOLUTION));
  }

  socket.on("request_refresh", async () => {
    const valid = await validateToken();
    if (!valid) {
      socket.emit("error", { message: "Not authenticated. Please set up Fyers token." });
      return;
    }
    fetchAndProcess()
      .then(({ candles, result }) => {
        socket.emit("chart_update", buildPayload(candles, result, SYMBOL, RESOLUTION));
      })
      .catch((e) => socket.emit("error", { message: e.message }));
  });

  socket.on("disconnect", () => {
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