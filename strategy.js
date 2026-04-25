// strategy.js — EMA9 NH/NL Tracker (exact port of Pine Script v2)
//
// CONDITIONS IN PLAIN WORDS:
//
// touchHigh = candle high >= EMA9High
// touchLow  = candle low  <= EMA9Low
// touchBoth = touchHigh AND touchLow
//
// STATE 0 (WAITING):
//   touchHigh only       → state=1,  prevState=1,  bestHigh = this high
//   touchLow only        → state=-1, prevState=-1, bestLow  = this low
//   touchBoth            → use prevState to decide:
//                            prevState=1  → state=1,  bestHigh = this high
//                            prevState=-1 → state=-1, bestLow  = this low
//                            prevState=0  → do nothing, stay 0
//   neither              → stay 0
//
// STATE 1 (TRACK HIGH) — two independent if-blocks, BOTH run on same candle:
//   Block A: touchHigh AND NOT touchLow → update bestHigh if high > bestHigh (or na)
//   Block B: touchLow (any — even if touchHigh also true):
//              → emit NH at bestBar
//              → lastNH = bestPrice
//              → state=0, bestPrice=na, bestBar=na
//
// STATE -1 (TRACK LOW) — two independent if-blocks, BOTH run on same candle:
//   Block A: touchLow AND NOT touchHigh → update bestLow if low < bestLow (or na)
//   Block B: touchHigh (any — even if touchLow also true):
//              → emit NL at bestBar
//              → lastNL = bestPrice
//              → state=0, bestPrice=na, bestBar=na
//
// BC CONDITION (runs every bar, independent of state):
//   high > lastNH → emit BC_HIGH at this candle
//   low  < lastNL → emit BC_LOW  at this candle
//   Both can fire on same candle
//
// KEY POINTS:
//   1. After NH → goes to WAITING (state 0). Does NOT jump to state -1.
//   2. After NL → goes to WAITING (state 0). Does NOT jump to state 1.
//   3. touchBoth in WAITING uses prevState (memory of last direction).
//      If prevState is still 0 (never moved) → do nothing.
//   4. Block A and Block B in state 1 and -1 are independent.
//      On a touchBoth candle while in state 1:
//        Block A does nothing (requires !touchLow)
//        Block B fires (touchLow is true) → confirm NH
//   5. prevState is only updated when entering state 1 or state -1.
//      It is never reset to 0, so it always remembers the last real direction.

const { attachEMA } = require("./ema");
const logger = require("./utils/logger");
const moment = require("moment-timezone");

const IST = "Asia/Kolkata";

function getInitialState() {
  return {
    state: 0,   // 0=WAIT, 1=TRACK HIGH, -1=TRACK LOW
    prevState: 0,   // remembers last direction for touchBoth in WAITING
    bestPrice: null,
    bestTs: null,
    lastNH: null, // price of last confirmed NH (for BC check)
    lastNL: null, // price of last confirmed NL (for BC check)
    firstPrinted: false,
  };
}

const symbolStates = new Map();
function resetSymbol(symbol) { symbolStates.set(symbol, getInitialState()); }
function resetAll() { symbolStates.clear(); logger.info("All states reset."); }
function getState(symbol) { return symbolStates.get(symbol) || null; }

