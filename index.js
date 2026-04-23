// 3C Break FUT FILE 

const { appendSignalToFile } = require("./generateDailySummaryDocx");
const express = require("express");
const axios = require("axios");
const XLSX = require("xlsx");
require("dotenv").config();
const fs = require("fs");
const moment = require("moment");
const { writePatternToExcel } = require("./src/excelReports");
const { authenticate, getStoredTokens } = require("./src/generate");
const EMAManager = require("./utils/func/emaManager");
const BCVCManager = require("./utils/func/bcvcManager");
const SRAnalyzer = require("./utils/func/srAnalyzer");
const { analyzeDowTheory, buildDowTheoryTelegramBlock } = require("./utils/func/dowTheory");
const { analyzeWaves, buildWaveAnalysisTelegramBlock } = require("./utils/func/waveAnalysis");
const { analyzeWyckoff, buildWyckoffTelegramBlock } = require("./utils/func/wyckoff");
const { scoreEntry, buildEntryMapTelegramBlock } = require("./utils/func/entryMap");

const {
  getActiveFuturesMonth,
  getFuturesSymbol,
  getFuturesTVSymbol,
  loadSymbolsWithFutures,
  logContractInfo,
} = require("./futuresSymbol");

const bot = require("./utils/func/telegram");
const fyers = require("./utils/func/fyersapi");
const { runBacktest } = require("./src/backtestSignals");

// ─── Config ───────────────────────────────────────────────────────────────────
const INPUT_EXCEL = "./NIFTY.xlsx";
const SYMBOL_COLUMN = "symbol";

if (typeof localStorage === "undefined" || localStorage === null) {
  var LocalStorage = require("node-localstorage").LocalStorage;
  localStorage = new LocalStorage("./scratch");
}

/////////////------------ogbot
// const telegramtoken = '8199688040:AAHGqr4cECCMb9kd4qXNM5bKAXXrqj8shQk';
const telegramchat = "-1003727905299";
/////////////------------pgfbot
// const telegramtoken = "8390227157:AAFYQ2eWFAJdm9P8me9Nk2voYe00Mn33dSU";
// const telegramchat = "8559767849";
/////////////------------pnlbot
// const telegramtoken = "7764791634:AAGGwGa6Sl7jNauuQvgnTXRTVixikBZCb-g";
// const telegramchat = "7781596314";
/////////////------------Lazy bot
// const telegramtoken = "8529663033:AAEBTgtqjKdqg3lG89ZMclD8lPTxN7mp3BI"
// const telegramchat = "8559767849";
/////////////------------IQOO bot 
// const telegramtoken = "8671371710:AAFXdzpLwRWQ1TNgN8g1PV4Sm8CZ4oMiIbc"
// const telegramchat = "8559767849"

let patternSchedulerTimeout = null;
let isExecuting = false;
const emaManager = new EMAManager(fyers);
const bcvcManager = new BCVCManager(fyers);
const srAnalyzer = new SRAnalyzer();
const SEND_FIRST_RUN_NOTIFICATIONS = true;
// const symbols = ["NSE:PPLPHARMA-EQ", "NSE:POLYCAB-EQ", "NSE:PFC-EQ", "NSE:POWERGRID-EQ", "NSE:PRESTIGE-EQ", "NSE:PNB-EQ", "NSE:RBLBANK-EQ", "NSE:RECLTD-EQ", "NSE:RVNL-EQ", "NSE:RELIANCE-EQ", "NSE:SBICARD-EQ", "NSE:SBILIFE-EQ", "NSE:SHREECEM-EQ", "NSE:SRF-EQ", "NSE:SAMMAANCAP-EQ", "NSE:MOTHERSON-EQ", "NSE:SHRIRAMFIN-EQ", "NSE:SIEMENS-EQ", "NSE:SOLARINDS-EQ", "NSE:SONACOMS-EQ", "NSE:SBIN-EQ", "NSE:SAIL-EQ", "NSE:SUNPHARMA-EQ", "NSE:SUPREMEIND-EQ", "NSE:SUZLON-EQ", "NSE:SYNGENE-EQ", "NSE:TATACONSUM-EQ", "NSE:TITAGARH-EQ", "NSE:TVSMOTOR-EQ", "NSE:TCS-EQ", "NSE:TATAELXSI-EQ", "NSE:TMPV-EQ", "NSE:TATAPOWER-EQ", "NSE:TATASTEEL-EQ", "NSE:TATATECH-EQ", "NSE:TECHM-EQ", "NSE:FEDERALBNK-EQ", "NSE:INDHOTEL-EQ", "NSE:PHOENIXLTD-EQ", "NSE:TITAN-EQ", "NSE:TORNTPHARM-EQ", "NSE:TORNTPOWER-EQ", "NSE:TRENT-EQ", "NSE:TIINDIA-EQ", "NSE:UNOMINDA-EQ", "NSE:UPL-EQ", "NSE:ULTRACEMCO-EQ", "NSE:UNIONBANK-EQ", "NSE:UNITDSPR-EQ", "NSE:VBL-EQ", "NSE:VEDL-EQ", "NSE:IDEA-EQ", "NSE:VOLTAS-EQ", "NSE:WIPRO-EQ", "NSE:YESBANK-EQ", "NSE:ZYDUSLIFE-EQ"];
const TESTING_MODE = false;

const app = express();

// ─── Auth ─────────────────────────────────────────────────────────────────────
const tokens = getStoredTokens();
var tempauth;

const raw = localStorage.getItem("token");
tempauth = raw ? JSON.parse(raw) : null;

let data = {
  grant_type: "refresh_token",
  appIdHash: process.env.HASH_ID,
  refresh_token: tokens.refresh_token,
  pin: process.env.PIN,
};

const runauth = async () => {
  const tokens = getStoredTokens();
  const accessToken = tokens.access_token;

  if (!accessToken) {
    console.error("❌ No access token found. Run authenticate() first (Option 1 in main).");
    process.exit(1);
  }

  fyers.setAppId(process.env.APP_ID);
  fyers.setRedirectUrl("https://www.google.com/");
  fyers.setAccessToken(accessToken);
  tempauth = accessToken;

  const profile = await fyers.get_profile();
  console.log("✅ Auth OK:", profile);
};

