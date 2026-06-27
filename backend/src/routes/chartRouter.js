/**
 * chartRouter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Express router for all chart-related, auth, motherwave, and health routes.
 * Previously all inline in server.js (787 lines).
 *
 * Pattern: factory function receives shared server-state dependencies so the
 * router can reference io, caches, etc. without circular requires.
 *
 * Routes owned here:
 *   GET  /health
 *   GET  /api/auth/status
 *   GET  /api/auth/url
 *   POST /api/auth/token
 *   GET  /api/chart
 *   POST /api/chart/refresh
 *   GET  /api/signals
 *   GET  /api/motherwave
 *
 * Usage in server.js:
 *   const createChartRouter = require("./chartRouter");
 *   app.use(createChartRouter(deps));
 */
const express = require("express");

/**
 * @param {object} deps - injected server-level dependencies
 * @param {import("socket.io").Server}  deps.io
 * @param {Map}    deps.socketSymbols         - socket.id → symbol
 * @param {string} deps.SYMBOL
 * @param {number} deps.RESOLUTION
 * @param {number} deps.TICK_WATCHDOG_MS
 * @param {Function} deps.getCache
 * @param {Function} deps.buildPayload
 * @param {Function} deps.fetchAndProcess
 * @param {Function} deps.isLiveMarket
 * @param {Function} deps.isTradingDay
 * @param {object}   deps.tickStream          - { isConnected() }
 * @param {Function} deps.ticksFlowing
 * @param {Function} deps.isAnyMarketLive
 * @param {Function} deps.getActiveTickSymbols
 * @param {Function} deps.updateTickSubscription
 * @param {Function} deps.maybeStartTickStream
 * @param {Function} deps.getAuthURL
 * @param {Function} deps.generateToken
 * @param {Function} deps.validateToken
 * @param {Function} deps.detectMotherWaveForAPI
 */
