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
   * Single endpoint for all chart data. Backend decides whether to serve from
   * cache or re-fetch from Fyers based on symbol-aware TTL:
   *   Live market  : 60s
   *   Weekday/off  : 5min
   *   Weekend/off  : 24hr (MCX Sat treated as weekday for MCX symbols)
   */
  router.get("/api/chart", async (req, res) => {
    const symbol = req.query.symbol || SYMBOL;
    const resolution = parseInt(req.query.resolution || RESOLUTION);
    const cache = getCache(symbol, resolution);

    const live = isLiveMarket(symbol);
    const tradingDay = isTradingDay(symbol);
    const cacheTTL = live ? 60_000 : tradingDay ? 5 * 60_000 : 24 * 60 * 60_000;

    if (cache.result && cache.candles.length > 0 && Date.now() - cache.lastFetch < cacheTTL) {
      return res.json(buildPayload(cache.candles, cache.result, symbol, resolution));
    }
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