// // ── 🔐 AUTHENTICATE (once a month) ───────────────────────────────
// authenticate().then(() => {
//   console.log("✅ Authentication complete. You can now run runauth() daily.");
//   process.exit(0);
// }).catch(console.error);

// ─── Nifty Bias (spot index — used only for market direction context) ─────────
let niftyBiasCache = null;
let niftyBiasCacheTime = null;

const getNiftyBias = async () => {
  if (niftyBiasCache && niftyBiasCacheTime && Date.now() - niftyBiasCacheTime < 15 * 60 * 1000) {
    return niftyBiasCache;
  }
  try {
    const validTo = moment();
    const validFrom = moment().subtract(10, "days");
    const response = await fyers.getHistory({
      symbol: "NSE:NIFTY50-INDEX",
      resolution: "15",
      date_format: "1",
      range_from: validFrom.format("YYYY-MM-DD"),
      range_to: validTo.format("YYYY-MM-DD"),
      cont_flag: "1",
    });

    if (!response || !response.candles || response.candles.length < 25) {
      return { bias: "UNKNOWN", emoji: "❓", reason: "Insufficient data", ema20: "N/A", currentPrice: "N/A" };
    }

    let candles = response.candles;
    if (moment().isBefore(moment.unix(candles[candles.length - 1][0]).add(15, "minutes"))) {
      candles = candles.slice(0, -1);
    }

    const closes = candles.map((c) => parseFloat(c[4]));
    const period = 20;
    const mult = 2 / (period + 1);
    let ema20 = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) ema20 = (closes[i] - ema20) * mult + ema20;

    const currentPrice = closes[closes.length - 1];
    const distPct = (((currentPrice - ema20) / ema20) * 100).toFixed(2);

    let bias, emoji, reason;
    if (currentPrice > ema20 * 1.001) {
      bias = "LONG"; emoji = "🟢"; reason = `₹${currentPrice.toFixed(0)} above 20 EMA ₹${ema20.toFixed(0)} (+${distPct}%)`;
    } else if (currentPrice < ema20 * 0.999) {
      bias = "SHORT"; emoji = "🔴"; reason = `₹${currentPrice.toFixed(0)} below 20 EMA ₹${ema20.toFixed(0)} (${distPct}%)`;
    } else {
      bias = "CHOPPY"; emoji = "⚠️"; reason = `₹${currentPrice.toFixed(0)} at 20 EMA ₹${ema20.toFixed(0)} — no clear direction`;
    }

    const result = { bias, emoji, reason, currentPrice: +currentPrice.toFixed(2), ema20: +ema20.toFixed(2) };
    niftyBiasCache = result;
    niftyBiasCacheTime = Date.now();
    console.log(`📊 Nifty Bias: ${bias} | ${reason}`);
    return result;
  } catch (err) {
    console.error("❌ Nifty bias fetch failed:", err.message);
    return { bias: "UNKNOWN", emoji: "❓", reason: "Fetch error", ema20: "N/A", currentPrice: "N/A" };
  }
};

// ─── Tiered exits ─────────────────────────────────────────────────────────────
const calcTieredExits = (entryPrice, sl, direction) => {
  const isBull = direction === "BULLISH_CROSSOVER";
  const risk = isBull ? +(entryPrice - sl).toFixed(2) : +(sl - entryPrice).toFixed(2);
  const t1 = isBull ? +(entryPrice + risk).toFixed(2) : +(entryPrice - risk).toFixed(2);
  const t2 = isBull ? +(entryPrice + risk * 2).toFixed(2) : +(entryPrice - risk * 2).toFixed(2);
  return { risk, t1, t2 };
};

// ─── Daily bias Telegram message ─────────────────────────────────────────────
const sendDailyBiasMessage = async () => {
  const bias = await getNiftyBias();
  const cm = getActiveFuturesMonth();
  const daysToExpiry = cm.expiry.diff(moment(), "days");
  const expiryWarn = daysToExpiry <= 3
    ? `\n⚠️ <b>Expiry in ${daysToExpiry} day(s) — ${cm.expiryStr}</b>`
    : "";

  const strategyLine =
    bias.bias === "LONG"
      ? "✅ Bullish setups favoured today\n⚠️  Bearish signals are counter-trend — confirm carefully"
      : bias.bias === "SHORT"
        ? "✅ Bearish setups favoured today\n⚠️  Bullish signals are counter-trend — confirm carefully"
        : "⚠️  Nifty is choppy — confirm every signal carefully before acting";

  const msg = `
${bias.emoji} <b>DAILY MARKET BIAS — ${moment().format("DD MMM YYYY")}</b>
━━━━━━━━━━━━━━━━━━━━━━━━
🧭 Bias            : <b>${bias.bias}</b>
📊 Nifty Spot      : ₹${bias.currentPrice}
📈 20 EMA (15m)    : ₹${bias.ema20}
📝 Reason          : ${bias.reason}

📅 <b>Active Contract  :</b> expires ${cm.expiryStr}${expiryWarn}

📋 <b>Team Strategy:</b>
${strategyLine}

⏰ ${moment().format("HH:mm:ss")}
`.trim();

  try {
    await bot.sendMessage(telegramchat, msg, { parse_mode: "HTML" });
    console.log(`✅ Daily bias message sent`);
  } catch (err) {
    console.error("❌ Failed to send daily bias message:", err.message);
  }
  return bias;
};

// ─── Symbol loader → returns FUTURES symbols ─────────────────────────────────
function loadSymbols(inputExcel, columnName = "symbol") {
  const { pairs, contractMonth: cm } = loadSymbolsWithFutures(inputExcel, columnName);
  const futuresSymbols = pairs.map((p) => p.futuresSymbol);

  console.log(`✅ Futures symbols ready (expires ${cm.expiryStr}):`);
  console.log(`   Sample: ${futuresSymbols.slice(0, 3).join("  |  ")}`);
  console.log(`✅ Loaded ${futuresSymbols.length} futures symbols`);

  return futuresSymbols;
}

