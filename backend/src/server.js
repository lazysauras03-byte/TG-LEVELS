require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const { runSignalEngine } = require("./services/signalEngine");
const { getAuthURL, generateToken, fetchCandles, validateToken, loadToken } = require("./fyers/client");
const { CandleBuilder, deriveTimeframe } = require("./services/candleBuilder");
const { TickStream, isMarketOpen, isLiveMarket, isAnyMarketLive, isMCXSymbol, isTradingDay } = require("./fyers/tickStream");
const symbolsRouter = require("./routes/symbolsRouter");
const scannerRouter = require("./routes/scannerRouter");
const { scanner } = require("./services/scannerRunner");
const backtestRouter = require("./routes/backtestRouter");
const { backtestRunner } = require("./services/backtestRunner");
const { detectMotherWaveForAPI } = require("./services/motherwave");
const createChartRouter = require("./routes/chartRouter");
const corsMiddleware = require("./middleware/cors");
const rateLimiter = require("./middleware/rateLimiter");

// ─── Database ─────────────────────────────────────────────────────────────────
// DB is optional — if DATABASE_URL / PGHOST is not set, TGG runs without DB
// and behaves exactly as before (Fyers-only mode).
let db = null;
let dbEnabled = false;
let recoveryEngine = null;
try {
  db = require("../../database/src/index");
  recoveryEngine = require("../../database/src/recoveryEngine");
  dbEnabled = true;
  console.log("[DB] Database module loaded — PostgreSQL integration active");
} catch (err) {
  console.warn("[DB] Database module not found — running without DB (Fyers-only mode):", err.message);
}

const app = express();
const server = http.createServer(app);

app.set("trust proxy", 1);

// ─── Socket.IO ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(corsMiddleware);
app.use(express.json()); // parse JSON body — needed for req.body.socketId in /refresh
app.use(rateLimiter);

// ─── Config ───────────────────────────────────────────────────────────────────
const SYMBOL = process.env.SYMBOL || "NSE:NIFTY50-INDEX";
const RESOLUTION = parseInt(process.env.CANDLE_RESOLUTION || "3");
// CANDLES_TO_FETCH: passed to fetchCandles() as the `count` parameter but
// fetchCandles() currently ignores it — Fyers data is fetched by date-range
// windows (calcLookbackDays) not by count. This env var is kept for future use
// if a count-based slice is added. The actual depth is controlled by
// calcLookbackDays() in fyers/client.js (30d for 3m, 60d for 15m, 150d for 1h).
const CANDLES_TO_FETCH = parseInt(process.env.CANDLES_TO_FETCH || "10000");
// CHART_DB_WINDOW_DAYS: how many days of 1m history fetchAndProcess() pulls
// from Postgres for intraday resolutions (1/3/5/15/60). DB itself still
// stores a full year — this only controls what the chart loads/displays.
// Kept at 90 days (full chart history) — the indicator-toggle unsmoothness
// is a frontend rendering concern, to be fixed there, not by shrinking data.
// Daily/Weekly (1440/10080) always derive from full DB history regardless
// of this value, since they need long lookback for correct bar boundaries.
const CHART_DB_WINDOW_DAYS = parseInt(process.env.CHART_DB_WINDOW_DAYS || "90");
const REFRESH_MS = parseInt(process.env.SCHEDULE_INTERVAL_MS || "5000");
const TICK_WATCHDOG_MS = parseInt(process.env.TICK_WATCHDOG_MS || "10000");
const WATCHDOG_GRACE_MS = parseInt(process.env.WATCHDOG_GRACE_MS || "30000");

// ─── State ────────────────────────────────────────────────────────────────────
const symbolCacheMap = new Map();  // "SYMBOL:resolution" → { candles, result, lastFetch }
let autoRefreshTimer = null;
const socketResolutions = new Map(); // socket.id → resolution
const socketSymbols = new Map();     // socket.id → symbol (dual-panel per-socket filtering)
let lastTickAt = 0;
let lastConnectAt = 0;
const lastTickBySymbol = new Map(); // symbol → Date.now() of last tick received

// ── ticksFlowing: true if any subscribed symbol got a tick within watchdog window ─
// Window matches TICK_WATCHDOG_MS so both agree on what "stale" means.
// e.g. TICK_WATCHDOG_MS=60000 → green dot stays on for 60s after last tick,
// then watchdog reconnects AND ticksFlowing flips false at the same time.
const TICK_FLOWING_WINDOW_MS = TICK_WATCHDOG_MS;
function ticksFlowing() {
  const syms = getActiveTickSymbols();
  const cutoff = Date.now() - TICK_FLOWING_WINDOW_MS;
  return syms.some((s) => (lastTickBySymbol.get(s) || 0) > cutoff);
}

