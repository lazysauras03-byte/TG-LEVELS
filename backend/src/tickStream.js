/**
 * tickStream.js
 * ─────────────────────────────────────────────────────────────────
 * Manages the Fyers WebSocket data socket connection.
 *
 * Fyers SDK v3 API (confirmed from source):
 *   - fyersDataSocket.getInstance(accessToken, logPath, loggingFlag)
 *     Singleton getter. accessToken MUST be "appId:token" format.
 *   - skt.connect()          — NO arguments (token already in getInstance)
 *   - skt.subscribe([sym1])  — flat array of symbol STRINGS, not objects
 *   - skt.autoreconnect(n)   — call BEFORE connect()
 *   - skt.mode(skt.LiteMode) — FASTEST: sends tick immediately on every
 *                               price change (LTP + change only).
 *                               FullMode batches data → causes ~30s candle delay.
 *   - skt.on('connect' | 'message' | 'error' | 'close', fn)
 *
 * MODE CHOICE:
 *   LiteMode  → fields: symbol, ltp, ch, chp, tt
 *               fires on EVERY price change — tick-by-tick, <1s latency
 *   FullMode  → adds OHLC, volume, bid/ask depth
 *               Fyers batches these → candle appears ~30s after minute closes
 *
 *   We use LiteMode for real-time candle updates. The OHLC fields we get
 *   from REST history (seedHistory) and from our own CandleBuilder logic.
 *
 * SINGLETON NOTE: fyersDataSocket caches the instance internally.
 * To reconnect with a new token, call close() then re-call getInstance().
 *
 * Usage:
 *   const ts = new TickStream();
 *   ts.on('tick', ({ symbol, ltp, timestamp }) => { ... });
 *   ts.start(['NSE:NIFTY50-INDEX']);
 *   ts.stop();
 * ─────────────────────────────────────────────────────────────────
 */

"use strict";

const EventEmitter = require("events");
const { fyersDataSocket } = require("fyers-api-v3");
const { loadToken } = require("./fyers");

// Market hours IST (9:15 – 15:30)
const MARKET_OPEN = { h: 9, m: 15 };
const MARKET_CLOSE = { h: 15, m: 30 };

const RECONNECT_DELAY_MS = 3000;   // Faster first reconnect (was 5000)
const MAX_RECONNECT = 10;

// Fyers SDK logging — empty path = no file logs, false = SDK silent
const FYERS_LOG_PATH = "";
const FYERS_LOGGING = false;

function nowIST() {
  const d = new Date();
  const istMs = d.getTime() + 5.5 * 3600 * 1000;
  const ist = new Date(istMs);
  return { h: ist.getUTCHours(), m: ist.getUTCMinutes() };
}

function isMarketOpen() {
  const { h, m } = nowIST();
  const mins = h * 60 + m;
  const open = MARKET_OPEN.h * 60 + MARKET_OPEN.m;
  const close = MARKET_CLOSE.h * 60 + MARKET_CLOSE.m;
  return mins >= open && mins < close;
}

class TickStream extends EventEmitter {
  constructor() {
    super();
    this._socket = null;
    this._symbols = [];
    this._running = false;
    this._reconnects = 0;
    this._reconnTimer = null;
    this._userStopped = false;
    this._lastTickTime = 0;   // for gap diagnostics
  }

  /** Start streaming ticks for the given symbols. */
  start(symbols) {
    if (!symbols || symbols.length === 0) {
      console.warn("[TickStream] No symbols provided — not starting.");
      return;
    }
    this._symbols = symbols;
    this._userStopped = false;
    this._running = true;
    this._reconnects = 0;
    this._connect();
  }

  /** Stop the stream and clean up. */
  stop() {
    this._userStopped = true;
    this._running = false;
    if (this._reconnTimer) {
      clearTimeout(this._reconnTimer);
      this._reconnTimer = null;
    }
    this._disconnect();
  }

  /**
   * Change the subscribed symbol set without fully restarting.
   * @param {string[]} symbols
   */
  setSymbols(symbols) {
    this._symbols = symbols;
    if (this._socket && this._running) {
      try {
        this._socket.subscribe(this._symbols);
        console.log(`[TickStream] Re-subscribed to: ${symbols.join(", ")}`);
      } catch (err) {
        console.error("[TickStream] Re-subscribe failed:", err.message);
      }
    }
  }

  isConnected() {
    return this._running && this._socket != null;
  }

  // ── Private ────────────────────────────────────────────────────