// ─── Pattern ID ───────────────────────────────────────────────────────────────
const generatePatternId = (symbol, pattern) => {
  const crossoverTime = pattern.crossover.timestampUnix;
  const signalTime = pattern.confirmationCandle.timestampUnix;
  const typePrefix = pattern.crossoverType === "BULLISH_CROSSOVER" ? "BULL" : "BEAR";
  const cleanSym = symbol.replace(/\s+/g, "_");
  return `${cleanSym}_${typePrefix}_${crossoverTime}_${signalTime}`;
};

const getFyersChartLink = (futuresSymbol) => {
  return `https://fyers.in/web/symbol/${encodeURIComponent(futuresSymbol)}`;
};

// ─── isRecentEnough: accepts confirm candles from last 1 trading day ──────────
const getLastTradingDay = () => {
  let d = moment();
  if (d.day() === 0) d.subtract(2, "days");
  else if (d.day() === 6) d.subtract(1, "day");
  else if (d.hour() < 9 || (d.hour() === 9 && d.minute() < 15)) {
    d.subtract(1, "day");
    if (d.day() === 0) d.subtract(2, "days");
    if (d.day() === 6) d.subtract(1, "day");
  }
  return d.format("YYYY-MM-DD");
};

const isRecentEnough = (ts) => {
  const signalDate = moment.unix(ts).format("YYYY-MM-DD");
  const lastTradingDay = getLastTradingDay();
  const prevTradingDay = moment(lastTradingDay).subtract(1, "day");
  if (prevTradingDay.day() === 0) prevTradingDay.subtract(2, "days");
  if (prevTradingDay.day() === 6) prevTradingDay.subtract(1, "day");

  return TESTING_MODE
    ? (signalDate === lastTradingDay || signalDate === prevTradingDay.format("YYYY-MM-DD"))
    : signalDate === lastTradingDay;
};

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_CONFIRM_CANDLES = 3;       // max candles after C2 to search for C3
const CROSSOVER_CONFIRM_CANDLES = 2; // prior candles that must be on opposite side

// ─── CrossoverRegistry ────────────────────────────────────────────────────────
// Maintains one validated crossover record per symbol per scan cycle.
// Replaces the old flat newerCrossoverInWindow approach with structured
// per-symbol state that survives mid-scan updates.
class CrossoverRegistry {
  constructor() {
    this._map = new Map();
  }

  get(symbol) {
    return this._map.get(symbol) || null;
  }

  // Validate a crossover using the 2-prior-candle check.
  // Returns true if accepted and stored, false if rejected.
  validate(symbol, crossoverObj, crossoverIdx, rawCandles, ema9ByTimestamp, ema100ByTimestamp) {
    const isBull = crossoverObj.type === "BULLISH_CROSSOVER";

    if (crossoverIdx < CROSSOVER_CONFIRM_CANDLES) {
      console.log(`  ⛔ Registry: ${crossoverObj.type} at ${crossoverObj.timestamp} — not enough prior candles`);
      return false;
    }

    // The 2 candles immediately before the crossover candle must be on the
    // OPPOSITE side of EMA100 — confirming this is a fresh cross, not noise.
    for (let k = 1; k <= CROSSOVER_CONFIRM_CANDLES; k++) {
      const priorCandle = rawCandles[crossoverIdx - k];
      if (!priorCandle) return false;

      const priorTs = priorCandle[0];
      const priorEma9Low = ema9ByTimestamp[priorTs]?.ema9Low;
      const priorEma9High = ema9ByTimestamp[priorTs]?.ema9High;
      const priorEma100 = ema100ByTimestamp[priorTs];

      if (priorEma9Low === undefined || priorEma9High === undefined || priorEma100 === undefined) {
        console.log(`  ⛔ Registry: ${crossoverObj.type} at ${crossoverObj.timestamp} — missing EMA on prior candle ${k}`);
        return false;
      }

      if (isBull) {
        // Before a BULLISH crossover, EMA9_Low must have been BELOW EMA100
        if (priorEma9Low > priorEma100) {
          console.log(`  ⛔ Registry: BULL at ${crossoverObj.timestamp} — prior candle ${k} EMA9_Low already above EMA100 (not fresh)`);
          return false;
        }
      } else {
        // Before a BEARISH crossover, EMA9_High must have been ABOVE EMA100
        if (priorEma9High < priorEma100) {
          console.log(`  ⛔ Registry: BEAR at ${crossoverObj.timestamp} — prior candle ${k} EMA9_High already below EMA100 (not fresh)`);
          return false;
        }
      }
    }

    // Only store if newer than what we already have for this symbol
    const existing = this._map.get(symbol);
    if (existing && crossoverObj.timestampUnix <= existing.timestampUnix) {
      return false;
    }

    this._map.set(symbol, {
      symbol,
      crossoverIndex: crossoverIdx,
      crossoverTime: crossoverObj.timestamp,
      timestampUnix: crossoverObj.timestampUnix,
      direction: isBull ? "BULL" : "BEAR",
      crossoverObj,
    });

    console.log(`  ✅ Registry: ${isBull ? "BULL" : "BEAR"} crossover at ${crossoverObj.timestamp} validated for ${symbol}`);
    return true;
  }

  // Called when a raw crossover is detected mid-scan (on a C2 or C3 candidate).
  // If the crossover passes validation it replaces the current registry entry
  // and the caller should abort the current C2/C3 search.
  updateFromMidScan(symbol, crossoverObj, crossoverIdx, rawCandles, ema9ByTimestamp, ema100ByTimestamp) {
    const accepted = this.validate(symbol, crossoverObj, crossoverIdx, rawCandles, ema9ByTimestamp, ema100ByTimestamp);
    if (accepted) {
      console.log(`  🔄 Registry mid-scan update for ${symbol} — aborting current C2/C3 search`);
    }
    return accepted;
  }
}