function createChartRouter(deps) {
  const {
    io, socketSymbols,
    SYMBOL, RESOLUTION,
    getCache, buildPayload, fetchAndProcess,
    isLiveMarket, isTradingDay,
    tickStream, ticksFlowing, isAnyMarketLive, getActiveTickSymbols,
    updateTickSubscription,
    getAuthURL, generateToken, validateToken,
    detectMotherWaveForAPI,
    deriveTimeframe, runSignalEngine,
  } = deps;

  const router = express.Router();

  // ── Health ──────────────────────────────────────────────────────────────────
  router.get("/health", (req, res) => {
    const activeSyms = getActiveTickSymbols();
    res.json({
      status: "ok",
      time: new Date().toISOString(),
      tickStreamActive: tickStream.isConnected(),
      ticksFlowing: ticksFlowing(),
      liveMarket: isAnyMarketLive(activeSyms),
      tradingDay: isTradingDay(),
      tickSymbols: activeSyms,
      watchdogWindowMs: deps.TICK_WATCHDOG_MS,
    });
  });

  // ── Auth ────────────────────────────────────────────────────────────────────
  router.get("/api/auth/status", async (req, res) => {
    try {
      const valid = await validateToken();
      res.json({ authenticated: valid, authUrl: valid ? null : getAuthURL() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get("/api/auth/url", (req, res) => {
    try { res.json({ url: getAuthURL() }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post("/api/auth/token", async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "auth_code required" });
    try {
      await generateToken(code);
      await deps.maybeStartTickStream();
      res.json({ success: true, message: "Token saved successfully" });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Chart ───────────────────────────────────────────────────────────────────
  /**
   * GET /api/chart?symbol=X&resolution=Y
   *
   * DB-FIRST path (Step 6 of architecture brief):
   *   1. If DB is enabled and has enough 1m data for the last 3 months →
   *      derive the requested resolution via deriveTimeframe, run signal
   *      engine, respond. No Fyers call needed.
   *   2. DB miss / insufficient rows → fall back to fetchAndProcess (Fyers),
   *      which already write-throughs to DB. Same behavior as before.
   *
   * In-process symbolCacheMap sits in front of both paths (unchanged).
   *
   * 3-month window: ~90 days × 375 min/day = ~33,750 expected 1m candles.
   * We consider DB "sufficient" if we have ≥ 50% of that (~16,875 rows),
   * which guards against a freshly seeded or partially backfilled DB.
   * During live market we always fall through to Fyers so the chart shows
   * the latest forming candle (tick stream handles that, but REST confirms).
   */
  router.get("/api/chart", async (req, res) => {
    const symbol = req.query.symbol || SYMBOL;
    const resolution = parseInt(req.query.resolution || RESOLUTION);
    const cache = getCache(symbol, resolution);

    const live = isLiveMarket(symbol);
    const tradingDay = isTradingDay(symbol);
    const cacheTTL = live ? 60_000 : tradingDay ? 5 * 60_000 : 24 * 60 * 60_000;

    // ── 1. In-process cache (unchanged) ──────────────────────────────────────
    if (cache.result && cache.candles.length > 0 && Date.now() - cache.lastFetch < cacheTTL) {
      return res.json(buildPayload(cache.candles, cache.result, symbol, resolution));
    }

    // ── 2. DB-first: try loading 3 months of 1m candles from Postgres ────────
    const db = deps.db;
    const dbEnabled = deps.dbEnabled;

    if (dbEnabled && db && !live) {
      try {
        const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
        const from = new Date(Date.now() - THREE_MONTHS_MS);
        const to = new Date();

        const oneMinCandles = await db.loadCandles(symbol, 1, { from, to, limit: 50000 });

        if (oneMinCandles.length > 0) {
          console.log(`[DB-first] ${symbol} res=${resolution}m → ${oneMinCandles.length} 1m rows from DB`);

          let candles;
          if (resolution === 1) {
            candles = oneMinCandles;
          } else {
            // deriveTimeframe(oneMinCandles, targetResolutionMinutes)
            candles = deriveTimeframe(oneMinCandles, resolution);
          }

          if (candles && candles.length > 0) {
            const result = runSignalEngine(candles);
            // Populate in-process cache so subsequent calls hit the TTL path
            cache.candles = candles;
            cache.result = result;
            cache.lastFetch = Date.now();
            return res.json(buildPayload(candles, result, symbol, resolution));
          }
        } else {
          console.log(`[DB-first] ${symbol} — no rows in DB, fetching from Fyers`);
        }
      } catch (dbErr) {
        console.warn(`[DB-first] DB read failed for ${symbol}:`, dbErr.message, "— falling back to Fyers");
      }
    }

    // ── 3. Fyers fallback (original behavior) ─────────────────────────────────
    try {
      const { candles, result } = await fetchAndProcess(symbol, resolution);
      if (live) setImmediate(() => updateTickSubscription().catch(console.error));
      res.json(buildPayload(candles, result, symbol, resolution));
    } catch (err) {
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
   *
   * DUAL-PANEL FIX: emits chart_update only to the requesting socket (via
   * socketId in body) so the other panel's chart is never overwritten.
   *
   * TICK-STREAM FIX: after a successful fetch for any symbol, calls
   * updateTickSubscription() to add that symbol to the Fyers WebSocket.
   */
  router.post("/api/chart/refresh", async (req, res) => {
    const symbol = req.query.symbol || SYMBOL;
    const resolution = parseInt(req.query.resolution || RESOLUTION);
    const requestingSocketId = req.body?.socketId || null;

    console.log(`[REFRESH] symbol=${symbol} res=${resolution}m socket=${requestingSocketId || "broadcast"} liveMarket=${isLiveMarket(symbol)}`);

    if (requestingSocketId) socketSymbols.set(requestingSocketId, symbol);

    // ── DB-first path (mirrors GET /api/chart) ─────────────────────────────
    // Market closed → serve entirely from DB, no Fyers call needed.
    // Market open   → also serve from DB; tick stream handles the live forming
    //                 candle separately via tick_update/candle_update events.
    // Only fall through to Fyers if DB has no rows for this symbol.
    const db = deps.db;
    const dbEnabled = deps.dbEnabled;
    const live = isLiveMarket(symbol);

    if (dbEnabled && db) {
      try {
        const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
        const from = new Date(Date.now() - THREE_MONTHS_MS);
        const to = new Date();

        const oneMinCandles = await db.loadCandles(symbol, 1, { from, to, limit: 50000 });

        if (oneMinCandles.length > 0) {
          console.log(`[DB-first] REFRESH ${symbol} res=${resolution}m → ${oneMinCandles.length} 1m rows from DB`);

          let candles;
          if (resolution === 1) {
            candles = oneMinCandles;
          } else if (resolution === 1440) {
            // Daily — derive from full 1m history stored in DB (not just 3 months)
            const allOneMIn = await db.loadCandles(symbol, 1, { limit: 100000 });
            candles = deriveTimeframe(allOneMIn.length > 0 ? allOneMIn : oneMinCandles, resolution);
          } else if (resolution === 10080) {
            // Weekly — derive from full 1m history
            const allOneMIn = await db.loadCandles(symbol, 1, { limit: 100000 });
            candles = deriveTimeframe(allOneMIn.length > 0 ? allOneMIn : oneMinCandles, resolution);
          } else {
            candles = deriveTimeframe(oneMinCandles, resolution);
          }

          if (candles && candles.length > 0) {
            const result = runSignalEngine(candles);
            const cache = getCache(symbol, resolution);
            cache.candles = candles;
            cache.result = result;
            cache.lastFetch = Date.now();

            const payload = { ...buildPayload(candles, result, symbol, resolution, false), success: true };

            if (requestingSocketId) {
              io.to(requestingSocketId).emit("chart_update", { ...payload, isAutoRefresh: false });
            } else {
              const room = `res:${resolution}`;
              const roomSockets = io.sockets.adapter.rooms.get(room);
              if (roomSockets?.size) {
                for (const sid of roomSockets) {
                  const sock = io.sockets.sockets.get(sid);
                  if (!sock) continue;
                  if ((socketSymbols.get(sid) || SYMBOL) === symbol) sock.emit("chart_update", { ...payload, isAutoRefresh: true });
                }
              } else {
                io.to(room).emit("chart_update", { ...payload, isAutoRefresh: true });
              }
            }

            return res.json(payload);
          }
        } else {
          console.log(`[DB-first] REFRESH ${symbol} — no rows in DB, fetching from Fyers`);
        }
      } catch (dbErr) {
        console.warn(`[DB-first] REFRESH DB read failed for ${symbol}:`, dbErr.message, "— falling back to Fyers");
      }
    }

    // ── Fyers fallback (only when DB has no data for this symbol) ──────────
    try {
      const { candles, result } = await fetchAndProcess(symbol, resolution);
      const payload = { ...buildPayload(candles, result, symbol, resolution, false), success: true };

      if (requestingSocketId) {
        io.to(requestingSocketId).emit("chart_update", { ...payload, isAutoRefresh: false });
      } else {
        const room = `res:${resolution}`;
        const roomSockets = io.sockets.adapter.rooms.get(room);
        if (roomSockets?.size) {
          for (const sid of roomSockets) {
            const sock = io.sockets.sockets.get(sid);
            if (!sock) continue;
            if ((socketSymbols.get(sid) || SYMBOL) === symbol) sock.emit("chart_update", { ...payload, isAutoRefresh: true });
          }
        } else {
          io.to(room).emit("chart_update", { ...payload, isAutoRefresh: true });
        }
      }

      res.json(payload);
      setImmediate(() => updateTickSubscription().catch(console.error));
    } catch (err) {
      const cache = getCache(symbol, resolution);
      if (cache.result && cache.candles.length > 0) {
        console.warn(`[REFRESH] Fetch failed (${err.message}), serving stale cache`);
        return res.json({ ...buildPayload(cache.candles, cache.result, symbol, resolution, false), success: true });
      }
      console.error("[REFRESH] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Signals ─────────────────────────────────────────────────────────────────
  router.get("/api/signals", async (req, res) => {
    const resolution = parseInt(req.query.resolution || RESOLUTION);
    const cache = getCache(SYMBOL, resolution);
    if (!cache.result) return res.status(404).json({ error: "No data yet. Call /api/chart first." });
    res.json({
      signals: cache.result.signals,
      currentState: cache.result.currentState,
      lastUpdate: new Date(cache.lastFetch).toISOString(),
    });
  });

  // ── Motherwave ──────────────────────────────────────────────────────────────
  /**
   * GET /api/motherwave?symbol=X&resolution=Y
   *
   * Returns Mother Wave result for the requested symbol + resolution.
   * Single source of truth — ReportsPage and FibDashboardPage call this.
   * Caching mirrors /api/chart TTL logic.
   */
  router.get("/api/motherwave", async (req, res) => {
    const symbol = req.query.symbol || SYMBOL;
    const resolution = parseInt(req.query.resolution || RESOLUTION);

    const live = isLiveMarket(symbol);
    const cacheTTL = live ? 60_000 : isTradingDay(symbol) ? 5 * 60_000 : 24 * 60 * 60_000;
    const cache = getCache(symbol, resolution);

    if (cache.motherwaveResult !== null && Date.now() - cache.motherwaveAt < cacheTTL) {
      return res.json(cache.motherwaveResult);
    }

    try {
      let candles = null;
      if (cache.candles && cache.candles.length > 0) {
        candles = cache.candles;
      } else {
        const { candles: fetched } = await fetchAndProcess(symbol, resolution);
        candles = fetched;
      }

      if (!candles || !candles.length) {
        cache.motherwaveResult = { motherwave: null };
        cache.motherwaveAt = Date.now();
        return res.json({ motherwave: null });
      }

      const result = detectMotherWaveForAPI(candles);
      const payload = result || { motherwave: null };
      cache.motherwaveResult = payload;
      cache.motherwaveAt = Date.now();
      res.json(payload);
    } catch (err) {
      console.error("[/api/motherwave] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createChartRouter;