// ─── Cache helpers ────────────────────────────────────────────────────────────
function cacheKey(symbol, resolution) { return `${symbol}:${resolution}`; }

function getCache(symbol, resolution) {
  const k = cacheKey(symbol, resolution);
  if (!symbolCacheMap.has(k)) symbolCacheMap.set(k, { candles: [], result: null, lastFetch: 0, motherwaveResult: null, motherwaveAt: 0 });
  return symbolCacheMap.get(k);
}

function setCache(symbol, resolution, candles, result) {
  const existing = symbolCacheMap.get(cacheKey(symbol, resolution)) || {};
  symbolCacheMap.set(cacheKey(symbol, resolution), {
    ...existing,
    candles,
    result,
    lastFetch: Date.now(),
    // Invalidate MW cache — candles changed, so MW may have changed
    motherwaveResult: null,
    motherwaveAt: 0,
  });
}

// ─── Candle Builder ───────────────────────────────────────────────────────────
const candleBuilders = new Map();

function getOrCreateBuilder(symbol) {
  if (!candleBuilders.has(symbol)) {
    const builder = new CandleBuilder({
      symbol,
      onTick: (formingCandles) => { emitCandleUpdate(symbol, formingCandles); },
      onFinalize: (finalizedCandle, formingCandles) => {
        console.log(`[Builder:${symbol}] Candle finalized @ ${new Date(finalizedCandle.time).toISOString()} close=${finalizedCandle.close}`);
        emitCandleUpdate(symbol, formingCandles);
        emitFinalCandle(symbol, finalizedCandle);

        // ── DB: save finalized 1m candle to PostgreSQL ──────────────────────
        if (dbEnabled) {
          db.upsertCandles(symbol, 1, [finalizedCandle]).catch((err) => {
            console.error(`[DB] Failed to save candle for ${symbol}:`, err.message);
          });
        }

        setImmediate(() => {
          const b = candleBuilders.get(symbol);
          if (!b) return;
          for (const res of [1, 3, 5, 15]) {
            const candles = b.getCandlesForResolution(res);
            if (candles.length === 0) continue;
            try { const result = runSignalEngine(candles); setCache(symbol, res, candles, result); }
            catch (err) { console.error(`[Builder:${symbol}] Signal engine error res=${res}:`, err.message); }
          }
          for (const res of [60, 1440, 10080]) {
            const cache = getCache(symbol, res);
            if (!cache.candles.length) continue;
            const forming1m = b.getCandlesForResolution(1);
            if (!forming1m.length) continue;
            const tick = forming1m[forming1m.length - 1];
            const cached = cache.candles;
            const last = cached[cached.length - 1];
            const updatedLast = { ...last, high: Math.max(last.high, tick.high), low: Math.min(last.low, tick.low), close: tick.close };
            const patched = [...cached.slice(0, -1), updatedLast];
            try { const result = runSignalEngine(patched); setCache(symbol, res, patched, result); }
            catch (err) { console.error(`[Builder:${symbol}] Patch error res=${res}:`, err.message); }
          }
        });

        // Deferred chart_update: symbol-scoped so dual panels don't overwrite each other
        setTimeout(() => {
          const b = candleBuilders.get(symbol);
          if (!b) return;
          for (const res of [1, 3, 5, 15, 60, 1440, 10080]) {
            const room = `res:${res}`;
            const roomSockets = io.sockets.adapter.rooms.get(room);
            if (!roomSockets?.size) continue;
            const cache = getCache(symbol, res);
            if (!cache.result || !cache.candles.length) continue;
            const payload = buildPayload(cache.candles, cache.result, symbol, res, true);
            for (const sid of roomSockets) {
              const sock = io.sockets.sockets.get(sid);
              if (!sock) continue;
              if ((socketSymbols.get(sid) || SYMBOL) === symbol) sock.emit("chart_update", payload);
            }
          }
        }, 250);
      },
    });
    candleBuilders.set(symbol, builder);
  }
  return candleBuilders.get(symbol);
}

// DUAL-PANEL FIX: emit tick/candle only to sockets watching this symbol
function emitCandleUpdate(symbol, formingCandles) {
  for (const [res, candle] of Object.entries(formingCandles)) {
    const numRes = Number(res);
    const room = `res:${numRes}`;
    const roomSockets = io.sockets.adapter.rooms.get(room);
    if (!roomSockets?.size || !candle) continue;
    const payload = { symbol, resolution: numRes, formingCandle: candle, timestamp: Date.now() };
    for (const sid of roomSockets) {
      const sock = io.sockets.sockets.get(sid);
      if (!sock) continue;
      if ((socketSymbols.get(sid) || SYMBOL) === symbol) {
        sock.emit("tick_update", payload);
        sock.emit("candle_update", payload);
      }
    }
  }
}