// ─── Purity check ─────────────────────────────────────────────────────────────
// Scans every consecutive candle pair in the window (C1_ts, C3_ts] for a raw
// EMA crossover. Any flip in the ema9Low/ema100 OR ema9High/ema100 relationship
// between adjacent candles means the window is impure → no signal.
// Returns the offending timestamp string if impure, null if clean.
const purityCheck = (c1TimestampUnix, c3TimestampUnix, rawCandles, ema9ByTimestamp, ema100ByTimestamp) => {
  const windowCandles = rawCandles
    .filter((c) => c[0] > c1TimestampUnix && c[0] <= c3TimestampUnix)
    .sort((a, b) => a[0] - b[0]);

  if (windowCandles.length < 2) return null;

  for (let i = 1; i < windowCandles.length; i++) {
    const prevTs = windowCandles[i - 1][0];
    const currTs = windowCandles[i][0];

    const pE9L = ema9ByTimestamp[prevTs]?.ema9Low;
    const pE9H = ema9ByTimestamp[prevTs]?.ema9High;
    const pE100 = ema100ByTimestamp[prevTs];
    const cE9L = ema9ByTimestamp[currTs]?.ema9Low;
    const cE9H = ema9ByTimestamp[currTs]?.ema9High;
    const cE100 = ema100ByTimestamp[currTs];

    // Skip if any EMA value is missing (NaN guard)
    if (pE9L === undefined || pE9H === undefined || pE100 === undefined ||
      cE9L === undefined || cE9H === undefined || cE100 === undefined) continue;

    // Any relationship flip between consecutive candles = raw crossover = impure
    if ((pE9L > pE100) !== (cE9L > cE100)) return moment.unix(currTs).format("YYYY-MM-DD HH:mm");
    if ((pE9H < pE100) !== (cE9H < cE100)) return moment.unix(currTs).format("YYYY-MM-DD HH:mm");
  }

  return null;
};

