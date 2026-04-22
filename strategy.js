// // strategy.js
// const { attachEMA } = require("./ema");
// const logger = require("./utils/logger");
// const moment = require("moment-timezone");

// const IST = "Asia/Kolkata";

// const STATE = {
//   INIT: "INIT",
//   TRACKING_HIGH: "TRACKING_HIGH",
//   TRACKING_LOW: "TRACKING_LOW",
// };

// const symbolStates = new Map();

// function getInitialState() {
//   return { state: STATE.INIT, firstPrinted: false, tempPrice: null, tempTs: null, lastProcessedTs: null };
// }

// function resetSymbol(symbol) { symbolStates.set(symbol, getInitialState()); }

// function resetAll() {
//   symbolStates.clear();
//   logger.info("🔄 All states reset.");
// }

// function getState(symbol) { return symbolStates.get(symbol) || null; }

// /**
//  * processSymbol — accepts optional targetDate so it works for any date
//  * @param {string} symbol
//  * @param {Array} rawCandles  — raw Fyers array [ts, open, high, low, close, vol]
//  * @param {string} targetDate — YYYY-MM-DD in IST (optional, defaults to today IST)
//  */
// function processSymbol(symbol, rawCandles, targetDate) {
//   if (!rawCandles || rawCandles.length === 0) return [];
//   const target = targetDate || moment().tz(IST).format("YYYY-MM-DD");

//   try {
//     const candles = attachEMA(rawCandles);

//     // Always start fresh for this date (stateless replay)
//     const st = getInitialState();
//     const signals = [];

//     // Filter to target date only (IST)
//     const dayCandles = candles.filter(c =>
//       moment.unix(c.ts).tz(IST).format("YYYY-MM-DD") === target
//     );

//     if (dayCandles.length === 0) return [];

//     const lastSeen = st.lastProcessedTs || 0;

//     for (let i = 0; i < dayCandles.length; i++) {
//       const c = dayCandles[i];
//       const { high, low, ts, ema9High, ema9Low } = c;
//       const isLast = i === dayCandles.length - 1;
//       const isNew = ts > lastSeen;

//       // STEP 1: First candle
//       if (!st.firstPrinted) {
//         signals.push({ symbol, type: "FIRST_HIGH", price: high, ts });
//         signals.push({ symbol, type: "FIRST_LOW",  price: low,  ts });
//         st.firstPrinted = true;
//         if (isLast) {
//           signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
//           signals.push({ symbol, type: "LAST_LOW",  price: low,  ts });
//         }
//         continue;
//       }

//       // STEP 2: EMA not warm yet
//       if (ema9High == null || ema9Low == null) {
//         if (isLast) {
//           signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
//           signals.push({ symbol, type: "LAST_LOW",  price: low,  ts });
//         }
//         continue;
//       }

//       const crossesHigh = high > ema9High;
//       const crossesLow  = low  < ema9Low;

//       // STEP 3: INIT — waiting for first EMA cross
//       if (st.state === STATE.INIT) {
//         if (crossesHigh && !crossesLow) {
//           st.tempPrice = high; st.tempTs = ts; st.state = STATE.TRACKING_HIGH;
//         } else if (crossesLow && !crossesHigh) {
//           st.tempPrice = low;  st.tempTs = ts; st.state = STATE.TRACKING_LOW;
//         } else if (crossesHigh && crossesLow) {
//           if ((high - ema9High) >= (ema9Low - low)) {
//             st.tempPrice = high; st.tempTs = ts; st.state = STATE.TRACKING_HIGH;
//           } else {
//             st.tempPrice = low;  st.tempTs = ts; st.state = STATE.TRACKING_LOW;
//           }
//         } else {
//           if (isLast) {
//             signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
//             signals.push({ symbol, type: "LAST_LOW",  price: low,  ts });
//           }
//           continue;
//         }
//       }

//       // STEP 4: TRACKING_HIGH
//       if (st.state === STATE.TRACKING_HIGH) {
//         if (crossesHigh && high >= st.tempPrice) {
//           st.tempPrice = high; st.tempTs = ts;
//         }
//         if (crossesLow) {
//           signals.push({ symbol, type: "NEW_HIGH", price: st.tempPrice, ts: st.tempTs });
//           st.tempPrice = low; st.tempTs = ts; st.state = STATE.TRACKING_LOW;
//           if (isLast) {
//             signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
//             signals.push({ symbol, type: "LAST_LOW",  price: low,  ts });
//           }
//           continue;
//         }
//         if (isLast) {
//           signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
//           signals.push({ symbol, type: "LAST_LOW",  price: low,  ts });
//         }
//         continue;
//       }

//       // STEP 5: TRACKING_LOW
//       if (st.state === STATE.TRACKING_LOW) {
//         if (crossesLow && low <= st.tempPrice) {
//           st.tempPrice = low; st.tempTs = ts;
//         }
//         if (crossesHigh) {
//           signals.push({ symbol, type: "NEW_LOW", price: st.tempPrice, ts: st.tempTs });
//           st.tempPrice = high; st.tempTs = ts; st.state = STATE.TRACKING_HIGH;
//           if (isLast) {
//             signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
//             signals.push({ symbol, type: "LAST_LOW",  price: low,  ts });
//           }
//           continue;
//         }
//         if (isLast) {
//           signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
//           signals.push({ symbol, type: "LAST_LOW",  price: low,  ts });
//         }
//         continue;
//       }
//     }

//     return signals;
//   } catch (err) {
//     logger.error(`❌ Strategy error [${symbol}]: ${err.message}`);
//     return [];
//   }
// }