  _connect() {
    const token = loadToken();
    if (!token) {
      console.warn("[TickStream] No access token — cannot start WebSocket.");
      return;
    }

    const appId = process.env.APP_ID;
    if (!appId) {
      console.warn("[TickStream] APP_ID missing — cannot start WebSocket.");
      return;
    }

    try {
      const fullToken = `${appId}:${token}`;

      this._socket = fyersDataSocket.getInstance(
        fullToken,
        FYERS_LOG_PATH,
        FYERS_LOGGING
      );

      // ── KEY FIX: Set LiteMode BEFORE connect ─────────────────────
      // LiteMode fires a tick on EVERY price change with minimal delay (<1s).
      // FullMode (default) batches extra fields (OHLC, depth) and causes the
      // ~30 second delay visible in candle countdown (00:04 → restart from ~60).
      //
      // LiteMode tick fields: symbol, ltp, ch (change), chp (% change), tt (trade time)
      // CandleBuilder only needs ltp + tt — it derives OHLC from the tick stream.
      // ────────────────────────────────────────────────────────────
      if (this._socket.LiteMode !== undefined) {
        this._socket.mode(this._socket.LiteMode);
        console.log("[TickStream] Mode set to LiteMode (fastest tick delivery)");
      } else {
        console.warn("[TickStream] LiteMode not available on this SDK version — using default mode");
      }

      // autoreconnect() MUST be called before connect()
      // Handle both SDK casing variants (autoreconnect vs autoReconnect)
      if (typeof this._socket.autoReconnect === "function") {
        this._socket.autoReconnect(MAX_RECONNECT);
      } else {
        this._socket.autoreconnect(MAX_RECONNECT);
      }

      this._socket.on("connect", () => this._onConnect());
      this._socket.on("message", (msg) => this._onMessage(msg));
      this._socket.on("error", (err) => this._onError(err));
      this._socket.on("close", () => this._onClose());

      // connect() takes NO arguments — token is stored in getInstance()
      this._socket.connect();

      console.log("[TickStream] Connecting to Fyers data socket (LiteMode)…");
    } catch (err) {
      console.error("[TickStream] Connect error:", err.message);
      this._scheduleReconnect();
    }
  }

  _disconnect() {
    if (this._socket) {
      try { this._socket.close(); } catch { /* ignore */ }
      this._socket = null;
    }
  }

  _onConnect() {
    this._reconnects = 0;
    console.log(`[TickStream] Connected ✓ Subscribing to: ${this._symbols.join(", ")}`);
    try {
      // subscribe() takes a flat string array only.
      // Do NOT pass a second `true` arg (market depth) — that forces FullMode.
      this._socket.subscribe(this._symbols);
    } catch (err) {
      console.error("[TickStream] Subscribe failed:", err.message);
    }
    this.emit("connected");
  }

  _onMessage(msg) {
    try {
      if (!msg) return;
      const ticks = Array.isArray(msg) ? msg : [msg];

      for (const tick of ticks) {
        if (!tick || tick.ltp == null) continue;

        const symbol = tick.symbol || this._symbols[0];
        if (!symbol) continue;

        // LiteMode fields: symbol, ltp, tt, ch, chp
        // FullMode adds: open_price, high_price, low_price, vol_traded_today etc.
        // Use tt (trade time) for exchange-accurate candle alignment.
        const timestamp = tick.tt || tick.timestamp || Math.floor(Date.now() / 1000);

        // Diagnostic: log tick gaps > 5s during market hours
        const now = Date.now();
        if (this._lastTickTime && isMarketOpen()) {
          const gapMs = now - this._lastTickTime;
          if (gapMs > 5000) {
            console.warn(`[TickStream] Tick gap: ${(gapMs / 1000).toFixed(1)}s for ${symbol}`);
          }
        }
        this._lastTickTime = now;

        this.emit("tick", {
          symbol,
          ltp: Number(tick.ltp),
          timestamp: Number(timestamp),    // epoch seconds
          // These will be undefined in LiteMode — CandleBuilder handles that gracefully
          open: tick.open_price ?? tick.open,
          high: tick.high_price ?? tick.high,
          low: tick.low_price ?? tick.low,
          prev_close: tick.prev_close_price,
          vol: tick.vol_traded_today,
        });
      }
    } catch (err) {
      console.error("[TickStream] Message parse error:", err.message);
    }
  }

  _onError(err) {
    console.error("[TickStream] Socket error:", err?.message || err);
    this.emit("error", err);
  }

  _onClose() {
    console.log("[TickStream] Socket closed.");
    this.emit("disconnected");
    if (!this._userStopped && this._running) {
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this._userStopped) return;
    if (this._reconnects >= MAX_RECONNECT) {
      console.warn("[TickStream] Max reconnects reached — giving up.");
      this._running = false;
      return;
    }
    this._reconnects++;
    // Exponential backoff: 3s, 6s, 9s, 12s, 15s (capped)
    const delay = RECONNECT_DELAY_MS * Math.min(this._reconnects, 5);
    console.log(`[TickStream] Reconnecting in ${delay / 1000}s (attempt ${this._reconnects})…`);
    this._reconnTimer = setTimeout(() => {
      this._disconnect();
      this._connect();
    }, delay);
  }
}

module.exports = { TickStream, isMarketOpen };