// ─── analyzePattern ───────────────────────────────────────────────────────────
const analyzePattern = (emadata, crossoverRegistry) => {
  if (!emadata.crossover || emadata.crossover.length === 0)
    return { found: false, reason: "No crossovers found" };
  if (!emadata.rawCandles || emadata.rawCandles.length === 0)
    return { found: false, reason: "No raw candles available" };
  if (!emadata.ema9ByTimestamp)
    return { found: false, reason: "ema9ByTimestamp not available" };
  if (!emadata.ema100ByTimestamp)
    return { found: false, reason: "ema100ByTimestamp not available" };

  const ema9ByTimestamp = emadata.ema9ByTimestamp;
  const ema100ByTimestamp = emadata.ema100ByTimestamp;

  // Sort rawCandles ascending — guaranteed order for all index operations
  const rawCandles = emadata.rawCandles.slice().sort((a, b) => a[0] - b[0]);

  // Symbol name for registry key (from header if available)
  const symbol = emadata.header?.symbol || "UNKNOWN";

  // All crossovers chronological — used for mid-scan raw crossover lookups
  const allCrossoversChron = (emadata.allCrossovers || []).slice().sort((a, b) => a.timestampUnix - b.timestampUnix);

  // Fast lookup: unix timestamp → index in rawCandles
  const candleIndexByTs = new Map();
  rawCandles.forEach((c, i) => candleIndexByTs.set(c[0], i));

  // Helper: detect a raw EMA crossover between two consecutive candle timestamps
  const isRawCrossover = (prevTs, currTs) => {
    const p9L = ema9ByTimestamp[prevTs]?.ema9Low;
    const p9H = ema9ByTimestamp[prevTs]?.ema9High;
    const p100 = ema100ByTimestamp[prevTs];
    const c9L = ema9ByTimestamp[currTs]?.ema9Low;
    const c9H = ema9ByTimestamp[currTs]?.ema9High;
    const c100 = ema100ByTimestamp[currTs];
    if (p9L === undefined || p9H === undefined || p100 === undefined ||
      c9L === undefined || c9H === undefined || c100 === undefined) return false;
    return ((p9L > p100) !== (c9L > c100)) || ((p9H < p100) !== (c9H < c100));
  };

  // ── Step 1: find the best validated C1 via the registry ──────────────────
  // Try crossovers newest-first; the first one that passes the 2-prior-candle
  // check is accepted as C1 and stored in the registry.
  const candidatesNewestFirst = allCrossoversChron.slice().reverse();
  let registryEntry = null;

  for (const cx of candidatesNewestFirst) {
    const cxIdx = candleIndexByTs.get(cx.timestampUnix);
    if (cxIdx === undefined) continue;

    const accepted = crossoverRegistry.validate(
      symbol, cx, cxIdx, rawCandles, ema9ByTimestamp, ema100ByTimestamp
    );
    if (accepted) {
      registryEntry = crossoverRegistry.get(symbol);
      break;
    }
  }

  if (!registryEntry) {
    return { found: false, reason: "No valid crossover passed 2-prior-candle confirmation check" };
  }

  const c1 = registryEntry.crossoverObj;
  const c1Idx = registryEntry.crossoverIndex;
  const isBull = registryEntry.direction === "BULL";

  console.log(`  🔍 C1: ${c1.type} at ${c1.timestamp} (idx ${c1Idx})`);

  const candlesAfterC1 = rawCandles.slice(c1Idx + 1);

  if (candlesAfterC1.length < 2) {
    return { found: false, reason: `Only ${candlesAfterC1.length} candle(s) after C1 — need ≥ 2` };
  }

  // ── Step 2: scan for C2 (pullback) then C3 (confirmation) ────────────────
  for (let pbIdx = 0; pbIdx < candlesAfterC1.length; pbIdx++) {
    const pbCandle = candlesAfterC1[pbIdx];
    const pbTs = pbCandle[0];
    const pbOpen = parseFloat(pbCandle[1]);
    const pbHigh = parseFloat(pbCandle[2]);
    const pbLow = parseFloat(pbCandle[3]);
    const pbClose = parseFloat(pbCandle[4]);

    // ── Mid-scan raw crossover check on this C2 candidate ──────────────
    // Compare this candle against the one before it (C1 candle itself on first pass)
    const prevC2Ts = pbIdx === 0 ? rawCandles[c1Idx][0] : candlesAfterC1[pbIdx - 1][0];
    if (isRawCrossover(prevC2Ts, pbTs)) {
      const cxHere = allCrossoversChron.find((cx) => cx.timestampUnix === pbTs);
      if (cxHere) {
        const cxIdx = candleIndexByTs.get(pbTs);
        if (cxIdx !== undefined) {
          crossoverRegistry.updateFromMidScan(
            symbol, cxHere, cxIdx, rawCandles, ema9ByTimestamp, ema100ByTimestamp
          );
        }
      }
      console.log(`  🔄 Raw crossover on C2 candidate at ${moment.unix(pbTs).format("HH:mm")} — aborting scan`);
      return { found: false, reason: `Raw crossover on C2 candidate at ${moment.unix(pbTs).format("YYYY-MM-DD HH:mm")}` };
    }

    // ── BULLISH path ──────────────────────────────────────────────────
    if (isBull) {
      const ema9AtPb = ema9ByTimestamp[pbTs]?.ema9Low;
      if (ema9AtPb === undefined) continue;
      if (pbLow > ema9AtPb) continue; // C2: low must touch or dip below EMA9_Low

      // Valid C2 found — search up to MAX_CONFIRM_CANDLES ahead for C3
      for (let cfOffset = 1; cfOffset <= MAX_CONFIRM_CANDLES; cfOffset++) {
        if (pbIdx + cfOffset >= candlesAfterC1.length) break;

        const cfCandle = candlesAfterC1[pbIdx + cfOffset];
        const cfTs = cfCandle[0];
        const cfOpen = parseFloat(cfCandle[1]);
        const cfHigh = parseFloat(cfCandle[2]);
        const cfLow = parseFloat(cfCandle[3]);
        const cfClose = parseFloat(cfCandle[4]);
        const ema9AtCf = ema9ByTimestamp[cfTs]?.ema9Low;
        if (ema9AtCf === undefined) continue;

        // Mid-scan crossover check on this C3 candidate
        const prevC3Ts = candlesAfterC1[pbIdx + cfOffset - 1][0];
        if (isRawCrossover(prevC3Ts, cfTs)) {
          const cxHere = allCrossoversChron.find((cx) => cx.timestampUnix === cfTs);
          if (cxHere) {
            const cxIdx = candleIndexByTs.get(cfTs);
            if (cxIdx !== undefined) {
              crossoverRegistry.updateFromMidScan(
                symbol, cxHere, cxIdx, rawCandles, ema9ByTimestamp, ema100ByTimestamp
              );
            }
          }
          console.log(`  🔄 Raw crossover on C3 candidate at ${moment.unix(cfTs).format("HH:mm")} — hard stop`);
          return { found: false, reason: `Raw crossover on C3 candidate at ${moment.unix(cfTs).format("YYYY-MM-DD HH:mm")}` };
        }

        // C3 body breakout: close OR open must exceed C2 High
        const bodyBreaks = cfClose > pbHigh || cfOpen > pbHigh;
        if (!bodyBreaks) continue;

        // Recency gate — confirmation candle must be today
        if (!isRecentEnough(cfTs)) {
          console.log(`  ⏭️  C3 at ${moment.unix(cfTs).format("YYYY-MM-DD")} not recent enough — stopping`);
          break;
        }

        // Full purity check on entire window [C1+1 … C3]
        const impureAt = purityCheck(c1.timestampUnix, cfTs, rawCandles, ema9ByTimestamp, ema100ByTimestamp);
        if (impureAt) {
          console.log(`  🚫 Purity FAILED: crossover inside window at ${impureAt} — hard stop`);
          return { found: false, reason: `Purity check failed: crossover inside C1→C3 window at ${impureAt}` };
        }

        console.log(
          `  ✅ C3 BULL (+${cfOffset}): ${moment.unix(cfTs).format("HH:mm")}  ` +
          `Body breaks C2 High ₹${pbHigh} — Open ₹${cfOpen} / Close ₹${cfClose}`
        );

        return {
          found: true,
          crossoverType: "BULLISH_CROSSOVER",
          crossover: c1,
          pullbackCandle: {
            timestampUnix: pbTs,
            timestamp: moment.unix(pbTs).format("YYYY-MM-DD HH:mm"),
            open: pbOpen, high: pbHigh, low: pbLow, close: pbClose,
            ema9: +ema9AtPb.toFixed(2),
          },
          confirmationCandle: {
            timestampUnix: cfTs,
            timestamp: moment.unix(cfTs).format("YYYY-MM-DD HH:mm"),
            open: cfOpen, high: cfHigh, low: cfLow, close: cfClose,
            ema9: +ema9AtCf.toFixed(2),
          },
          entryPrice: cfClose,
          stopLoss: pbLow,
          validation: {
            pullbackLow: pbLow, pullbackEMA9Low: +ema9AtPb.toFixed(2),
            touchedBelowEMA9: pbLow <= ema9AtPb, pullbackHigh: pbHigh,
            confirmOpen: cfOpen, confirmClose: cfClose,
            bodyBreakAbovePullbackHigh: bodyBreaks,
            confirmationOffset: cfOffset,
            purityCheckPassed: true,
            crossoverValidated: true,
          },
          summary: {
            tag: "EMA9 LOW Strategy Bullish",
            crossoverTime: c1.timestamp,
            pullbackTime: moment.unix(pbTs).format("YYYY-MM-DD HH:mm"),
            confirmationTime: moment.unix(cfTs).format("YYYY-MM-DD HH:mm"),
            crossoverPrice: c1.price,
            pullbackLow: pbLow, pullbackHigh: pbHigh, pullbackEMA9: +ema9AtPb.toFixed(2),
            confirmOpen: cfOpen, confirmClose: cfClose,
            confirmHigh: cfHigh, confirmEMA9: +ema9AtCf.toFixed(2),
            entryPrice: cfClose, stopLoss: pbLow,
          },
        };
      }

      // ── BEARISH path ──────────────────────────────────────────────────
    } else {
      const ema9AtPb = ema9ByTimestamp[pbTs]?.ema9High;
      if (ema9AtPb === undefined) continue;
      if (pbHigh < ema9AtPb) continue; // C2: high must touch or rise above EMA9_High

      for (let cfOffset = 1; cfOffset <= MAX_CONFIRM_CANDLES; cfOffset++) {
        if (pbIdx + cfOffset >= candlesAfterC1.length) break;

        const cfCandle = candlesAfterC1[pbIdx + cfOffset];
        const cfTs = cfCandle[0];
        const cfOpen = parseFloat(cfCandle[1]);
        const cfHigh = parseFloat(cfCandle[2]);
        const cfLow = parseFloat(cfCandle[3]);
        const cfClose = parseFloat(cfCandle[4]);
        const ema9AtCf = ema9ByTimestamp[cfTs]?.ema9High;
        if (ema9AtCf === undefined) continue;

        // Mid-scan crossover check on this C3 candidate
        const prevC3Ts = candlesAfterC1[pbIdx + cfOffset - 1][0];
        if (isRawCrossover(prevC3Ts, cfTs)) {
          const cxHere = allCrossoversChron.find((cx) => cx.timestampUnix === cfTs);
          if (cxHere) {
            const cxIdx = candleIndexByTs.get(cfTs);
            if (cxIdx !== undefined) {
              crossoverRegistry.updateFromMidScan(
                symbol, cxHere, cxIdx, rawCandles, ema9ByTimestamp, ema100ByTimestamp
              );
            }
          }
          console.log(`  🔄 Raw crossover on C3 candidate at ${moment.unix(cfTs).format("HH:mm")} — hard stop`);
          return { found: false, reason: `Raw crossover on C3 candidate at ${moment.unix(cfTs).format("YYYY-MM-DD HH:mm")}` };
        }

        // C3 body breakdown: close OR open must fall below C2 Low
        const bodyBreaks = cfClose < pbLow || cfOpen < pbLow;
        if (!bodyBreaks) continue;

        // Recency gate — confirmation candle must be today
        if (!isRecentEnough(cfTs)) {
          console.log(`  ⏭️  C3 at ${moment.unix(cfTs).format("YYYY-MM-DD")} not recent enough — stopping`);
          break;
        }

        // Full purity check on entire window [C1+1 … C3]
        const impureAt = purityCheck(c1.timestampUnix, cfTs, rawCandles, ema9ByTimestamp, ema100ByTimestamp);
        if (impureAt) {
          console.log(`  🚫 Purity FAILED: crossover inside window at ${impureAt} — hard stop`);
          return { found: false, reason: `Purity check failed: crossover inside C1→C3 window at ${impureAt}` };
        }

        console.log(
          `  ✅ C3 BEAR (+${cfOffset}): ${moment.unix(cfTs).format("HH:mm")}  ` +
          `Body breaks C2 Low ₹${pbLow} — Open ₹${cfOpen} / Close ₹${cfClose}`
        );

        return {
          found: true,
          crossoverType: "BEARISH_CROSSOVER",
          crossover: c1,
          pullbackCandle: {
            timestampUnix: pbTs,
            timestamp: moment.unix(pbTs).format("YYYY-MM-DD HH:mm"),
            open: pbOpen, high: pbHigh, low: pbLow, close: pbClose,
            ema9: +ema9AtPb.toFixed(2),
          },
          confirmationCandle: {
            timestampUnix: cfTs,
            timestamp: moment.unix(cfTs).format("YYYY-MM-DD HH:mm"),
            open: cfOpen, high: cfHigh, low: cfLow, close: cfClose,
            ema9: +ema9AtCf.toFixed(2),
          },
          entryPrice: cfClose,
          stopLoss: pbHigh,
          validation: {
            pullbackHigh: pbHigh, pullbackEMA9High: +ema9AtPb.toFixed(2),
            touchedAboveEMA9: pbHigh >= ema9AtPb, pullbackLow: pbLow,
            confirmOpen: cfOpen, confirmClose: cfClose,
            bodyBreakBelowPullbackLow: bodyBreaks,
            confirmationOffset: cfOffset,
            purityCheckPassed: true,
            crossoverValidated: true,
          },
          summary: {
            tag: "EMA9 HIGH Strategy Bearish",
            crossoverTime: c1.timestamp,
            pullbackTime: moment.unix(pbTs).format("YYYY-MM-DD HH:mm"),
            confirmationTime: moment.unix(cfTs).format("YYYY-MM-DD HH:mm"),
            crossoverPrice: c1.price,
            pullbackHigh: pbHigh, pullbackLow: pbLow, pullbackEMA9: +ema9AtPb.toFixed(2),
            confirmOpen: cfOpen, confirmClose: cfClose,
            confirmLow: cfLow, confirmEMA9: +ema9AtCf.toFixed(2),
            entryPrice: cfClose, stopLoss: pbHigh,
          },
        };
      }
    }
  }

  return { found: false, reason: "No valid C1→C2→C3 setup found" };
};

