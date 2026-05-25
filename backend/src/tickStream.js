/**
 * tickStream.js
 * ─────────────────────────────────────────────────────────────────
 * Manages the Fyers WebSocket data socket connection.
 *
 * THREE market state helpers (exported):
 *
 *   isLiveMarket()  — TRUE only Mon–Fri 09:15–15:30 IST
 *                     ONLY condition under which the tick stream runs.
 *
 *   isTradingDay()  — TRUE on Mon–Fri regardless of time.
 *                     Used for cache TTL and REST poll decisions.
 *
 *   isMarketOpen()  — Alias for isLiveMarket(). Kept for back-compat.
 *
 * RULE:
 *   Tick stream (WebSocket) → only when isLiveMarket() is true
 *   REST fetch / cache      → always works, any time, any day
 * ─────────────────────────────────────────────────────────────────
 */

"use strict";

const EventEmitter = require("events");
const { fyersDataSocket } = require("fyers-api-v3");
const { loadToken } = require("./fyers");

// Market hours IST
const MARKET_OPEN_MIN = 9 * 60 + 15;   // 555  — NSE/BSE open
const MARKET_CLOSE_MIN = 15 * 60 + 30;  // 930  — NSE/BSE close
const MCX_CLOSE_MIN = 23 * 60 + 30;  // 1410 — MCX/commodity close

/** Returns true if the symbol belongs to MCX (commodity exchange). */
function isMCXSymbol(symbol) {
  if (!symbol) return false;
  return String(symbol).toUpperCase().startsWith("MCX:");
}

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT = 10;

const FYERS_LOG_PATH = "";
const FYERS_LOGGING = false;

// ── IST helpers ───────────────────────────────────────────────────────────────
function nowIST() {
  const d = new Date();
  const istMs = d.getTime() + 5.5 * 3600 * 1000;
  const ist = new Date(istMs);
  const h = ist.getUTCHours();
  const m = ist.getUTCMinutes();
  const dow = ist.getUTCDay();     // 0=Sun … 6=Sat
  const mins = h * 60 + m;
  return { h, m, mins, dow };
}

/**
 * isLiveMarket — Mon–Fri AND within market hours IST.
 *   • NSE/BSE symbols  : 09:15 – 15:30
 *   • MCX symbols      : 09:00 – 23:30
 * Pass `symbol` to get the correct hours for that exchange.
 */
function isLiveMarket(symbol) {
  const { mins, dow } = nowIST();
  if (dow === 0 || dow === 6) return false;    // weekend
  const closeMin = isMCXSymbol(symbol) ? MCX_CLOSE_MIN : MARKET_CLOSE_MIN;
  return mins >= MARKET_OPEN_MIN && mins < closeMin;
}

/**
 * isAnyMarketLive — true if ANY watched market is currently live.
 * Used to decide whether the tick stream should stay running.
 */
function isAnyMarketLive(symbols) {
  if (!symbols || symbols.length === 0) return isLiveMarket();
  return symbols.some((s) => isLiveMarket(s));
}

/**
 * isTradingDay — Mon–Fri regardless of time.
 * REST fetches and cache TTL decisions use this.
 * Does NOT mean the market is currently live.
 */
function isTradingDay() {
  const { dow } = nowIST();
  return dow !== 0 && dow !== 6;
}

/**
 * isMarketOpen — back-compat alias for isLiveMarket().
 */
const isMarketOpen = isLiveMarket;

// ── TickStream ────────────────────────────────────────────────────────────────
class TickStream extends EventEmitter {
  constructor() {
    super();
    this._socket = null;
    this._symbols = [];
    this._running = false;
    this._reconnects = 0;
    this._reconnTimer = null;
    this._userStopped = false;
    this._lastTickTime = 0;
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

  /** Change the subscribed symbol set without fully restarting. */
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

  // ── Private ───────────────────────────────────────────────────────────────

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
      this._socket = fyersDataSocket.getInstance(fullToken, FYERS_LOG_PATH, FYERS_LOGGING);

      // LiteMode: fires a tick on EVERY price change (<1s latency).
      // FullMode: batches OHLC/depth → causes ~30s candle delay.
      if (this._socket.LiteMode !== undefined) {
        this._socket.mode(this._socket.LiteMode);
        console.log("[TickStream] Mode set to LiteMode (fastest tick delivery)");
      } else {
        console.warn("[TickStream] LiteMode not available — using default mode");
      }

      // autoreconnect() MUST be called before connect()
      if (typeof this._socket.autoReconnect === "function") {
        this._socket.autoReconnect(MAX_RECONNECT);
      } else {
        this._socket.autoreconnect(MAX_RECONNECT);
      }

      this._socket.on("connect", () => this._onConnect());
      this._socket.on("message", (msg) => this._onMessage(msg));
      this._socket.on("error", (err) => this._onError(err));
      this._socket.on("close", () => this._onClose());

      // connect() takes NO arguments — token is in getInstance()
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
      // Do NOT pass a second `true` arg (market depth) — forces FullMode.
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
        const timestamp = tick.tt || tick.timestamp || Math.floor(Date.now() / 1000);

        // Warn on tick gaps during live hours
        const now = Date.now();
        if (this._lastTickTime && isLiveMarket(symbol)) {
          const gapMs = now - this._lastTickTime;
          if (gapMs > 5000) {
            console.warn(`[TickStream] Tick gap: ${(gapMs / 1000).toFixed(1)}s for ${symbol}`);
          }
        }
        this._lastTickTime = now;

        this.emit("tick", {
          symbol,
          ltp: Number(tick.ltp),
          timestamp: Number(timestamp),     // epoch seconds
          // undefined in LiteMode — CandleBuilder handles gracefully
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

module.exports = { TickStream, isMarketOpen, isLiveMarket, isAnyMarketLive, isMCXSymbol, isTradingDay };