function emitFinalCandle(symbol, finalizedCandle) {
  for (const res of [1, 3, 5, 15, 60, 1440, 10080]) {
    const room = `res:${res}`;
    const roomSockets = io.sockets.adapter.rooms.get(room);
    if (!roomSockets?.size) continue;
    for (const sid of roomSockets) {
      const sock = io.sockets.sockets.get(sid);
      if (!sock) continue;
      if ((socketSymbols.get(sid) || SYMBOL) === symbol) {
        sock.emit("new_candle", { symbol, resolution: res, candle: finalizedCandle, timestamp: Date.now() });
      }
    }
  }
}

// ─── Tick Stream ──────────────────────────────────────────────────────────────
const tickStream = new TickStream();

tickStream.on("tick", (tick) => {
  const now = Date.now();
  const wasFlowing = ticksFlowing();
  lastTickAt = now;
  lastTickBySymbol.set(tick.symbol, now);
  getOrCreateBuilder(tick.symbol).processTick(tick);
  // If ticks just started flowing (e.g. after a gap/holiday silence),
  // immediately tell all clients — don't wait for the 30s broadcast.
  if (!wasFlowing) io.emit("market_status", { ticksFlowing: true });
});
tickStream.on("connected", () => { console.log("[TickStream] Fyers WebSocket connected ✓"); lastTickAt = 0; lastConnectAt = Date.now(); io.emit("market_status", { tickStreamActive: true, ticksFlowing: false }); });
tickStream.on("disconnected", () => { console.log("[TickStream] Fyers WebSocket disconnected"); io.emit("market_status", { tickStreamActive: false, ticksFlowing: false }); });
tickStream.on("error", (err) => { console.error("[TickStream] Error:", err?.message || err); });

/**
 * getActiveTickSymbols — returns every symbol currently watched by any connected
 * socket, plus the default SYMBOL. This is the list Fyers WebSocket subscribes to.
 */
function getActiveTickSymbols() {
  const set = new Set([SYMBOL]);
  for (const sym of socketSymbols.values()) { if (sym) set.add(sym); }
  return [...set];
}

/**
 * updateTickSubscription — sync the Fyers WebSocket subscription to the current
 * set of symbols watched by all connected panels.
 *
 * ROOT-CAUSE FIX for "only NIFTY gets tick-by-tick":
 * Previously maybeStartTickStream() always called tickStream.start([SYMBOL])
 * regardless of what panels were searching. Now every symbol change emits
 * set_symbol on the socket, which triggers this function to either:
 *   - add the new symbol via tickStream.setSymbols() if already connected, or
 *   - restart tickStream.start() with the full list if not yet running.
 */
async function updateTickSubscription() {
  if (!isTradingDay()) return;
  const valid = await validateToken().catch(() => false);
  if (!valid) return;
  const symbols = getActiveTickSymbols();
  if (!isAnyMarketLive(symbols)) return;
  if (tickStream.isConnected()) {
    tickStream.setSymbols(symbols);
    console.log(`[TickStream] Subscription updated → [${symbols.join(", ")}]`);
  } else {
    tickStream.start(symbols);
    console.log(`[TickStream] Started with symbols → [${symbols.join(", ")}]`);
  }
}

/**
 * maybeStartTickStream — startup entry point. Uses getActiveTickSymbols() so
 * any symbols already in socketSymbols (from fast-connecting clients) are included.
 */
async function maybeStartTickStream() {
  if (!isTradingDay()) { console.log("[TickStream] Weekend — tick stream not needed."); return; }
  const symbols = getActiveTickSymbols();
  if (!isAnyMarketLive(symbols)) { console.log("[TickStream] No active market right now — tick stream not needed."); return; }
  if (tickStream.isConnected()) { tickStream.setSymbols(symbols); return; }
  const valid = await validateToken().catch(() => false);
  if (!valid) { console.log("[TickStream] Not authenticated — skipping tick stream."); return; }
  tickStream.start(symbols);
}

// ─── Payload builder ──────────────────────────────────────────────────────────
function buildPayload(candles, result, symbol, resolution, isAutoRefresh = false) {
  const clean = (candles || [])
    .filter((c) => Number.isFinite(c.time) && c.time > 0 && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close))
    .sort((a, b) => a.time - b.time)
    .filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time);
  return {
    symbol, resolution: Number(resolution), candles: clean,
    emaHighs: result.emaHighs, emaLows: result.emaLows, signals: result.signals,
    currentState: result.currentState, bestPrice: result.bestPrice, bestBar: result.bestBar,
    lastUpdate: new Date().toISOString(), balance: parseFloat(process.env.CURRENT_BALANCE || 0), isAutoRefresh,
  };
}

