// strategy.js
const { attachEMA } = require("./ema");
const logger = require("./utils/logger");
const moment = require("moment-timezone");

const IST = "Asia/Kolkata";

const STATE = {
  INIT: "INIT",
  TRACKING_HIGH: "TRACKING_HIGH",
  TRACKING_LOW: "TRACKING_LOW",
};

const symbolStates = new Map();

function getInitialState() {
  return { state: STATE.INIT, firstPrinted: false, tempPrice: null, tempTs: null, lastProcessedTs: null };
}

function resetSymbol(symbol) { symbolStates.set(symbol, getInitialState()); }
function resetAll() { symbolStates.clear(); logger.info("🔄 All states reset."); }
function getState(symbol) { return symbolStates.get(symbol) || null; }

/**
 * processSymbol — stateless replay for a given date.
 *
 * BOTH-CROSS RULE (updated):
 *   If a candle HIGH > ema9High AND LOW < ema9Low (big candle touching both EMAs):
 *   — Confirm the currently pending NH/NL immediately
 *   — Reset state; then on the VERY NEXT candle:
 *       * If next candle HIGH > ema9High → TRACKING_HIGH
 *       * If next candle LOW  < ema9Low  → TRACKING_LOW
 *   (the big candle itself does NOT create a bubble — only next candle starts tracking)
 */