module.exports = { analyzePattern };

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Duplicate-signal guard ───────────────────────────────────────────────────
let sentPatterns = new Set();

// ─── Main scan logic ──────────────────────────────────────────────────────────
const startlogic = async (isFirstRun = false) => {
  let signalsSentThisScan = 0;

  try {
    logContractInfo();

    const symbols = loadSymbols(INPUT_EXCEL, SYMBOL_COLUMN);
    const niftyBias = await getNiftyBias();
    console.log(`🧭 Nifty Bias: ${niftyBias.bias} | ${niftyBias.reason}`);

    const now = moment();

    const symbolsToProcess = symbols.slice(0, Math.min(208, symbols.length));
    let patternsFound = 0, newPatternsFound = 0, crossoversChecked = 0,
      recentCrossovers = 0, skippedSymbols = 0;

    // One fresh CrossoverRegistry per scan cycle — resets state per symbol
    const crossoverRegistry = new CrossoverRegistry();

    const BATCH_SIZE = 25;
    const WAIT_TIME = 5000;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`🕐 ${now.format("YYYY-MM-DD HH:mm:ss")}  [${isFirstRun ? "INITIAL" : "SCHEDULED"}]`);
    console.log("=".repeat(60));

    for (let i = 0; i < symbolsToProcess.length; i++) {
      const symbol = symbolsToProcess[i];
      console.log(`\n--- [${i + 1}/${symbolsToProcess.length}] ${symbol} ---`);

      try {
        const emadata = await emaManager.generateEMAReport(symbol);

        if (!emadata || !emadata.crossover || emadata.crossover.length === 0) {
          console.log(`⏭️  No crossovers found`);
          continue;
        }

        crossoversChecked++;

        const patternIdPrefix = symbol.replace(/\s+/g, "_");
        const alreadySent = Array.from(sentPatterns).some((id) => id.startsWith(patternIdPrefix));
        if (!TESTING_MODE && alreadySent && !isFirstRun) {
          skippedSymbols++;
          console.log(`⏭️  Already sent today`);
          continue;
        }

        recentCrossovers++;
        const pattern = analyzePattern(emadata, crossoverRegistry);

        if (!pattern.found) {
          console.log(`❌ ${pattern.reason}`);
          continue;
        }

        // ── SR scoring ────────────────────────────────────────────────────────
        const srAnalysis = srAnalyzer.analyze(emadata.rawCandles, pattern.confirmationCandle.close);
        try {
          scoreEntry({
            pattern, srAnalysis, niftyBias,
            signalCandle: pattern.confirmationCandle,
            entryPrice: pattern.entryPrice,
            stopLoss: pattern.stopLoss,
            direction: pattern.crossoverType
          });
        } catch (e) { /* non-fatal */ }

        patternsFound++;
        const patternId = generatePatternId(symbol, pattern);
        const symCleanForKey = symbol.replace(/\s+/g, "_");
        const directionKey = `${symCleanForKey}_${pattern.crossoverType === "BULLISH_CROSSOVER" ? "BULL" : "BEAR"}_${moment().format("YYYY-MM-DD")}`;

        // Skip if same symbol + same direction already sent today
        if (!TESTING_MODE && sentPatterns.has(directionKey)) {
          console.log(`⏭️  ${symbol} — ${pattern.crossoverType} already sent today — skipping`);
          continue;
        }
        const isNewPattern = !sentPatterns.has(patternId);
        console.log(`✅ PATTERN: ${pattern.crossoverType} | ${patternId} | ${isNewPattern ? "NEW" : "SEEN"}`);

        // ── Build Telegram message ────────────────────────────────────────────
        const fyersLink = getFyersChartLink(symbol);
        const symLabel = getFuturesTVSymbol(symbol);
        const cm = getActiveFuturesMonth();
        let telegramMessage = "";

        if (pattern.crossoverType === "BULLISH_CROSSOVER") {
          const { risk, t1, t2 } = calcTieredExits(pattern.entryPrice, pattern.stopLoss, "BULLISH_CROSSOVER");
          const pb = pattern.pullbackCandle;
          const cf = pattern.confirmationCandle;
          const alignLabel =
            niftyBias.bias === "LONG" ? `${niftyBias.emoji} LONG — Aligned ✅`
              : niftyBias.bias === "SHORT" ? `${niftyBias.emoji} SHORT — Counter Trend ⚠️`
                : `${niftyBias.emoji} CHOPPY ⚠️`;

          telegramMessage = `
🟢 <b>BULLISH SIGNAL</b> — ${symLabel}
━━━━━━━━━━━━━━━━━━━━━━━━
📊 <b>Chart       :</b> <a href="${fyersLink}">${symLabel} (15min)</a>
🧭 Nifty Bias  : ${alignLabel}

🔄 <b>Crossover   :</b> ${pattern.crossover.timestamp} (${moment.unix(pattern.crossover.timestampUnix).fromNow()})

📍 <b>Pullback    :</b> ${pb.timestamp}
   Low  ₹${pb.low} ≤ EMA9(Low) ₹${pb.ema9} ✅
   High ₹${pb.high} (breakout level)

✅ <b>Confirm     :</b> ${cf.timestamp}  (+${pattern.validation.confirmationOffset} candle)
    Open ₹${cf.open} / Close ₹${cf.close} — Body &gt; Pullback High ₹${pb.high} ✅

💰 <b>Entry       :</b> ₹${pattern.entryPrice}
🛑 <b>Stop Loss   :</b> ₹${pattern.stopLoss}
🎯 <b>T1 / T2     :</b> ₹${t1} / ₹${t2}
📐 Risk         : ₹${risk}

⏰ <b>Detected    :</b> ${moment().format("YYYY-MM-DD HH:mm:ss")}
`.trim();

        } else if (pattern.crossoverType === "BEARISH_CROSSOVER") {
          const { risk, t1, t2 } = calcTieredExits(pattern.entryPrice, pattern.stopLoss, "BEARISH_CROSSOVER");
          const pb = pattern.pullbackCandle;
          const cf = pattern.confirmationCandle;
          const alignLabel =
            niftyBias.bias === "SHORT" ? `${niftyBias.emoji} SHORT — Aligned ✅`
              : niftyBias.bias === "LONG" ? `${niftyBias.emoji} LONG — Counter Trend ⚠️`
                : `${niftyBias.emoji} CHOPPY ⚠️`;

          telegramMessage = `
🔴 <b>BEARISH SIGNAL</b> — ${symLabel}
━━━━━━━━━━━━━━━━━━━━━━━━
📊 <b>Chart       :</b> <a href="${fyersLink}">${symLabel} (15min)</a>
🧭 Nifty Bias  : ${alignLabel}

🔄 <b>Crossover   :</b> ${pattern.crossover.timestamp} (${moment.unix(pattern.crossover.timestampUnix).fromNow()})

📍 <b>Pullback    :</b> ${pb.timestamp}
   High ₹${pb.high} ≥ EMA9(High) ₹${pb.ema9} ✅
   Low  ₹${pb.low} (breakdown level)

📍 <b>Confirm     :</b> ${cf.timestamp}  (+${pattern.validation.confirmationOffset} candle) ✅ 
   Open ₹${cf.open} / Close ₹${cf.close} 
   Body &lt; Pullback Low ₹${pb.low} ✅

💰 <b>Entry       :</b> ₹${pattern.entryPrice}
🛑 <b>Stop Loss   :</b> ₹${pattern.stopLoss}
🎯 <b>T1 / T2     :</b> ₹${t1} / ₹${t2}
📐 Risk         : ₹${risk}

⏰ <b>Detected    :</b> ${moment().format("YYYY-MM-DD HH:mm:ss")}
`.trim();
        }

        // ── Send & record ─────────────────────────────────────────────────────
        if (isNewPattern || TESTING_MODE) {
          newPatternsFound++;
          const shouldSend = !isFirstRun || SEND_FIRST_RUN_NOTIFICATIONS;

          try {
            if (shouldSend) {
              await bot.sendMessage(telegramchat, telegramMessage, { parse_mode: "HTML" });
              console.log(`✅ Telegram sent`);
              signalsSentThisScan++;
            } else {
              console.log(`🔕 First-run silent — suppressed`);
            }

            if (!TESTING_MODE) {
              sentPatterns.add(patternId);
              sentPatterns.add(directionKey);

              if (shouldSend) {
                const symClean = symbol.replace(/\s+\d+\s+\w+\s+\d+\s+FUT$/i, "").trim();
                try {
                  appendSignalToFile({
                    pattern,
                    raw: telegramMessage,
                    symbol: symClean,
                    futuresSymbol: symbol,
                    direction: pattern.crossoverType,
                    crossoverTime: pattern.crossover.timestamp,
                    pullbackTime: pattern.pullbackCandle.timestamp,
                    confirmTime: pattern.confirmationCandle.timestamp,
                    niftyBias: niftyBias.bias,
                    entry: pattern.entryPrice,
                    sl: pattern.stopLoss,
                    date: moment().format("YYYY-MM-DD"),
                  });
                } catch (e) { console.error(`⚠️ appendSignalToFile:`, e.message); }

                try {
                  await writePatternToExcel(symbol, pattern, isFirstRun, SEND_FIRST_RUN_NOTIFICATIONS, null);
                } catch (e) { console.error(`⚠️ writePatternToExcel:`, e.message); }
              }
            }
          } catch (telegramError) {
            console.error(`❌ Telegram failed:`, telegramError.message);
          }
        } else {
          console.log(`⏭️  Already sent — skipping`);
        }
      } catch (error) {
        console.error(`Error processing ${symbol}:`, error.message);
      }

      if ((i + 1) % BATCH_SIZE === 0 && i + 1 < symbolsToProcess.length) {
        console.log(`\n⏸️  Rate limit pause ${WAIT_TIME / 1000}s after ${i + 1} symbols...\n`);
        await delay(WAIT_TIME);
      }
    }

    const cm = getActiveFuturesMonth();
    console.log("\n" + "=".repeat(60));
    console.log("📊 SUMMARY");
    console.log("=".repeat(60));
    console.log(`Completed   : ${moment().format("YYYY-MM-DD HH:mm:ss")}`);
    console.log(`Contract    : expires ${cm.expiryStr}`);
    console.log(`Processed   : ${symbolsToProcess.length}  |  Skipped: ${skippedSymbols}`);
    console.log(`Crossovers  : ${crossoversChecked}  |  With today signal: ${recentCrossovers}`);
    console.log(`Patterns    : ${patternsFound}  |  New: ${newPatternsFound}`);
    console.log("=".repeat(60));
  } catch (error) {
    console.log(error);
  }

  return signalsSentThisScan;
};