// module.exports = { processSymbol, resetSymbol, resetAll, getState, STATE };


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

function resetAll() {
  symbolStates.clear();
  logger.info("🔄 All states reset.");
}

function getState(symbol) { return symbolStates.get(symbol) || null; }

/**
 * processSymbol — stateless replay for a given date.
 *
 * KEY FIX: Since we fetch 2 days of candles, EMA9 is already fully warmed
 * up from yesterday before the first candle of today. There is NO warm-up
 * period needed on the current day. The 09:15 candle itself is evaluated
 * for EMA crosses immediately after emitting FIRST_HIGH/LOW — so bubbles
 * appear correctly from the very first candle, including 09:18 NL / 09:24 NH.
 */
function processSymbol(symbol, rawCandles, targetDate) {
  if (!rawCandles || rawCandles.length === 0) return [];
  const target = targetDate || moment().tz(IST).format("YYYY-MM-DD");

  try {
    // EMA is calculated on ALL candles (including previous day) so it's
    // fully warm before today's first candle — no null values on today's candles
    const candles = attachEMA(rawCandles);
    const st = getInitialState();
    const signals = [];

    // Filter to target date only (IST)
    const dayCandles = candles.filter(c =>
      moment.unix(c.ts).tz(IST).format("YYYY-MM-DD") === target
    );

    if (dayCandles.length === 0) return [];

    for (let i = 0; i < dayCandles.length; i++) {
      const c = dayCandles[i];
      const { high, low, ts, ema9High, ema9Low } = c;
      const isLast = i === dayCandles.length - 1;
      const timeStr = moment.unix(ts).tz(IST).format("HH:mm");

      // ── STEP 1: First candle of the day ─────────────────────────────────
      // Emit FIRST_HIGH / FIRST_LOW only — real strategy starts from next candle
      if (!st.firstPrinted) {
        signals.push({ symbol, type: "FIRST_HIGH", price: high, ts });
        signals.push({ symbol, type: "FIRST_LOW", price: low, ts });
        st.firstPrinted = true;
        logger.debug(`📊 ${symbol} [${timeStr}] FIRST candle H:${high} L:${low}`);
        // Skip EMA cross logic for 09:15 — only FH/FL on the first candle
        if (isLast) {
          signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
          signals.push({ symbol, type: "LAST_LOW", price: low, ts });
        }
        continue; // ← this is the key fix
      }

      // ── STEP 2: Skip only if EMA genuinely not warm (shouldn't happen with 2-day fetch)
      if (ema9High == null || ema9Low == null) {
        logger.debug(`📊 ${symbol} [${timeStr}] EMA not ready (null) — skipping`);
        if (isLast) {
          signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
          signals.push({ symbol, type: "LAST_LOW", price: low, ts });
        }
        continue;
      }

      const crossesHigh = high > ema9High;
      const crossesLow = low < ema9Low;

      // ── STEP 3: INIT — find first cross ─────────────────────────────────
      // Always continue after INIT so STEP 4/5 never runs on the same candle
      // that triggered the state transition (prevents false immediate signals).
      if (st.state === STATE.INIT) {
        if (crossesHigh && !crossesLow) {
          st.tempPrice = high; st.tempTs = ts;
          st.state = STATE.TRACKING_HIGH;
          logger.debug(`📊 ${symbol} [${timeStr}] INIT→TRACKING_HIGH tempH:${high} ema9H:${ema9High.toFixed(2)}`);
        } else if (crossesLow && !crossesHigh) {
          st.tempPrice = low; st.tempTs = ts;
          st.state = STATE.TRACKING_LOW;
          logger.debug(`📊 ${symbol} [${timeStr}] INIT→TRACKING_LOW tempL:${low} ema9L:${ema9Low.toFixed(2)}`);
        } else if (crossesHigh && crossesLow) {
          // Both crossed — pick the bigger deviation
          if ((high - ema9High) >= (ema9Low - low)) {
            st.tempPrice = high; st.tempTs = ts;
            st.state = STATE.TRACKING_HIGH;
            logger.debug(`📊 ${symbol} [${timeStr}] INIT→TRACKING_HIGH (both cross, H wins) H:${high} L:${low}`);
          } else {
            st.tempPrice = low; st.tempTs = ts;
            st.state = STATE.TRACKING_LOW;
            logger.debug(`📊 ${symbol} [${timeStr}] INIT→TRACKING_LOW (both cross, L wins) H:${high} L:${low}`);
          }
        } else {
          logger.debug(`📊 ${symbol} [${timeStr}] INIT waiting... H:${high} ema9H:${ema9High?.toFixed(2)} L:${low} ema9L:${ema9Low?.toFixed(2)}`);
        }
        if (isLast) {
          signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
          signals.push({ symbol, type: "LAST_LOW", price: low, ts });
        }
        continue;
      }

      // ── STEP 4: TRACKING_HIGH ────────────────────────────────────────────
      if (st.state === STATE.TRACKING_HIGH) {
        if (crossesHigh && high >= st.tempPrice) {
          st.tempPrice = high; st.tempTs = ts;
          logger.debug(`📊 ${symbol} [${timeStr}] TRACKING_HIGH updated H:${high}`);
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

      // ── STEP 5: TRACKING_LOW ─────────────────────────────────────────────
      if (st.state === STATE.TRACKING_LOW) {
        if (crossesLow && low <= st.tempPrice) {
          st.tempPrice = low; st.tempTs = ts;
          logger.debug(`📊 ${symbol} [${timeStr}] TRACKING_LOW updated L:${low}`);
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