// ─── Core fetch & process ─────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for "get me candles for symbol+resolution".
// Every caller — GET /api/chart, POST /api/chart/refresh, /api/motherwave,
// and initialRestFetch() — goes through this one function. No DB code lives
// anywhere else in the codebase.
//
// Order of operations:
//   1. DB-first  — if DB is enabled and has 1m rows for `symbol`, derive the
//      requested resolution from Postgres. No Fyers call needed. This is the
//      common case once a symbol has been backfilled at least once.
//   2. Fyers fallback — only when DB is disabled, DB has zero rows for this
//      symbol (fresh symbol, never backfilled), or the DB read throws. Fetches
//      from Fyers REST and write-throughs 1m candles to DB so the *next* call
//      for this symbol takes the DB-first path.
//
// Daily/Weekly (1440/10080) always derive from the FULL 1m history stored in
// DB (not the CHART_DB_WINDOW_DAYS slice) — they need long lookback to form
// correct calendar-day/week boundaries. Everything else (1/3/5/15/60) uses
// the last CHART_DB_WINDOW_DAYS days only, which is what keeps the chart
// smooth.
async function loadFromDB(symbol, resolution) {
  if (!dbEnabled || !db) return null;
  try {
    let oneMinCandles;
    if (resolution === 1440 || resolution === 10080) {
      oneMinCandles = await db.loadCandles(symbol, 1, { limit: 100000 });
    } else {
      const windowMs = CHART_DB_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      oneMinCandles = await db.loadCandles(symbol, 1, {
        from: new Date(Date.now() - windowMs),
        to: new Date(),
        limit: 50000,
      });
    }

    if (!oneMinCandles || oneMinCandles.length === 0) return null;

    const candles = resolution === 1 ? oneMinCandles : deriveTimeframe(oneMinCandles, resolution);
    if (!candles || candles.length === 0) return null;

    return { candles, oneMinCandles };
  } catch (err) {
    console.warn(`[DB-first] DB read failed for ${symbol} res=${resolution} (${err.message}) — falling back to Fyers`);
    return null;
  }
}

async function fetchAndProcess(symbol = SYMBOL, resolution = RESOLUTION) {
  // ── 1. DB-first ──────────────────────────────────────────────────────────
  const dbHit = await loadFromDB(symbol, resolution);
  if (dbHit) {
    const { candles, oneMinCandles } = dbHit;
    console.log(`[DB-first] ${symbol} res=${resolution}m → ${candles.length} candles from DB`);

    // Seed the candle builder so the live tick stream has 1m continuity for
    // this symbol — same seedHistory() call the Fyers path always made.
    // Safe to call repeatedly: seedHistory() fully replaces _oneMinHistory.
    getOrCreateBuilder(symbol).seedHistory(oneMinCandles);

    const result = runSignalEngine(candles);
    setCache(symbol, resolution, candles, result);
    if (resolution !== 1) {
      try { setCache(symbol, 1, oneMinCandles, runSignalEngine(oneMinCandles)); } catch { }
    }
    return { candles, result };
  }

  // ── 2. Fyers fallback (DB disabled, empty, or read failed) ───────────────
  console.log(`[Fyers-fallback] ${symbol} res=${resolution}m — no DB data, fetching from Fyers`);
  const raw1m = await fetchCandles(symbol, 1, CANDLES_TO_FETCH);

  if (candleBuilders.has(symbol)) {
    const existing = candleBuilders.get(symbol).getOneMinHistory();
    if (existing.length > 0 && raw1m.length > 0) {
      const ratio = existing[0].close > 0 ? Math.abs(raw1m[0].close - existing[0].close) / existing[0].close : 1;
      if (ratio > 0.5) { console.log(`[Server] Price scale mismatch for ${symbol} — resetting builder`); candleBuilders.delete(symbol); }
    }
  }

  const builder = getOrCreateBuilder(symbol);
  builder.seedHistory(raw1m);

  // ── DB: bulk-save REST 1m candles on every fetch ────────────────────────
  // This backfills the DB with historical 1m candles from Fyers REST so the
  // *next* fetchAndProcess() call for this symbol takes the DB-first path.
  // upsertCandles is idempotent (ON CONFLICT DO UPDATE) so re-fetching is safe.
  // ── DB: smart upsert ─ only write candles newer than what's already stored ──
  if (dbEnabled && raw1m.length > 0) {
    db.getLatestCandle(symbol, 1).then((latest) => {
      const newCandles = latest
        ? raw1m.filter((c) => c.time > latest.time)
        : raw1m;

      if (newCandles.length === 0) {
        console.log(`[DB] ${symbol} — no new candles to upsert (already up to date)`);
        return;
      }

      return db.upsertCandles(symbol, 1, newCandles).then((n) => {
        const since = latest ? new Date(latest.time).toISOString() : 'first time';
        console.log(`[DB] Upserted ${n} new 1m candles for ${symbol} (${since})`);
      });
    }).catch((err) => {
      // getLatestCandle failed — skip upsert entirely, do NOT dump all candles.
      // recoveryEngine will detect any gap on its next cycle and re-fetch
      // only the affected day via deleteDayCandles + upsert. repairLog will
      // record it. No blind fallback upsert here.
      console.warn(`[DB] getLatestCandle failed for ${symbol} (${err.message}) — skipping upsert, recoveryEngine will handle gap`);
    });
  }

  let candles;
  if (resolution === 1) { candles = raw1m; }
  else { candles = await fetchCandles(symbol, resolution, CANDLES_TO_FETCH); }

  const result = runSignalEngine(candles);
  setCache(symbol, resolution, candles, result);
  if (resolution !== 1) { try { setCache(symbol, 1, raw1m, runSignalEngine(raw1m)); } catch { } }
  return { candles, result };
}