function processSymbol(symbol, rawCandles, targetDate) {
  if (!rawCandles || rawCandles.length === 0) return [];
  const target = targetDate || moment().tz(IST).format("YYYY-MM-DD");

  try {
    const candles = attachEMA(rawCandles);
    const st = getInitialState();
    const signals = [];

    const dayCandles = candles.filter(c =>
      moment.unix(c.ts).tz(IST).format("YYYY-MM-DD") === target
    );
    if (dayCandles.length === 0) return [];

    for (let i = 0; i < dayCandles.length; i++) {
      const c = dayCandles[i];
      const { high, low, ts, ema9High, ema9Low } = c;
      const isLast = i === dayCandles.length - 1;
      const timeStr = moment.unix(ts).tz(IST).format("HH:mm");

      // ── FIRST CANDLE: record FH/FL for sidebar ───────────────────────────
      if (!st.firstPrinted) {
        signals.push({ symbol, type: "FIRST_HIGH", price: high, ts });
        signals.push({ symbol, type: "FIRST_LOW", price: low, ts });
        st.firstPrinted = true;
      }

      // ── EMA not ready: skip state logic ─────────────────────────────────
      if (ema9High == null || ema9Low == null) {
        if (isLast) {
          signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
          signals.push({ symbol, type: "LAST_LOW", price: low, ts });
        }
        continue;
      }

      // ── Candle conditions (mirrors Pine Script exactly) ──────────────────
      const touchHigh = high >= ema9High;
      const touchLow = low <= ema9Low;
      const touchBoth = touchHigh && touchLow;

      // ── STATE 0: WAITING ─────────────────────────────────────────────────
      if (st.state === 0) {
        if (touchHigh && !touchLow) {
          st.state = 1; st.prevState = 1;
          st.bestPrice = high; st.bestTs = ts;
          logger.debug(`${symbol} [${timeStr}] WAIT → state 1, bestHigh=${high}`);

        } else if (touchLow && !touchHigh) {
          st.state = -1; st.prevState = -1;
          st.bestPrice = low; st.bestTs = ts;
          logger.debug(`${symbol} [${timeStr}] WAIT → state -1, bestLow=${low}`);

        } else if (touchBoth) {
          if (st.prevState === 1) {
            st.state = 1;
            st.bestPrice = high; st.bestTs = ts;
            logger.debug(`${symbol} [${timeStr}] WAIT touchBoth prevState=1 → state 1, bestHigh=${high}`);
          } else if (st.prevState === -1) {
            st.state = -1;
            st.bestPrice = low; st.bestTs = ts;
            logger.debug(`${symbol} [${timeStr}] WAIT touchBoth prevState=-1 → state -1, bestLow=${low}`);
          }
          // prevState === 0 → do nothing, stay WAITING
        }
        // neither → stay WAITING
      }

      // ── STATE 1: TRACK HIGH ──────────────────────────────────────────────
      // Block A and Block B are independent — both checked on same candle
      if (st.state === 1) {

        // Block A: touchHigh only → update bestHigh
        if (touchHigh && !touchLow) {
          if (st.bestPrice === null || high > st.bestPrice) {
            st.bestPrice = high; st.bestTs = ts;
            logger.debug(`${symbol} [${timeStr}] state 1 update bestHigh=${high}`);
          }
        }

        // Block B: touchLow (any) → confirm NH, go to WAITING
        if (touchLow) {
          if (st.bestPrice !== null) {
            logger.debug(`${symbol} [${timeStr}] CONFIRM NH @ ${st.bestPrice} (bar ${moment.unix(st.bestTs).tz(IST).format("HH:mm")})`);
            signals.push({ symbol, type: "NEW_HIGH", price: st.bestPrice, ts: st.bestTs });
            st.lastNH = st.bestPrice;
          }
          st.state = 0;
          st.bestPrice = null; st.bestTs = null;
          logger.debug(`${symbol} [${timeStr}] → state 0 (WAITING)`);
        }
      }

      // ── STATE -1: TRACK LOW ──────────────────────────────────────────────
      // Block A and Block B are independent — both checked on same candle
      if (st.state === -1) {

        // Block A: touchLow only → update bestLow
        if (touchLow && !touchHigh) {
          if (st.bestPrice === null || low < st.bestPrice) {
            st.bestPrice = low; st.bestTs = ts;
            logger.debug(`${symbol} [${timeStr}] state -1 update bestLow=${low}`);
          }
        }

        // Block B: touchHigh (any) → confirm NL, go to WAITING
        if (touchHigh) {
          if (st.bestPrice !== null) {
            logger.debug(`${symbol} [${timeStr}] CONFIRM NL @ ${st.bestPrice} (bar ${moment.unix(st.bestTs).tz(IST).format("HH:mm")})`);
            signals.push({ symbol, type: "NEW_LOW", price: st.bestPrice, ts: st.bestTs });
            st.lastNL = st.bestPrice;
          }
          st.state = 0;
          st.bestPrice = null; st.bestTs = null;
          logger.debug(`${symbol} [${timeStr}] → state 0 (WAITING)`);
        }
      }

      // ── BC CONDITION: runs every bar, independent of state ───────────────
      if (st.lastNH !== null && high > st.lastNH) {
        signals.push({ symbol, type: "BC_HIGH", price: high, ts });
        logger.debug(`${symbol} [${timeStr}] BC_HIGH: high ${high} > lastNH ${st.lastNH}`);
      }
      if (st.lastNL !== null && low < st.lastNL) {
        signals.push({ symbol, type: "BC_LOW", price: low, ts });
        logger.debug(`${symbol} [${timeStr}] BC_LOW: low ${low} < lastNL ${st.lastNL}`);
      }

      // ── LAST CANDLE: emit LH/LL for chart rightmost marker ───────────────
      if (isLast) {
        signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
        signals.push({ symbol, type: "LAST_LOW", price: low, ts });
      }
    }

    const tracked = signals.map(s => s.type)
      .filter(t => !["LAST_HIGH", "LAST_LOW", "FIRST_HIGH", "FIRST_LOW"].includes(t));
    if (tracked.length > 0) logger.debug(`${symbol} → ${tracked.join(" → ")}`);

    return signals;
  } catch (err) {
    logger.error(`Strategy error [${symbol}]: ${err.message}`);
    return [];
  }
}

module.exports = { processSymbol, resetSymbol, resetAll, getState };