function processSymbol(symbol, rawCandles, targetDate) {
  if (!rawCandles || rawCandles.length === 0) return [];
  const target = targetDate || moment().tz(IST).format("YYYY-MM-DD");

  try {
    const candles = attachEMA(rawCandles);
    const st = getInitialState();
    let afterBothCross = false;
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

      // ── STEP 1: First candle ─────────────────────────────────────────────
      if (!st.firstPrinted) {
        signals.push({ symbol, type: "FIRST_HIGH", price: high, ts });
        signals.push({ symbol, type: "FIRST_LOW", price: low, ts });
        st.firstPrinted = true;
        if (isLast) {
          signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
          signals.push({ symbol, type: "LAST_LOW", price: low, ts });
        }
        continue;
      }

      // ── STEP 2: EMA not warm yet ─────────────────────────────────────────
      if (ema9High == null || ema9Low == null) {
        if (isLast) {
          signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
          signals.push({ symbol, type: "LAST_LOW", price: low, ts });
        }
        continue;
      }

      const crossesHigh = high > ema9High;
      const crossesLow = low < ema9Low;
      const bothCross = crossesHigh && crossesLow;

      // ── STEP 3: Candle immediately after a both-cross ────────────────────
      if (afterBothCross) {
        afterBothCross = false;
        if (bothCross) {
          // Another both-cross — confirm pending if any, wait again
          if (st.state === STATE.TRACKING_HIGH) {
            signals.push({ symbol, type: "NEW_HIGH", price: st.tempPrice, ts: st.tempTs });
          } else if (st.state === STATE.TRACKING_LOW) {
            signals.push({ symbol, type: "NEW_LOW", price: st.tempPrice, ts: st.tempTs });
          }
          st.state = STATE.INIT;
          st.tempPrice = null; st.tempTs = null;
          afterBothCross = true;
        } else if (crossesHigh) {
          st.tempPrice = high; st.tempTs = ts;
          st.state = STATE.TRACKING_HIGH;
          logger.debug(`📊 ${symbol} [${timeStr}] post-both-cross → TRACKING_HIGH @ ${high}`);
        } else if (crossesLow) {
          st.tempPrice = low; st.tempTs = ts;
          st.state = STATE.TRACKING_LOW;
          logger.debug(`📊 ${symbol} [${timeStr}] post-both-cross → TRACKING_LOW @ ${low}`);
        } else {
          st.state = STATE.INIT;
          st.tempPrice = null; st.tempTs = null;
        }
        if (isLast) {
          signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
          signals.push({ symbol, type: "LAST_LOW", price: low, ts });
        }
        continue;
      }

      // ── STEP 4: INIT ─────────────────────────────────────────────────────
      if (st.state === STATE.INIT) {
        if (bothCross) {
          afterBothCross = true;
        } else if (crossesHigh) {
          st.tempPrice = high; st.tempTs = ts;
          st.state = STATE.TRACKING_HIGH;
        } else if (crossesLow) {
          st.tempPrice = low; st.tempTs = ts;
          st.state = STATE.TRACKING_LOW;
        }
        if (isLast) {
          signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
          signals.push({ symbol, type: "LAST_LOW", price: low, ts });
        }
        continue;
      }

      // ── STEP 5: TRACKING_HIGH ────────────────────────────────────────────
      if (st.state === STATE.TRACKING_HIGH) {
        if (bothCross) {
          logger.debug(`📊 ${symbol} [${timeStr}] ✅ NEW_HIGH confirmed by both-cross @ ${st.tempPrice}`);
          signals.push({ symbol, type: "NEW_HIGH", price: st.tempPrice, ts: st.tempTs });
          st.state = STATE.INIT;
          st.tempPrice = null; st.tempTs = null;
          afterBothCross = true;
          if (isLast) {
            signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
            signals.push({ symbol, type: "LAST_LOW", price: low, ts });
          }
          continue;
        }

        if (crossesHigh && high >= st.tempPrice) {
          st.tempPrice = high; st.tempTs = ts;
        }

        if (crossesLow) {
          logger.debug(`📊 ${symbol} [${timeStr}] ✅ NEW_HIGH confirmed @ ${st.tempPrice}`);
          signals.push({ symbol, type: "NEW_HIGH", price: st.tempPrice, ts: st.tempTs });
          st.tempPrice = low; st.tempTs = ts;
          st.state = STATE.TRACKING_LOW;
          if (isLast) {
            signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
            signals.push({ symbol, type: "LAST_LOW", price: low, ts });
          }
          continue;
        }

        if (isLast) {
          signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
          signals.push({ symbol, type: "LAST_LOW", price: low, ts });
        }
        continue;
      }

      // ── STEP 6: TRACKING_LOW ─────────────────────────────────────────────
      if (st.state === STATE.TRACKING_LOW) {
        if (bothCross) {
          logger.debug(`📊 ${symbol} [${timeStr}] ✅ NEW_LOW confirmed by both-cross @ ${st.tempPrice}`);
          signals.push({ symbol, type: "NEW_LOW", price: st.tempPrice, ts: st.tempTs });
          st.state = STATE.INIT;
          st.tempPrice = null; st.tempTs = null;
          afterBothCross = true;
          if (isLast) {
            signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
            signals.push({ symbol, type: "LAST_LOW", price: low, ts });
          }
          continue;
        }

        if (crossesLow && low <= st.tempPrice) {
          st.tempPrice = low; st.tempTs = ts;
        }

        if (crossesHigh) {
          logger.debug(`📊 ${symbol} [${timeStr}] ✅ NEW_LOW confirmed @ ${st.tempPrice}`);
          signals.push({ symbol, type: "NEW_LOW", price: st.tempPrice, ts: st.tempTs });
          st.tempPrice = high; st.tempTs = ts;
          st.state = STATE.TRACKING_HIGH;
          if (isLast) {
            signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
            signals.push({ symbol, type: "LAST_LOW", price: low, ts });
          }
          continue;
        }

        if (isLast) {
          signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
          signals.push({ symbol, type: "LAST_LOW", price: low, ts });
        }
        continue;
      }
    }

    const sigTypes = signals
      .map(s => s.type)
      .filter(t => !["LAST_HIGH", "LAST_LOW", "FIRST_HIGH", "FIRST_LOW"].includes(t));
    if (sigTypes.length > 0) {
      logger.debug(`📊 ${symbol} signals: ${sigTypes.join(" → ")}`);
    }

    return signals;
  } catch (err) {
    logger.error(`❌ Strategy error [${symbol}]: ${err.message}`);
    return [];
  }
}

module.exports = { processSymbol, resetSymbol, resetAll, getState, STATE };