// Broadcast to room but only to sockets watching this symbol
async function fetchAndBroadcast(symbol, resolution, isAutoRefresh = true) {
  const { candles, result } = await fetchAndProcess(symbol, resolution);
  const payload = buildPayload(candles, result, symbol, resolution, isAutoRefresh);
  const room = `res:${resolution}`;
  const roomSockets = io.sockets.adapter.rooms.get(room);
  if (roomSockets?.size) {
    for (const sid of roomSockets) {
      const sock = io.sockets.sockets.get(sid);
      if (!sock) continue;
      if ((socketSymbols.get(sid) || SYMBOL) === symbol) sock.emit("chart_update", payload);
    }
  }
  console.log(`[BROADCAST] ${symbol} res=${resolution}m → ${candles.length} candles`);
  return { candles, result };
}

// ─── Routes ───────────────────────────────────────────────────────────────────
// Chart, auth, health, signals, motherwave → chartRouter (extracted)
app.use(createChartRouter({
  io, socketSymbols, socketResolutions,
  SYMBOL, RESOLUTION, TICK_WATCHDOG_MS,
  getCache, buildPayload, fetchAndProcess, fetchAndBroadcast,
  isLiveMarket, isTradingDay, isAnyMarketLive,
  tickStream, ticksFlowing, getActiveTickSymbols, updateTickSubscription, maybeStartTickStream,
  getAuthURL, generateToken, validateToken,
  detectMotherWaveForAPI,
}));

app.use("/api/symbols", symbolsRouter);
app.use("/api/scanner", scannerRouter);
app.use("/api/backtest", backtestRouter);

// ─── Tick Watchdog ────────────────────────────────────────────────────────────
function startTickWatchdog() {
  setInterval(() => {
    if (!isTradingDay() || !isAnyMarketLive(getActiveTickSymbols()) || !tickStream.isConnected()) return;
    const now = Date.now();
    if (lastConnectAt > 0 && now - lastConnectAt < WATCHDOG_GRACE_MS) return;
    if (lastTickAt === 0) return;
    const silenceMs = now - lastTickAt;
    if (silenceMs > TICK_WATCHDOG_MS) {
      console.warn(`[Watchdog] No tick for ${(silenceMs / 1000).toFixed(1)}s — reconnecting WebSocket`);
      lastTickAt = 0; lastConnectAt = 0;
      // Immediately tell all clients ticks stopped — don't wait for broadcast timer
      io.emit("market_status", { ticksFlowing: false, tickStreamActive: false });
      tickStream.stop();
      // Restart with the FULL current symbol list (not just [SYMBOL])
      setTimeout(() => maybeStartTickStream(), 1000);
    }
  }, TICK_WATCHDOG_MS);
  console.log(`[Watchdog] Started (timeout: ${TICK_WATCHDOG_MS / 1000}s, grace: ${WATCHDOG_GRACE_MS / 1000}s)`);

  // ── Market-close detector ───────────────────────────────────────────────────
  // Checks every 60s whether the market has closed for ALL active symbols.
  // When isAnyMarketLive transitions true → false, stops the tick stream
  // immediately so Fyers doesn't keep sending post-close ticks that would
  // keep ticksFlowing=true after the exchange is closed.
  let wasAnyLive = isAnyMarketLive(getActiveTickSymbols());
  setInterval(() => {
    const nowLive = isAnyMarketLive(getActiveTickSymbols());
    if (wasAnyLive && !nowLive) {
      // Market just closed — stop stream, clear tick timestamps, notify clients
      console.log("[Watchdog] Market closed — stopping tick stream and clearing tick state.");
      lastTickAt = 0;
      lastConnectAt = 0;
      // Clear all per-symbol tick timestamps so ticksFlowing() returns false
      lastTickBySymbol.clear();
      tickStream.stop();
      io.emit("market_status", { ticksFlowing: false, tickStreamActive: false });
    }
    wasAnyLive = nowLive;
  }, 60_000); // check every 60s — market close is a once-per-day event

  // Periodic status broadcast — interval is half the watchdog so clients
  // learn ticksFlowing changes promptly without hammering the socket.
  const STATUS_BROADCAST_MS = Math.max(10_000, Math.floor(TICK_WATCHDOG_MS / 2));
  setInterval(() => {
    io.emit("market_status", { ticksFlowing: ticksFlowing(), tickStreamActive: tickStream.isConnected() });
  }, STATUS_BROADCAST_MS);
  console.log(`[Watchdog] Status broadcast every ${STATUS_BROADCAST_MS / 1000}s`);
}

