// fetchCandles.js
require("dotenv").config();
const moment = require("moment-timezone");
const { fyers } = require("./utils/fyersClient");
const logger = require("./utils/logger");

const IST = "Asia/Kolkata";
const DEFAULT_RESOLUTION = process.env.CANDLE_RESOLUTION || "3";
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;
const CACHE_TTL = 55 * 1000;

const candleCache = new Map();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isInvalidSymbolResponse(res) {
  if (!res) return false;
  if (res.s === "error" || res.s === "no_data") {
    const msg = (res.message || "").toLowerCase();
    return msg.includes("invalid") || msg.includes("no_data");
  }
  return false;
}

/**
 * Fetch candles from Fyers.
 * @param {string} symbol
 * @param {string} resolution - "1","3","5","15","60","D"
 * @param {number} days - calendar days back to fetch (default 35 = ~1 month)
 * @param {string} targetDate - YYYY-MM-DD in IST (default today IST)
 */
async function fetchCandles(symbol, resolution, days, targetDate) {
  const RESOLUTION = resolution || DEFAULT_RESOLUTION;
  // Minimum 7 days so EMA9 is always warm even after weekends/holidays
  const DAYS = Math.max(days || 7, 7);
  const TARGET = targetDate || moment().tz(IST).format("YYYY-MM-DD");

  const cacheKey = `${symbol}::${RESOLUTION}::${DAYS}::${TARGET}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached.candles;

  const rangeFrom = moment.tz(TARGET, IST).subtract(DAYS, "days").format("YYYY-MM-DD");
  const rangeTo = TARGET;

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fyers.getHistory({
        symbol,
        resolution: RESOLUTION,
        date_format: "1",
        range_from: rangeFrom,
        range_to: rangeTo,
        cont_flag: "1",
      });

      if (!res || !res.candles || res.candles.length === 0) {
        if (isInvalidSymbolResponse(res)) {
          logger.warn(`⚠️  Invalid symbol: ${symbol}`);
          return null;
        }
        throw new Error(`Empty response (s=${res?.s})`);
      }

      let candles = res.candles;

      // Drop currently forming candle — ONLY during live market hours (9:15 to 15:30:10 IST).
      // After market close the last 15:27/15:29 candle is fully closed; never drop it.
      const resInt = parseInt(RESOLUTION, 10);
      const nowIST = moment().tz(IST);
      const isToday = TARGET === nowIST.format("YYYY-MM-DD");
      const mktOpen = nowIST.clone().set({ hour: 9, minute: 15, second: 0, millisecond: 0 });
      const mktClose = nowIST.clone().set({ hour: 15, minute: 30, second: 10, millisecond: 0 });
      const duringMarket = nowIST.isSameOrAfter(mktOpen) && nowIST.isSameOrBefore(mktClose);
      if (!isNaN(resInt) && isToday && duringMarket) {
        const lastTs = candles[candles.length - 1][0];
        const lastClose = moment.unix(lastTs).tz(IST).add(resInt, "minutes");
        if (nowIST.isBefore(lastClose)) candles = candles.slice(0, -1);
      }

      if (candles.length < 1) {
        logger.warn(`⚠️  No candles for ${TARGET}: ${symbol}`);
        return null;
      }

      logger.debug(`✅ ${symbol} | ${candles.length} candles | ${RESOLUTION}min | from ${rangeFrom} to ${rangeTo}`);
      candleCache.set(cacheKey, { candles, fetchedAt: Date.now() });
      return candles;

    } catch (err) {
      lastErr = err;
      logger.warn(`⚠️  ${symbol} attempt ${attempt}/${MAX_RETRIES}: ${err.message}`);
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY);
    }
  }

  logger.error(`❌ Failed ${symbol}: ${lastErr?.message}`);
  return null;
}

function clearCache(symbol) {
  if (symbol) {
    for (const key of candleCache.keys()) {
      if (key.startsWith(symbol + "::")) candleCache.delete(key);
    }
  } else {
    candleCache.clear();
  }
}

module.exports = { fetchCandles, clearCache };