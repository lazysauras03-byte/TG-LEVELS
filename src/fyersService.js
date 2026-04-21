/**
 * fyersService.js
 * Fetches 15-minute OHLC candles for NSE:NIFTY50-INDEX from Fyers API.
 *
 * TOKEN LOADING PRIORITY:
 *  1. fyers_access_token.txt  ← your generate.js saves the token HERE after auth
 *  2. ./scratch localStorage  ← legacy fallback (old fyersapi.js pattern)
 *
 * Root cause of "Could not authenticate the user":
 *  generate.js writes token to fyers_access_token.txt
 *  but old fyersService was only reading from ./scratch/token (localStorage)
 *  → they were in different places so token was never found
 */

require("dotenv").config();
const fs = require("fs");
const nodePath = require("path");
const moment = require("moment");

const fyersModel = require("fyers-api-v3").fyersModel;
const fyers = new fyersModel({ path: "", enableLogging: false });
fyers.setAppId(process.env.APP_ID);
fyers.setRedirectUrl("https://www.google.com/");

// ── Load token from whichever storage location it was saved to ────────────────
function loadAccessToken() {
  // Priority 1: fyers_access_token.txt (written by generate.js after auth)
  const txtPath = nodePath.join(process.cwd(), "fyers_access_token.txt");
  if (fs.existsSync(txtPath)) {
    const token = fs.readFileSync(txtPath, "utf8").trim();
    if (token && token.length > 20) {
      console.log("🔑 Fyers token loaded from fyers_access_token.txt");
      return token;
    }
  }

  // Priority 2: ./scratch localStorage (legacy fyersapi.js pattern)
  try {
    if (typeof localStorage === "undefined" || localStorage === null) {
      const { LocalStorage } = require("node-localstorage");
      global.localStorage = new LocalStorage("./scratch");
    }
    const raw = localStorage.getItem("token");
    if (raw) {
      let token;
      try {
        const parsed = JSON.parse(raw);
        token = typeof parsed === "string" ? parsed : null;
      } catch (_) {
        token = raw;
      }
      if (token && token.length > 20) {
        console.log("🔑 Fyers token loaded from ./scratch localStorage");
        return token;
      }
    }
  } catch (_) { }

  console.warn("⚠️  No Fyers access token found.");
  console.warn("   Run:  node index.js  (select Option 1 - authenticate) to generate a fresh token.");
  return null;
}

const tempauth = loadAccessToken();
if (tempauth) fyers.setAccessToken(tempauth);

// ── In-memory cache ───────────────────────────────────────────────────────────
const niftyCache = new Map();

async function fetchNiftyCandles(fromDate, toDate) {
  const cacheKey = `${fromDate}_${toDate}`;
  if (niftyCache.has(cacheKey)) return niftyCache.get(cacheKey);

  if (!tempauth) {
    console.warn("⚠️  Skipping Nifty fetch — no token available");
    return new Map();
  }

  try {
    const response = await fyers.getHistory({
      symbol: "NSE:NIFTY50-INDEX",
      resolution: "15",
      date_format: "1",
      range_from: fromDate,
      range_to: toDate,
      cont_flag: "1",
    });

    if (!response || !response.candles || response.candles.length === 0) {
      console.warn("⚠️  No Nifty candles returned from Fyers");
      return new Map();
    }

    const candleMap = new Map();
    for (const c of response.candles) {
      const ts = c[0];
      candleMap.set(ts, {
        ts,
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        time: moment.unix(ts).format("YYYY-MM-DD HH:mm"),
      });
    }

    niftyCache.set(cacheKey, candleMap);
    console.log(`✅ Fetched ${candleMap.size} Nifty 15m candles (${fromDate} → ${toDate})`);
    return candleMap;

  } catch (err) {
    console.error(`❌ Fyers Nifty fetch error: ${err.message}`);
    return new Map();
  }
}

function floorTo15Min(m) {
  const mins = m.minutes();
  const floored = Math.floor(mins / 15) * 15;
  return m.clone().minutes(floored).seconds(0).milliseconds(0);
}

async function fetchNiftyForTrades(tradeDates) {
  if (!tradeDates || tradeDates.length === 0) return new Map();
  const sorted = [...tradeDates].sort();
  return fetchNiftyCandles(sorted[0], sorted[sorted.length - 1]);
}

function getNiftyCandleAtTime(candleMap, timeMoment) {
  if (!candleMap || candleMap.size === 0) return null;
  const boundary = floorTo15Min(timeMoment);
  return candleMap.get(boundary.unix()) || null;
}

function getNiftyTrend(candleMap, entryMoment, exitMoment) {
  const entryCandle = getNiftyCandleAtTime(candleMap, entryMoment);
  const exitCandle = getNiftyCandleAtTime(candleMap, exitMoment);
  if (!entryCandle || !exitCandle) return "UNKNOWN";
  if (exitCandle.close > entryCandle.close) return "UP";
  if (exitCandle.close < entryCandle.close) return "DOWN";
  return "FLAT";
}

function isNiftyAligned(direction, niftyTrend) {
  if (niftyTrend === "UNKNOWN") return "UNKNOWN";
  if (direction === "BUY" && niftyTrend === "UP") return "YES";
  if (direction === "SELL" && niftyTrend === "DOWN") return "YES";
  return "NO";
}

function isNiftyAlignedBacktest(crossoverType, niftyTrend) {
  return isNiftyAligned(crossoverType === "BULLISH" ? "BUY" : "SELL", niftyTrend);
}

module.exports = {
  fetchNiftyForTrades,
  fetchNiftyCandles,
  getNiftyCandleAtTime,
  getNiftyTrend,
  isNiftyAligned,
  isNiftyAlignedBacktest,
  floorTo15Min,
};