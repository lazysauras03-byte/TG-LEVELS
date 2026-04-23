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
function resetAll() { symbolStates.clear(); logger.info("🔄 All states reset."); }
function getState(symbol) { return symbolStates.get(symbol) || null; }

/**
 * processSymbol — stateless replay for a given date.
 *
 * Works on candles of ANY timeframe (1m, 3m, 5m, 15m, 60m, D).
 * rawCandles must already be at the desired timeframe — no resampling here.
 *
 * BOTH-CROSS RULE:
 *   If a single candle's HIGH > ema9High AND LOW < ema9Low:
 *   — Confirm the pending temp signal immediately (the opposite-direction cross)
 *   — Then ALSO mark the same candle's own cross (both directions get a bubble)
 *
 * CROSS DEFINITION: high > ema9High (candle high strictly above EMA9 of highs)
 *                   low  < ema9Low  (candle low  strictly below EMA9 of lows)
 */
function processSymbol(symbol, rawCandles, targetDate) {
  if (!rawCandles || rawCandles.length === 0) return [];
  const target = targetDate || moment().tz(IST).format("YYYY-MM-DD");

  try {
    // EMA is calculated across ALL candles so it's warm before today's first candle
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

      // ── STEP 1: First candle — emit FH/FL only, skip EMA logic ─────────────
      if (!st.firstPrinted) {
        signals.push({ symbol, type: "FIRST_HIGH", price: high, ts });
        signals.push({ symbol, type: "FIRST_LOW", price: low, ts });
        st.firstPrinted = true;
        logger.debug(`📊 ${symbol} [${timeStr}] FIRST candle H:${high} L:${low}`);
        if (isLast) {
          signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
          signals.push({ symbol, type: "LAST_LOW", price: low, ts });
        }
        continue;
      }

      // ── STEP 2: EMA not warm yet (shouldn't happen with multi-day fetch) ───
      if (ema9High == null || ema9Low == null) {
        if (isLast) {
          signals.push({ symbol, type: "LAST_HIGH", price: high, ts });
          signals.push({ symbol, type: "LAST_LOW", price: low, ts });
        }
        continue;
      }

      const crossesHigh = high > ema9High;   // candle high broke above EMA9 of highs
      const crossesLow = low < ema9Low;    // candle low broke below EMA9 of lows

      // ── STEP 3: INIT — find first cross ──────────────────────────────────
      if (st.state === STATE.INIT) {
        if (crossesHigh && crossesLow) {
          // Both crossed on same candle — start tracking whichever deviation is bigger
          if ((high - ema9High) >= (ema9Low - low)) {
            st.tempPrice = high; st.tempTs = ts;
            st.state = STATE.TRACKING_HIGH;
          } else {
            st.tempPrice = low; st.tempTs = ts;
            st.state = STATE.TRACKING_LOW;
          }
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

      // ── STEP 4: TRACKING_HIGH ────────────────────────────────────────────
      if (st.state === STATE.TRACKING_HIGH) {
        // Update tracked high if this candle is still above EMA9H and higher
        if (crossesHigh && high >= st.tempPrice) {
          st.tempPrice = high; st.tempTs = ts;
        }

        if (crossesLow) {
          // Opposite cross — confirm the pending NEW_HIGH
          logger.debug(`📊 ${symbol} [${timeStr}] ✅ NEW_HIGH confirmed @ ${st.tempPrice}`);
          signals.push({ symbol, type: "NEW_HIGH", price: st.tempPrice, ts: st.tempTs });

          // NOTE: Do NOT emit a second NH for this candle's high even if crossesHigh is true.
          // A candle cannot generate back-to-back NH — the low-cross confirms the NH, then
          // we switch to TRACKING_LOW from this candle's low.

          // Start tracking low from this candle
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
        // Update tracked low if this candle is still below EMA9L and lower
        if (crossesLow && low <= st.tempPrice) {
          st.tempPrice = low; st.tempTs = ts;
        }

        if (crossesHigh) {
          // Opposite cross — confirm the pending NEW_LOW
          logger.debug(`📊 ${symbol} [${timeStr}] ✅ NEW_LOW confirmed @ ${st.tempPrice}`);
          signals.push({ symbol, type: "NEW_LOW", price: st.tempPrice, ts: st.tempTs });

          // NOTE: Do NOT emit a second NL for this candle's low even if crossesLow is true.
          // A candle cannot generate back-to-back NL — the high-cross confirms the NL, then
          // we switch to TRACKING_HIGH from this candle's high.

          // Start tracking high from this candle
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