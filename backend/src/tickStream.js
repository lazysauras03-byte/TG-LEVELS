/**
 * tickStream.js
 * ─────────────────────────────────────────────────────────────────
 * Manages the Fyers WebSocket data socket connection.
 *
 * Responsibilities:
 *   - Connect to Fyers fyersDataSocket using access token + APP_ID
 *   - Subscribe to tick data for one or more symbols
 *   - Emit "tick" events to registered listeners
 *   - Auto-reconnect on disconnection during market hours
 *   - Gracefully disconnect outside market hours
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
const MARKET_OPEN  = { h: 9,  m: 15 };
const MARKET_CLOSE = { h: 15, m: 30 };

// Reconnect delay on unexpected disconnect
const RECONNECT_DELAY_MS = 5000;
// Max reconnect attempts before giving up
const MAX_RECONNECT      = 10;

function nowIST() {
  const d = new Date();
  // IST = UTC+5:30
  const istMs = d.getTime() + 5.5 * 3600 * 1000;
  const ist   = new Date(istMs);
  return { h: ist.getUTCHours(), m: ist.getUTCMinutes() };
}

function isMarketOpen() {
  const { h, m } = nowIST();
  const mins = h * 60 + m;
  const open  = MARKET_OPEN.h  * 60 + MARKET_OPEN.m;
  const close = MARKET_CLOSE.h * 60 + MARKET_CLOSE.m;
  return mins >= open && mins < close;
}

class TickStream extends EventEmitter {
  constructor() {
    super();
    this._socket      = null;
    this._symbols     = [];
    this._running     = false;
    this._reconnects  = 0;
    this._reconnTimer = null;
    this._userStopped = false;
  }

  /**
   * Start streaming ticks for the given symbols.
   * @param {string[]} symbols - Fyers symbol strings, e.g. ["NSE:NIFTY50-INDEX"]
   */
  start(symbols) {
    if (!symbols || symbols.length === 0) {
      console.warn("[TickStream] No symbols provided — not starting.");
      return;
    }
    this._symbols     = symbols;
    this._userStopped = false;
    this._running     = true;
    this._reconnects  = 0;
    this._connect();
  }

  /**
   * Stop the stream and clean up.
   */
  stop() {
    this._userStopped = true;
    this._running     = false;
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
        this._socket.subscribe(this._symbols.map((s) => ({ symbol: s, dataType: "symbolData" })));
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
      // fyersDataSocket is instantiated fresh each connection
      this._socket = new fyersDataSocket();

      // The Fyers SDK requires: appId-appSession format for the access token
      // access_token is already in "appId:token" format from fyers.js saveToken
      // But the data socket expects just the token prefixed with appId
      const fullToken = `${appId}:${token}`;

      this._socket.autoreconnect(MAX_RECONNECT);

      this._socket.on("connect",    () => this._onConnect());
      this._socket.on("message",    (msg) => this._onMessage(msg));
      this._socket.on("error",      (err) => this._onError(err));
      this._socket.on("close",      ()    => this._onClose());

      this._socket.connect(fullToken);

      console.log("[TickStream] Connecting to Fyers data socket…");
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
    console.log(`[TickStream] Connected. Subscribing to: ${this._symbols.join(", ")}`);
    try {
      this._socket.subscribe(
        this._symbols.map((s) => ({ symbol: s, dataType: "symbolData" }))
      );
    } catch (err) {
      console.error("[TickStream] Subscribe failed:", err.message);
    }
    this.emit("connected");
  }

  _onMessage(msg) {
    try {
      // Fyers data socket delivers: { symbol, ltp, timestamp, ... }
      if (!msg || !msg.symbol || msg.ltp == null) return;

      this.emit("tick", {
        symbol:    msg.symbol,
        ltp:       Number(msg.ltp),
        timestamp: msg.timestamp || Math.floor(Date.now() / 1000),
        // Extra market data fields (pass-through for future use)
        open:      msg.open_price,
        high:      msg.high_price,
        low:       msg.low_price,
        prev_close: msg.prev_close_price,
        vol:       msg.vol_traded_today,
      });
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
    const delay = RECONNECT_DELAY_MS * Math.min(this._reconnects, 4);
    console.log(`[TickStream] Reconnecting in ${delay / 1000}s (attempt ${this._reconnects})…`);
    this._reconnTimer = setTimeout(() => {
      this._disconnect();
      this._connect();
    }, delay);
  }
}

module.exports = { TickStream, isMarketOpen };