// ─── Auto-refresh fallback ────────────────────────────────────────────────────
function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(async () => {
    if (!isTradingDay() || !isAnyMarketLive(getActiveTickSymbols()) || tickStream.isConnected()) return;
    const valid = await validateToken();
    if (!valid) return;

    // Collect ALL unique (symbol, resolution) pairs across all connected sockets
    // — not just the default SYMBOL. Every panel gets refreshed.
    const pairs = new Map();
    for (const [sid, sym] of socketSymbols) {
      const res = socketResolutions.get(sid) || RESOLUTION;
      const key = `${sym}:${res}`;
      if (!pairs.has(key)) pairs.set(key, { symbol: sym, resolution: res });
    }
    // Always include default
    const dk = `${SYMBOL}:${RESOLUTION}`;
    if (!pairs.has(dk)) pairs.set(dk, { symbol: SYMBOL, resolution: RESOLUTION });

    // Stagger refreshes 600ms apart — prevents Fyers rate storm (Issue #2 fix)
    const pairList = Array.from(pairs.values());
    for (let i = 0; i < pairList.length; i++) {
      const { symbol, resolution } = pairList[i];
      if (i > 0) await new Promise(r => setTimeout(r, 600));
      console.log(`[AUTO] Refreshing ${symbol} res=${resolution}m... (${i + 1}/${pairList.length})`);
      fetchAndBroadcast(symbol, resolution, true).catch((e) => console.error(`[AUTO] Error ${symbol} res=${resolution}:`, e.message));
    }
  }, REFRESH_MS);
  console.log(`[AUTO] Refresh every ${REFRESH_MS / 1000}s (live market + tick stream down only)`);
}