// ─── Scheduler ────────────────────────────────────────────────────────────────
const startPatternScheduler = () => {
  stopPatternScheduler();
  const now = moment();
  const endTime = moment().hour(15).minute(45).second(0).millisecond(0);

  let firstRun = moment().hour(9).minute(15).second(10).millisecond(0);
  if (now.isAfter(firstRun)) firstRun = now.clone().add(2, "seconds");

  const delayMs = Math.max(0, firstRun.diff(moment()));
  console.log(`⏳ Pattern detection starts at: ${firstRun.format("HH:mm:ss")}`);
  console.log(`⏰ Auto-stop at: ${endTime.format("HH:mm:ss")}`);

  let isFirstRun = true;

  const calculateNextAlignedRun = (now) => {
    let next = moment().hour(9).minute(15).second(10).millisecond(0);
    while (next.isSameOrBefore(now)) next.add(15, "minute");
    return next;
  };

  const scheduleNext = () => {
    const now = moment();
    if (isExecuting) {
      const d = Math.max(0, calculateNextAlignedRun(now).diff(now));
      patternSchedulerTimeout = setTimeout(scheduleNext, d);
      return;
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`▶ ${now.format("YYYY-MM-DD HH:mm:ss")} [${isFirstRun ? "INITIAL" : "SCHEDULED"}]`);
    console.log("=".repeat(60) + "\n");

    const nextRun = calculateNextAlignedRun(now);
    isExecuting = true;

    startlogic(isFirstRun)
      .then(async (signalsSentThisScan) => {
        console.log(`\n✅ Done at ${moment().format("YYYY-MM-DD HH:mm:ss")}`);

        // FIX 6: Send daily bias after EVERY scan (not just first run)
        await sendDailyBiasMessage();

        if (isFirstRun) { isFirstRun = false; }

        patternSchedulerTimeout = setTimeout(scheduleNext, Math.max(0, nextRun.diff(moment())));
      })
      .catch((err) => {
        console.error(`\n❌ Error:`, err);
        patternSchedulerTimeout = setTimeout(scheduleNext, Math.max(0, nextRun.diff(moment())));
      })
      .finally(() => { isExecuting = false; });
  };

  patternSchedulerTimeout = setTimeout(scheduleNext, delayMs);
};

const stopPatternScheduler = () => {
  if (patternSchedulerTimeout) { clearTimeout(patternSchedulerTimeout); patternSchedulerTimeout = null; }
  isExecuting = false;
};

async function main() {
  try {
    // ── Option 1: First-time / monthly auth (saves refresh token to file) ──
    // await authenticate();
    // console.log("✅ Authentication complete. You can now run runauth() daily.");
    // process.exit(0);

    // ── Option 2: Daily startup — refresh access token, then scan ──────────
    await runauth();
    startPatternScheduler();

    // ── Option 3: One-off single scan (debug / manual trigger) ─────────────
    // await runauth();
    // await startlogic(true);

    // ── Option 4: Backtest ──────────────────────────────────────────────────
    // await runauth();
    // await runBacktest();

  } catch (err) {
    console.error("❌ Fatal startup error:", err.message);
    process.exit(1);
  }
}

// ─── Unhandled rejection safety net ──────────────────────────────────────────
process.on("unhandledRejection", (reason) => {
  console.error("⚠️  Unhandled rejection:", reason?.message || reason);
  // Do NOT exit — let nodemon keep running
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3100;
app.listen(PORT, async () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  logContractInfo();
  await main(); // ← Start after server is up
});