// ─── Initial REST fetch ───────────────────────────────────────────────────────
// Pre-warms the in-process cache for every resolution on startup. All DB-first
// / Fyers-fallback logic lives in fetchAndProcess() — this just calls it once
// per resolution with retries, exactly like every other caller.
async function initialRestFetch() {
  const valid = await validateToken().catch(() => false);
  if (!valid) { console.log("[INIT] Not authenticated — skipping initial REST fetch. Chart will be empty."); return; }
  const dayLabel = isTradingDay() ? (isAnyMarketLive(getActiveTickSymbols()) ? "live market" : "weekday (market closed)") : "weekend/holiday";
  console.log(`[INIT] Pre-warming all resolutions for ${SYMBOL} (${dayLabel})...`);

  const ALL_RESOLUTIONS = [1, 3, 5, 15, 60, 1440, 10080];

  for (const res of ALL_RESOLUTIONS) {
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try { await fetchAndProcess(SYMBOL, res); console.log(`[INIT] res=${res} ✓`); break; }
      catch (err) {
        console.error(`[INIT] res=${res} attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
        if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
  try {
    const cache = getCache(SYMBOL, RESOLUTION);
    if (cache.result && cache.candles.length > 0) io.emit("chart_update", buildPayload(cache.candles, cache.result, SYMBOL, RESOLUTION, false));
  } catch { }
  console.log("[INIT] All resolutions loaded ✓  Chart is ready.");
}

// ─── Socket.IO connections ────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);
  let currentResolution = RESOLUTION;
  let currentSymbol = SYMBOL;
  socketResolutions.set(socket.id, currentResolution);
  socketSymbols.set(socket.id, currentSymbol);
  socket.join(`res:${currentResolution}`);

  const initialCache = getCache(SYMBOL, currentResolution);
  if (initialCache.result && initialCache.candles.length > 0) {
    socket.emit("chart_update", buildPayload(initialCache.candles, initialCache.result, SYMBOL, currentResolution, true));
  }
  socket.emit("market_status", { tickStreamActive: tickStream.isConnected(), liveMarket: isAnyMarketLive(getActiveTickSymbols()), tradingDay: isTradingDay(), ticksFlowing: ticksFlowing() });

  // TICK-STREAM + DUAL-PANEL FIX:
  // Track each socket's active symbol. On change, call updateTickSubscription()
  // so the Fyers WebSocket subscription expands to include the new symbol.
  // This is what makes HAVELLS/RELIANCE/any stock get live ticks, not just NIFTY.
  socket.on("set_symbol", (sym) => {
    if (!sym) return;
    const prev = currentSymbol;
    currentSymbol = sym;
    socketSymbols.set(socket.id, sym);
    console.log(`[WS] ${socket.id} → symbol=${sym}`);
    if (isLiveMarket(sym) && sym !== prev) {
      updateTickSubscription().catch(console.error);
    }
  });

  socket.on("set_resolution", (res) => {
    const newRes = parseInt(res);
    if (isNaN(newRes) || newRes === currentResolution) return;
    socket.leave(`res:${currentResolution}`);
    currentResolution = newRes;
    socketResolutions.set(socket.id, newRes);
    socket.join(`res:${newRes}`);
    console.log(`[WS] ${socket.id} → res=${newRes}`);
    const newCache = getCache(currentSymbol, newRes);
    if (newCache.result && newCache.candles.length > 0 && Date.now() - newCache.lastFetch < 120_000) {
      socket.emit("chart_update", buildPayload(newCache.candles, newCache.result, currentSymbol, newRes, true));
    }
  });

  socket.on("request_refresh", async () => {
    const valid = await validateToken();
    if (!valid) { socket.emit("error", { message: "Not authenticated. Please set up Fyers token." }); return; }
    fetchAndProcess(currentSymbol, currentResolution)
      .then(({ candles, result }) => socket.emit("chart_update", buildPayload(candles, result, currentSymbol, currentResolution, false)))
      .catch((e) => socket.emit("error", { message: e.message }));
  });

  socket.on("disconnect", () => {
    socketResolutions.delete(socket.id);
    socketSymbols.delete(socket.id);
    console.log(`[WS] Client disconnected: ${socket.id}`);
    // Possibly trim unused symbols from tick subscription
    if (isAnyMarketLive(getActiveTickSymbols())) updateTickSubscription().catch(console.error);
  });
});

// ─── Serve React Frontend ─────────────────────────────────────────────────────
const FRONTEND_BUILD = path.join(__dirname, "../../frontend/build");
app.use(express.static(FRONTEND_BUILD));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) return next();
  res.sendFile(path.join(FRONTEND_BUILD, "index.html"));
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "5280");
server.listen(PORT, async () => {
  console.log(`\n✅ TGG Backend running on http://localhost:${PORT}`);
  console.log(`   Health     : http://localhost:${PORT}/health`);
  console.log(`   Chart      : http://localhost:${PORT}/api/chart`);
  console.log(`   Motherwave : http://localhost:${PORT}/api/motherwave`);
  console.log(`   Auth       : http://localhost:${PORT}/api/auth/status`);
  console.log(`   Symbols    : http://localhost:${PORT}/api/symbols`);
  console.log(`   Scanner    : http://localhost:${PORT}/api/scanner/signals\n`);
  startAutoRefresh();
  startTickWatchdog();

  // ── DB: connect, health-check, prune old candles ────────────────────────
  if (dbEnabled) {
    try {
      const ok = await db.healthCheck();
      if (ok) {
        console.log("[DB] ✅  PostgreSQL connection healthy");
        // Prune candles older than 365 days on startup
        const pruned = await db.pruneOldCandles(null, 1, 365);
        if (pruned > 0) console.log(`[DB] Pruned ${pruned} old candles (>365 days)`);

        // ── Wire up recovery engine WebSocket emitter ──────────────────────
        if (recoveryEngine) {
          recoveryEngine.injectStatusEmitter((event, data) => io.emit(event, data));
          console.log("[Recovery] Status emitter connected to WebSocket");
        }

        // ── Startup gap scan: validate all curated symbols, repair gaps ────
        // Runs after initialRestFetch completes so we don't race with it.
        // Throttled: 3 symbols at a time with 1s delay between batches to
        // respect Fyers rate limits during repair refetch calls.
        setImmediate(async () => {
          if (!recoveryEngine) return;
          const fs = require("fs");
          const path = require("path");
          const SYMBOLS_JSON = path.resolve(__dirname, "../../frontend/src/symbols.json");
          const MCX_EXCLUDED = [
            "CRUDEOIL26JUNFUT", "ALUMINIUM26MAYFUT", "NATGASMINI26MAYFUT",
            "SILVER26JULFUT", "GOLD26JUNFUT",
          ];
          let curatedSymbols = [];
          try {
            const all = JSON.parse(fs.readFileSync(SYMBOLS_JSON, "utf8"));
            curatedSymbols = all
              .map((s) => s.symbol)
              .filter((sym) => sym && !MCX_EXCLUDED.some((ex) => sym.includes(ex)));
          } catch (e) {
            console.warn("[Recovery] Could not load symbols.json for startup scan:", e.message);
            return;
          }

          // Wait for initialRestFetch to finish (it runs right before this setImmediate)
          await new Promise((r) => setTimeout(r, 5000));

          console.log(`[Recovery] Startup gap scan: checking ${curatedSymbols.length} curated symbols...`);
          let repaired = 0;
          let clean = 0;
          const CONCURRENCY = 3;
          const BATCH_DELAY_MS = 1000;

          for (let i = 0; i < curatedSymbols.length; i += CONCURRENCY) {
            const batch = curatedSymbols.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async (symbol) => {
              try {
                const { valid, issues } = await db.validateHistorical(symbol, 1);
                if (!valid && issues.length > 0) {
                  // Find the earliest gap and repair that day
                  const gapIssue = issues.find((iss) => iss.type === "GAP" || iss.type === "CORRUPT_OHLC");
                  if (gapIssue) {
                    const tradingDay = new Date(gapIssue.time || Date.now());
                    console.log(`[Recovery] ${symbol}: ${issues.length} issue(s) — repairing gap at ${tradingDay.toISOString().slice(0, 10)}`);
                    await recoveryEngine.repairDay({
                      symbol,
                      tradingDay,
                      fetchCandles: (sym, res) => fetchCandles(sym, res),
                      trigger: "startup",
                    });
                    repaired++;
                  }
                } else {
                  clean++;
                  // Silent for clean symbols — only log summary at end
                }
              } catch (e) {
                console.warn(`[Recovery] ${symbol} scan error:`, e.message);
              }
            }));
            if (i + CONCURRENCY < curatedSymbols.length) {
              await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
            }
          }
          console.log(`[Recovery] Startup scan complete — ${clean} clean, ${repaired} repaired out of ${curatedSymbols.length} symbols`);
        });

      } else {
        console.warn("[DB] ⚠️  PostgreSQL health check failed — DB writes disabled");
        dbEnabled = false;
      }
    } catch (err) {
      console.warn("[DB] ⚠️  PostgreSQL startup error — DB writes disabled:", err.message);
      dbEnabled = false;
    }
  }

  await initialRestFetch();

  // ─── Scanner + Backtest symbol loading ──────────────────────────────────────
  setImmediate(() => {
    const path = require("path");
    const fs = require("fs");
    const FRONTEND_SRC = path.resolve(__dirname, "../../frontend/src");

    function loadScanSymbols() {
      const symbols = new Set();

      // symbols.json
      try {
        const arr = JSON.parse(fs.readFileSync(path.join(FRONTEND_SRC, "symbols.json"), "utf8"));
        arr.forEach((s) => s.symbol && symbols.add(s.symbol.trim()));
      } catch { }

      // mcx.json
      try {
        const arr = JSON.parse(fs.readFileSync(path.join(FRONTEND_SRC, "mcx.json"), "utf8"));
        arr.forEach((s) => s.symbol && symbols.add(s.symbol.trim()));
      } catch { }

      // stocks.xlsx and NIFTY.xlsx via xlsx
      for (const xlFile of ["stocks.xlsx", "NIFTY.xlsx"]) {
        try {
          const XLSX = require("xlsx");
          const wb = XLSX.readFile(path.join(FRONTEND_SRC, xlFile));
          const ws = wb.Sheets[wb.SheetNames[0]];
          XLSX.utils.sheet_to_json(ws).forEach((r) => r.symbol && symbols.add(String(r.symbol).trim()));
        } catch { }
      }

      return [...symbols];
    }

    const allSymbols = loadScanSymbols();
    console.log(`[Scanner] Loaded ${allSymbols.length} symbols for scanning`);
    scanner.setSymbols(allSymbols);
    backtestRunner.setSymbols(allSymbols);

    // Forward scanner events to all connected clients via Socket.IO
    scanner.on("scan_start", (data) => io.emit("scanner_start", data));
    scanner.on("scan_progress", (data) => io.emit("scanner_progress", data));
    scanner.on("scan_complete", (data) => io.emit("scanner_complete", data));
    scanner.on("signal_found", (data) => io.emit("scanner_signal", data));
    scanner.on("signal_partial", (data) => io.emit("scanner_partial", data));

    // Forward backtest events
    backtestRunner.on("backtest_start", (data) => io.emit("backtest_start", data));
    backtestRunner.on("backtest_progress", (data) => io.emit("backtest_progress", data));
    backtestRunner.on("backtest_complete", (data) => io.emit("backtest_complete", data));
    backtestRunner.on("backtest_hit", (data) => io.emit("backtest_hit", data));

    // No auto-start — scan is triggered manually from the UI or POST /api/scanner/trigger
  });

  if (isAnyMarketLive(getActiveTickSymbols())) { console.log("[INIT] Market is live — starting tick stream for real-time candles."); await maybeStartTickStream(); }
  else if (isTradingDay()) { console.log("[INIT] Weekday outside market hours — REST data ready. Tick stream inactive."); }
  else { console.log("[INIT] Weekend/holiday — REST data loaded from last session. No tick stream."); }
});

module.exports = { app, server };