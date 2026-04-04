// 3C Break FILE 

const { appendSignalToFile } = require("./generateDailySummaryDocx");
const express = require("express");
const axios = require("axios");
const XLSX = require("xlsx");
require("dotenv").config();
const fs = require("fs");
const moment = require("moment");
const { writePatternToExcel } = require("./src/excelReports");
// const TelegramBot = require('node-telegram-bot-api');
const { authenticate, getStoredTokens } = require("./src/generate")
const EMAManager = require("./utils/func/emaManager");
const BCVCManager = require("./utils/func/bcvcManager");
const SRAnalyzer = require("./utils/func/srAnalyzer");
const {
  analyzeDowTheory,
  buildDowTheoryTelegramBlock,
} = require("./utils/func/dowTheory");
const { analyzeWaves, buildWaveAnalysisTelegramBlock } = require("./utils/func/waveAnalysis");
const crypto = require("crypto");

const {
  analyzeWyckoff,
  buildWyckoffTelegramBlock,
} = require("./utils/func/wyckoff");
const {
  scoreEntry,
  buildEntryMapTelegramBlock,
} = require("./utils/func/entryMap");

const bot = require("./utils/func/telegram");
const fyers = require("./utils/func/fyersapi");
const { runBacktest } = require("./src/backtestSignals");
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
const SEND_FIRST_RUN_NOTIFICATIONS = false;
// const symbols = ["NSE:ADANIGREEN-EQ", "NSE:SOLARINDS-EQ"];
const TESTING_MODE = false; // ← set false on Monday before market open

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

async function createAccess() {
  try {
    const response = await axios.post(
      "https://api-t1.fyers.in/api/v3/validate-refresh-token",
      data,
    );
    console.log("Success:", response.data.access_token);
    localStorage.setItem("token", JSON.stringify(response.data.access_token));
    const raw = localStorage.getItem("token");
    tempauth = raw ? JSON.parse(raw) : null;
    return response.data;
  } catch (error) {
    console.error("Error:", error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
    }
    throw error;
  }
}

const runauth = async () => {
  const raw = localStorage.getItem("token");
  const accessToken = raw ? JSON.parse(raw) : null;
  if (!accessToken) {
    console.error("❌ No token found. Run authenticate() first.");
    process.exit(1);
  }
  fyers.setAppId(process.env.APP_ID);
  fyers.setRedirectUrl("https://www.google.com/");
  fyers.setAccessToken(accessToken);
  tempauth = accessToken;
  const profile = await fyers.get_profile();
  console.log("✅ Auth OK:", profile);
};

// ── 🔐 AUTHENTICATE (once a month) ───────────────────────────────
authenticate().then(() => {
  console.log("✅ Authentication complete. You can now run runauth() daily.");
  process.exit(0);
}).catch(console.error);
let niftyBiasCache = null;
let niftyBiasCacheTime = null;

const getNiftyBias = async () => {
  if (
    niftyBiasCache &&
    niftyBiasCacheTime &&
    Date.now() - niftyBiasCacheTime < 15 * 60 * 1000
  ) {
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
      return {
        bias: "UNKNOWN",
        emoji: "❓",
        reason: "Insufficient data",
        ema20: "N/A",
        currentPrice: "N/A",
      };
    }

    let candles = response.candles;
    const lastCloseTime = moment
      .unix(candles[candles.length - 1][0])
      .add(15, "minutes");
    if (moment().isBefore(lastCloseTime)) candles = candles.slice(0, -1);

    const closes = candles.map((c) => parseFloat(c[4]));
    const period = 20;
    const multiplier = 2 / (period + 1);
    let ema20 = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) {
      ema20 = (closes[i] - ema20) * multiplier + ema20;
    }

    const currentPrice = closes[closes.length - 1];
    const distPct = (((currentPrice - ema20) / ema20) * 100).toFixed(2);

    let bias, emoji, reason;

    if (currentPrice > ema20 * 1.001) {
      bias = "LONG";
      emoji = "🟢";
      reason = `₹${currentPrice.toFixed(0)} above 20 EMA ₹${ema20.toFixed(0)} (+${distPct}%)`;
    } else if (currentPrice < ema20 * 0.999) {
      bias = "SHORT";
      emoji = "🔴";
      reason = `₹${currentPrice.toFixed(0)} below 20 EMA ₹${ema20.toFixed(0)} (${distPct}%)`;
    } else {
      bias = "CHOPPY";
      emoji = "⚠️";
      reason = `₹${currentPrice.toFixed(0)} at 20 EMA ₹${ema20.toFixed(0)} — no clear direction`;
    }

    const result = {
      bias,
      emoji,
      reason,
      currentPrice: +currentPrice.toFixed(2),
      ema20: +ema20.toFixed(2),
    };
    niftyBiasCache = result;
    niftyBiasCacheTime = Date.now();

    console.log(`📊 Nifty Bias: ${bias} | ${reason}`);
    return result;
  } catch (err) {
    console.error("❌ Nifty bias fetch failed:", err.message);
    return {
      bias: "UNKNOWN",
      emoji: "❓",
      reason: "Fetch error",
      ema20: "N/A",
      currentPrice: "N/A",
    };
  }
};

// ─────────────────────────────────────────────────────────────────
// BLOCK 2: Tiered exit calculator — add above startlogic()
// ─────────────────────────────────────────────────────────────────

const calcTieredExits = (entryPrice, sl, direction) => {
  const isBull = direction === "BULLISH_CROSSOVER";
  const risk = isBull
    ? +(entryPrice - sl).toFixed(2)
    : +(sl - entryPrice).toFixed(2);
  const t1 = isBull
    ? +(entryPrice + risk * 1).toFixed(2)
    : +(entryPrice - risk * 1).toFixed(2);
  const t2 = isBull
    ? +(entryPrice + risk * 2).toFixed(2)
    : +(entryPrice - risk * 2).toFixed(2);
  return { risk, t1, t2 };
};

// ─────────────────────────────────────────────────────────────────
// BLOCK 3: Daily bias message — add above startPatternScheduler()
// ─────────────────────────────────────────────────────────────────

const sendDailyBiasMessage = async () => {
  const bias = await getNiftyBias();

  const strategyLine =
    bias.bias === "LONG"
      ? "✅ Bullish setups favoured today\n⚠️  Bearish signals are counter-trend — confirm carefully"
      : bias.bias === "SHORT"
        ? "✅ Bearish setups favoured today\n⚠️  Bullish signals are counter-trend — confirm carefully"
        : "⚠️  Nifty is choppy — confirm every signal carefully before acting";

  const msg = `
${bias.emoji} <b>DAILY MARKET BIAS — ${moment().format("DD MMM YYYY")}</b>
━━━━━━━━━━━━━━━━━━━━━━━━
🧭 Bias         : <b>${bias.bias}</b>
📊 Nifty        : ₹${bias.currentPrice}
📈 20 EMA (15m) : ₹${bias.ema20}
📝 Reason       : ${bias.reason}

📋 <b>Team Strategy:</b>
${strategyLine}

⏰ ${moment().format("HH:mm:ss")}
`.trim();

  try {
    await bot.sendMessage(telegramchat, msg, { parse_mode: "HTML" });
    console.log(`✅ Daily bias message sent: ${bias.bias}`);
  } catch (err) {
    console.error("❌ Failed to send daily bias message:", err.message);
  }

  return bias;
};
// const getSRBeforeSignal = (rawCandles, signalCandleTs, signalCandleClose) => {
//   if (!rawCandles || rawCandles.length === 0) return null;

//   // Keep only candles that CLOSED before the signal candle
//   const candlesBeforeSignal = rawCandles.filter((c) => c[0] < signalCandleTs);

//   if (candlesBeforeSignal.length < 20) {
//     console.log("⚠️ Not enough pre-signal candles for SR analysis");
//     return null;
//   }

//   return srAnalyzer.analyze(candlesBeforeSignal, signalCandleClose);
// };
function loadSymbols(inputExcel, columnName = "symbol") {
  const workbook = XLSX.readFile(inputExcel);

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const data = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  if (!data.length) {
    throw new Error("Excel file is empty");
  }

  if (!(columnName in data[0])) {
    throw new Error(`Column '${columnName}' not found in Excel`);
  }

  let cleanSymbols = data
    .map((row) => String(row[columnName]).trim().toUpperCase())
    .filter((s) => s.length > 3)
    .map((s) => (s.endsWith("-EQ") ? s : `${s}-EQ`));

  console.log("✅ Symbols ready for FYERS:", cleanSymbols.slice(0, 10));
  console.log(`✅ Loaded ${cleanSymbols.length} symbols`);

  return cleanSymbols;
}

const getTradingMinutesBetween = (startUnix, endUnix) => {
  const TRADING_START = { hour: 9, minute: 15 }; // adjust to your market open
  const TRADING_END = { hour: 15, minute: 30 }; // adjust to your market close
  const TRADING_MINUTES_PER_DAY =
    TRADING_END.hour * 60 +
    TRADING_END.minute -
    (TRADING_START.hour * 60 + TRADING_START.minute);

  let start = moment.unix(startUnix);
  let end = moment.unix(endUnix);

  let totalMinutes = 0;
  let current = start.clone();

  while (current.isBefore(end)) {
    const next = moment.min(current.clone().endOf("day"), end);

    // Check if current day is a trading day (skip weekends)
    const dayOfWeek = current.day();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      const tradingStart = current
        .clone()
        .startOf("day")
        .hour(TRADING_START.hour)
        .minute(TRADING_START.minute)
        .second(0);
      const tradingEnd = current
        .clone()
        .startOf("day")
        .hour(TRADING_END.hour)
        .minute(TRADING_END.minute)
        .second(0);

      const effectiveStart = moment.max(current, tradingStart);
      const effectiveEnd = moment.min(next, tradingEnd);

      if (effectiveEnd.isAfter(effectiveStart)) {
        totalMinutes += effectiveEnd.diff(effectiveStart, "minutes");
      }
    }

    current = current
      .clone()
      .startOf("day")
      .add(1, "day")
      .hour(TRADING_START.hour)
      .minute(TRADING_START.minute)
      .second(0);
  }

  return totalMinutes;
};

// ─── isRecentEnough: accepts confirm candles from last 1 trading day ──────────
// Works correctly when market is closed (uses previous trading day as "today")
const getLastTradingDay = () => {
  let d = moment();
  // If before 9:15 AM or weekend, roll back to previous trading day
  if (d.day() === 0) d.subtract(2, "days");       // Sunday → Friday
  else if (d.day() === 6) d.subtract(1, "day");   // Saturday → Friday
  else if (d.hour() < 9 || (d.hour() === 9 && d.minute() < 15)) {
    d.subtract(1, "day");
    if (d.day() === 0) d.subtract(2, "days");     // rolled to Sunday → Friday
    if (d.day() === 6) d.subtract(1, "day");      // rolled to Saturday → Friday
  }
  return d.format("YYYY-MM-DD");
};

const isRecentEnough = (ts) => {
  const signalDate = moment.unix(ts).format("YYYY-MM-DD");
  const lastTradingDay = getLastTradingDay();
  const prevTradingDay = moment(lastTradingDay).subtract(1, "day");
  // roll back over weekends
  if (prevTradingDay.day() === 0) prevTradingDay.subtract(2, "days");
  if (prevTradingDay.day() === 6) prevTradingDay.subtract(1, "day");

  return TESTING_MODE
    ? (signalDate === lastTradingDay || signalDate === prevTradingDay.format("YYYY-MM-DD"))
    : signalDate === lastTradingDay;
};

const analyzePattern = (emadata) => {

  if (!emadata.crossover || emadata.crossover.length === 0)
    return { found: false, reason: "No crossovers found" };
  if (!emadata.rawCandles || emadata.rawCandles.length === 0)
    return { found: false, reason: "No raw candles available" };
  if (!emadata.ema9ByTimestamp)
    return { found: false, reason: "ema9ByTimestamp not available — check generateEMAReport" };
  if (!emadata.ema100ByTimestamp)
    return { found: false, reason: "ema100ByTimestamp not available — check generateEMAReport" };

  const isRecentEnough = (ts) => {
    const signalDate = moment.unix(ts).format("YYYY-MM-DD");
    const today = moment().format("YYYY-MM-DD");
    // Only today. Crossover can be any age — only the confirm candle must be today.
    return TESTING_MODE
      ? (signalDate === today || signalDate === moment().subtract(1, "days").format("YYYY-MM-DD"))
      : signalDate === today;  // ✅ production: confirm candle must be today
  };

  // ── STRICT per-candle purity check ───────────────────────────────────────
  // Scans every candle strictly AFTER crossoverTs up to and including cfTs.
  // For BULLISH: both ema9Low AND ema9High must remain > ema100 at every candle.
  // For BEARISH: both ema9High AND ema9Low must remain < ema100 at every candle.
  const isWindowPure = (crossoverTs, cfTs, crossoverType, ema9ByTimestamp, ema100ByTimestamp, rawCandles) => {
    const windowCandles = rawCandles.filter(
      (c) => c[0] > crossoverTs && c[0] <= cfTs
    );

    for (const candle of windowCandles) {
      const ts = candle[0];
      const ema9 = ema9ByTimestamp[ts];
      const ema100Entry = ema100ByTimestamp[ts];

      if (!ema9 || ema100Entry === undefined) {
        console.log(`  ⚠️  Purity check: EMA lookup miss at ${moment.unix(ts).format("HH:mm")} — treating as impure`);
        return { pure: false, failedAt: moment.unix(ts).format("HH:mm"), reason: "EMA lookup miss" };
      }

      const ema100 = ema100Entry;

      if (crossoverType === "BULLISH_CROSSOVER") {
        // Both EMA9 lines must stay ABOVE ema100
        if (ema9.ema9Low <= ema100) {
          console.log(`  🚫 Purity FAIL (BULLISH): ema9Low ₹${ema9.ema9Low.toFixed(2)} ≤ ema100 ₹${ema100.toFixed(2)} at ${moment.unix(ts).format("HH:mm")}`);
          return { pure: false, failedAt: moment.unix(ts).format("HH:mm"), reason: `ema9Low crossed below ema100` };
        }
        if (ema9.ema9High <= ema100) {
          console.log(`  🚫 Purity FAIL (BULLISH): ema9High ₹${ema9.ema9High.toFixed(2)} ≤ ema100 ₹${ema100.toFixed(2)} at ${moment.unix(ts).format("HH:mm")}`);
          return { pure: false, failedAt: moment.unix(ts).format("HH:mm"), reason: `ema9High crossed below ema100` };
        }
      } else if (crossoverType === "BEARISH_CROSSOVER") {
        // Both EMA9 lines must stay BELOW ema100
        if (ema9.ema9High >= ema100) {
          console.log(`  🚫 Purity FAIL (BEARISH): ema9High ₹${ema9.ema9High.toFixed(2)} ≥ ema100 ₹${ema100.toFixed(2)} at ${moment.unix(ts).format("HH:mm")}`);
          return { pure: false, failedAt: moment.unix(ts).format("HH:mm"), reason: `ema9High crossed above ema100` };
        }
        if (ema9.ema9Low >= ema100) {
          console.log(`  🚫 Purity FAIL (BEARISH): ema9Low ₹${ema9.ema9Low.toFixed(2)} ≥ ema100 ₹${ema100.toFixed(2)} at ${moment.unix(ts).format("HH:mm")}`);
          return { pure: false, failedAt: moment.unix(ts).format("HH:mm"), reason: `ema9Low crossed above ema100` };
        }
      }
    }

    return { pure: true };
  };

  // ── Latest crossover only ──────────────────────────────────────────────────
  const latestCrossover = emadata.crossover[0];
  const crossoverTimestamp = latestCrossover.timestampUnix;
  const ema9ByTimestamp = emadata.ema9ByTimestamp;
  const ema100ByTimestamp = emadata.ema100ByTimestamp;

  console.log(`  🔄 Using latest crossover: ${latestCrossover.type} at ${latestCrossover.timestamp}`);

  // ── Candle window ──────────────────────────────────────────────────────────
  const candlesAfterCrossover = emadata.rawCandles
    .filter((c) => c[0] > crossoverTimestamp)
    .sort((a, b) => a[0] - b[0]);

  if (candlesAfterCrossover.length < 2) {
    return {
      found: false,
      reason: `Only ${candlesAfterCrossover.length} candle(s) after latest crossover — need at least 2`,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BULLISH LOGIC
  // ═══════════════════════════════════════════════════════════════════════════
  if (latestCrossover.type === "BULLISH_CROSSOVER") {

    for (let pbIdx = 0; pbIdx < candlesAfterCrossover.length; pbIdx++) {
      const pbCandle = candlesAfterCrossover[pbIdx];
      const pbTs = pbCandle[0];
      const pbOpen = parseFloat(pbCandle[1]);
      const pbHigh = parseFloat(pbCandle[2]);
      const pbLow = parseFloat(pbCandle[3]);
      const pbClose = parseFloat(pbCandle[4]);

      const ema9AtPb = ema9ByTimestamp[pbTs]?.ema9Low;
      if (ema9AtPb === undefined) {
        console.log(`  ⚠️  EMA9(Low) lookup miss at ${moment.unix(pbTs).format("HH:mm")} — skipping`);
        continue;
      }

      if (pbLow > ema9AtPb) continue;

      console.log(`  📍 Pullback at ${moment.unix(pbTs).format("HH:mm")} | Low ₹${pbLow} ≤ EMA9(Low) ₹${ema9AtPb.toFixed(2)}`);

      for (let cfOffset = 1; cfOffset <= 3; cfOffset++) {
        const cfCandle = candlesAfterCrossover[pbIdx + cfOffset];
        if (!cfCandle) break;

        const cfTs = cfCandle[0];
        const cfOpen = parseFloat(cfCandle[1]);
        const cfHigh = parseFloat(cfCandle[2]);
        const cfLow = parseFloat(cfCandle[3]);
        const cfClose = parseFloat(cfCandle[4]);

        const ema9AtCf = ema9ByTimestamp[cfTs]?.ema9Low;
        if (ema9AtCf === undefined) {
          console.log(`  ⚠️  EMA9(Low) lookup miss at confirm ${moment.unix(cfTs).format("HH:mm")} — skipping`);
          continue;
        }

        if (cfClose <= pbHigh) {
          console.log(`  ↩️  +${cfOffset} ${moment.unix(cfTs).format("HH:mm")}: close ₹${cfClose} ≤ pb high ₹${pbHigh}`);
          continue;
        }

        if (!isRecentEnough(cfTs)) {
          console.log(`  ⏩  Confirm at ${moment.unix(cfTs).format("YYYY-MM-DD")} not recent — skipping pullback`);
          break;
        }

        // ── STRICT PURITY CHECK (replaces hasCrossoverPollution) ──────────
        const purity = isWindowPure(
          crossoverTimestamp, cfTs,
          "BULLISH_CROSSOVER",
          ema9ByTimestamp, ema100ByTimestamp,
          emadata.rawCandles
        );
        if (!purity.pure) {
          return {
            found: false,
            reason: `Bullish setup invalidated — ${purity.reason} at ${purity.failedAt}`,
          };
        }

        console.log(`  ✅ BULLISH signal | ${moment.unix(cfTs).format("HH:mm")} close ₹${cfClose} > pb high ₹${pbHigh} (+${cfOffset} candle)`);

        return {
          found: true,
          crossoverType: "BULLISH_CROSSOVER",
          crossover: latestCrossover,
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
            pullbackLow: pbLow,
            pullbackEMA9Low: +ema9AtPb.toFixed(2),
            touchedBelowEMA9: pbLow <= ema9AtPb,
            pullbackHigh: pbHigh,
            confirmClose: cfClose,
            bodyBreakAbovePullbackHigh: cfClose > pbHigh,
            confirmationOffset: cfOffset,
            purityClean: true,
          },
          summary: {
            tag: "EMA9 LOW Strategy Bullish",
            crossoverTime: latestCrossover.timestamp,
            pullbackTime: moment.unix(pbTs).format("YYYY-MM-DD HH:mm"),
            confirmationTime: moment.unix(cfTs).format("YYYY-MM-DD HH:mm"),
            crossoverPrice: latestCrossover.price,
            pullbackLow: pbLow,
            pullbackHigh: pbHigh,
            pullbackEMA9: +ema9AtPb.toFixed(2),
            confirmClose: cfClose,
            confirmHigh: cfHigh,
            confirmEMA9: +ema9AtCf.toFixed(2),
            entryPrice: cfClose,
            stopLoss: pbLow,
          },
        };
      }
    }

    return { found: false, reason: "No valid pullback + body-breakout pair found after latest bullish crossover" };

    // ═══════════════════════════════════════════════════════════════════════════
    // BEARISH LOGIC
    // ═══════════════════════════════════════════════════════════════════════════
  } else if (latestCrossover.type === "BEARISH_CROSSOVER") {

    for (let pbIdx = 0; pbIdx < candlesAfterCrossover.length; pbIdx++) {
      const pbCandle = candlesAfterCrossover[pbIdx];
      const pbTs = pbCandle[0];
      const pbOpen = parseFloat(pbCandle[1]);
      const pbHigh = parseFloat(pbCandle[2]);
      const pbLow = parseFloat(pbCandle[3]);
      const pbClose = parseFloat(pbCandle[4]);

      const ema9AtPb = ema9ByTimestamp[pbTs]?.ema9High;
      if (ema9AtPb === undefined) {
        console.log(`  ⚠️  EMA9(High) lookup miss at ${moment.unix(pbTs).format("HH:mm")} — skipping`);
        continue;
      }

      if (pbHigh < ema9AtPb) continue;

      console.log(`  📍 Bearish pullback at ${moment.unix(pbTs).format("HH:mm")} | High ₹${pbHigh} ≥ EMA9(High) ₹${ema9AtPb.toFixed(2)}`);

      for (let cfOffset = 1; cfOffset <= 3; cfOffset++) {
        const cfCandle = candlesAfterCrossover[pbIdx + cfOffset];
        if (!cfCandle) break;

        const cfTs = cfCandle[0];
        const cfOpen = parseFloat(cfCandle[1]);
        const cfHigh = parseFloat(cfCandle[2]);
        const cfLow = parseFloat(cfCandle[3]);
        const cfClose = parseFloat(cfCandle[4]);

        const ema9AtCf = ema9ByTimestamp[cfTs]?.ema9High;
        if (ema9AtCf === undefined) {
          console.log(`  ⚠️  EMA9(High) lookup miss at confirm ${moment.unix(cfTs).format("HH:mm")} — skipping`);
          continue;
        }

        if (cfClose >= pbLow) {
          console.log(`  ↩️  +${cfOffset} ${moment.unix(cfTs).format("HH:mm")}: close ₹${cfClose} ≥ pb low ₹${pbLow}`);
          continue;
        }

        if (!isRecentEnough(cfTs)) {
          console.log(`  ⏩  Bearish confirm at ${moment.unix(cfTs).format("YYYY-MM-DD")} not recent — skipping pullback`);
          break;
        }

        // ── STRICT PURITY CHECK ───────────────────────────────────────────
        const purity = isWindowPure(
          crossoverTimestamp, cfTs,
          "BEARISH_CROSSOVER",
          ema9ByTimestamp, ema100ByTimestamp,
          emadata.rawCandles
        );
        if (!purity.pure) {
          return {
            found: false,
            reason: `Bearish setup invalidated — ${purity.reason} at ${purity.failedAt}`,
          };
        }

        console.log(`  ✅ BEARISH signal | ${moment.unix(cfTs).format("HH:mm")} close ₹${cfClose} < pb low ₹${pbLow} (+${cfOffset} candle)`);

        return {
          found: true,
          crossoverType: "BEARISH_CROSSOVER",
          crossover: latestCrossover,
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
            pullbackHigh: pbHigh,
            pullbackEMA9High: +ema9AtPb.toFixed(2),
            touchedAboveEMA9: pbHigh >= ema9AtPb,
            pullbackLow: pbLow,
            confirmClose: cfClose,
            bodyBreakBelowPullbackLow: cfClose < pbLow,
            confirmationOffset: cfOffset,
            purityClean: true,
          },
          summary: {
            tag: "EMA9 HIGH Strategy Bearish",
            crossoverTime: latestCrossover.timestamp,
            pullbackTime: moment.unix(pbTs).format("YYYY-MM-DD HH:mm"),
            confirmationTime: moment.unix(cfTs).format("YYYY-MM-DD HH:mm"),
            crossoverPrice: latestCrossover.price,
            pullbackHigh: pbHigh,
            pullbackLow: pbLow,
            pullbackEMA9: +ema9AtPb.toFixed(2),
            confirmClose: cfClose,
            confirmLow: cfLow,
            confirmEMA9: +ema9AtCf.toFixed(2),
            entryPrice: cfClose,
            stopLoss: pbHigh,
          },
        };
      }
    }

    return { found: false, reason: "No valid pullback + body-breakdown pair found after latest bearish crossover" };
  }

  return { found: false, reason: `Unknown crossover type: ${latestCrossover?.type}` };
};

// ─────────────────────────────────────────────────────────────────
// analyzePattern — NEW: EMA Crossover + Pullback/Confirmation logic
// Replaces the old BCVC-based pattern detection entirely.
// bcvc param removed; emadata now carries ema9ByTimestamp.
// ─────────────────────────────────────────────────────────────────
// const analyzePattern = (emadata) => {

//   if (!emadata.crossover || emadata.crossover.length === 0)
//     return { found: false, reason: "No crossovers found" };
//   if (!emadata.rawCandles || emadata.rawCandles.length === 0)
//     return { found: false, reason: "No raw candles available" };
//   if (!emadata.ema9ByTimestamp)
//     return { found: false, reason: "ema9ByTimestamp not available — check generateEMAReport" };

//   // ── Recent-enough gate ────────────────────────────────────────────────────
//   const isRecentEnough = (ts) => {
//     const signalDate = moment.unix(ts).format("YYYY-MM-DD");
//     const today = moment().format("YYYY-MM-DD");
//     const yesterday = moment().subtract(1, "days").format("YYYY-MM-DD");
//     return TESTING_MODE
//       ? (signalDate === today || signalDate === yesterday)
//       : signalDate === today;
//   };

//   // ── Purity check ──────────────────────────────────────────────────────────
//   // "No additional EMA crossover may occur between Condition 1 and Condition 3"
//   // ANY crossover (same or opposite direction) in window (crossoverTs, cfTs]
//   // invalidates the setup.
//   //
//   // Note: crossoverType param removed — we check ALL crossovers, not just opposite.
//   const hasCrossoverPollution = (crossoverTs, cfTs, allCrossovers) => {
//     if (!allCrossovers || allCrossovers.length === 0) return false;

//     const intruder = allCrossovers.find(
//       (c) =>
//         c.timestampUnix > crossoverTs &&  // strictly after setup crossover
//         c.timestampUnix <= cfTs           // up to and including confirm candle
//     );

//     if (intruder) {
//       console.log(
//         `  🚫 Purity FAIL: ${intruder.type} at ${intruder.timestamp} ` +
//         `found in window (C1 → C3) — setup invalidated`
//       );
//       return true;
//     }
//     return false;
//   };

//   // ── Latest crossover only ──────────────────────────────────────────────────
//   const latestCrossover = emadata.crossover[0];
//   const crossoverTimestamp = latestCrossover.timestampUnix;
//   const ema9ByTimestamp = emadata.ema9ByTimestamp;
//   const allCrossovers = emadata.allCrossovers || [];

//   console.log(`  🔄 Using latest crossover: ${latestCrossover.type} at ${latestCrossover.timestamp}`);
//   console.log(`  📋 Total crossovers in history: ${allCrossovers.length}`);
//   if (emadata.crossover.length > 1) {
//     console.log(
//       `  ⚠️  ${emadata.crossover.length - 1} older crossover(s) in recent-5 ignored:`,
//       emadata.crossover.slice(1).map((c) => `${c.type} @ ${c.timestamp}`).join(" | ")
//     );
//   }

//   // ── Candle window ──────────────────────────────────────────────────────────
//   const candlesAfterCrossover = emadata.rawCandles
//     .filter((c) => c[0] > crossoverTimestamp)
//     .sort((a, b) => a[0] - b[0]);

//   if (candlesAfterCrossover.length < 2) {
//     return {
//       found: false,
//       reason: `Only ${candlesAfterCrossover.length} candle(s) after latest crossover — need at least 2`,
//     };
//   }

//   console.log(`  📊 Candles in window after crossover: ${candlesAfterCrossover.length}`);

//   // ═══════════════════════════════════════════════════════════════════════════
//   // BULLISH LOGIC
//   // ═══════════════════════════════════════════════════════════════════════════
//   if (latestCrossover.type === "BULLISH_CROSSOVER") {

//     for (let pbIdx = 0; pbIdx < candlesAfterCrossover.length; pbIdx++) {
//       const pbCandle = candlesAfterCrossover[pbIdx];
//       const pbTs = pbCandle[0];
//       const pbOpen = parseFloat(pbCandle[1]);
//       const pbHigh = parseFloat(pbCandle[2]);
//       const pbLow = parseFloat(pbCandle[3]);
//       const pbClose = parseFloat(pbCandle[4]);

//       const ema9AtPb = ema9ByTimestamp[pbTs]?.ema9Low;
//       if (ema9AtPb === undefined) {
//         console.log(`  ⚠️  EMA9(Low) lookup miss at ${moment.unix(pbTs).format("HH:mm")} — skipping`);
//         continue;
//       }

//       // Condition 2: LOW must touch or go below EMA9(Low)
//       if (pbLow > ema9AtPb) continue;

//       console.log(`  📍 Pullback at ${moment.unix(pbTs).format("HH:mm")} | Low ₹${pbLow} ≤ EMA9(Low) ₹${ema9AtPb.toFixed(2)}`);

//       // Condition 3: within 1–3 candles, body closes ABOVE pullback HIGH
//       for (let cfOffset = 1; cfOffset <= 3; cfOffset++) {
//         const cfCandle = candlesAfterCrossover[pbIdx + cfOffset];
//         if (!cfCandle) break;

//         const cfTs = cfCandle[0];
//         const cfOpen = parseFloat(cfCandle[1]);
//         const cfHigh = parseFloat(cfCandle[2]);
//         const cfLow = parseFloat(cfCandle[3]);
//         const cfClose = parseFloat(cfCandle[4]);

//         const ema9AtCf = ema9ByTimestamp[cfTs]?.ema9Low;
//         if (ema9AtCf === undefined) {
//           console.log(`  ⚠️  EMA9(Low) lookup miss at confirm ${moment.unix(cfTs).format("HH:mm")} — skipping`);
//           continue;
//         }

//         if (cfClose <= pbHigh) {
//           console.log(`  ↩️  +${cfOffset} ${moment.unix(cfTs).format("HH:mm")}: close ₹${cfClose} ≤ pb high ₹${pbHigh}`);
//           continue;
//         }

//         if (!isRecentEnough(cfTs)) {
//           console.log(`  ⏩  Confirm at ${moment.unix(cfTs).format("YYYY-MM-DD")} not recent — skipping pullback`);
//           break;
//         }

//         // ── PURITY CHECK ───────────────────────────────────────────────────
//         if (hasCrossoverPollution(crossoverTimestamp, cfTs, allCrossovers)) {
//           return { found: false, reason: "Bullish setup invalidated — crossover occurred between C1 and C3" };
//         }

//         console.log(`  ✅ BULLISH signal | ${moment.unix(cfTs).format("HH:mm")} close ₹${cfClose} > pb high ₹${pbHigh} (+${cfOffset} candle)`);

//         return {
//           found: true,
//           crossoverType: "BULLISH_CROSSOVER",
//           crossover: latestCrossover,
//           pullbackCandle: {
//             timestampUnix: pbTs,
//             timestamp: moment.unix(pbTs).format("YYYY-MM-DD HH:mm"),
//             open: pbOpen, high: pbHigh, low: pbLow, close: pbClose,
//             ema9: +ema9AtPb.toFixed(2),
//           },
//           confirmationCandle: {
//             timestampUnix: cfTs,
//             timestamp: moment.unix(cfTs).format("YYYY-MM-DD HH:mm"),
//             open: cfOpen, high: cfHigh, low: cfLow, close: cfClose,
//             ema9: +ema9AtCf.toFixed(2),
//           },
//           entryPrice: cfClose,
//           stopLoss: pbLow,
//           validation: {
//             pullbackLow: pbLow,
//             pullbackEMA9Low: +ema9AtPb.toFixed(2),
//             touchedBelowEMA9: pbLow <= ema9AtPb,
//             pullbackHigh: pbHigh,
//             confirmClose: cfClose,
//             bodyBreakAbovePullbackHigh: cfClose > pbHigh,
//             confirmationOffset: cfOffset,
//             purityClean: true,
//           },
//           summary: {
//             tag: "EMA9 LOW Strategy Bullish",
//             crossoverTime: latestCrossover.timestamp,
//             pullbackTime: moment.unix(pbTs).format("YYYY-MM-DD HH:mm"),
//             confirmationTime: moment.unix(cfTs).format("YYYY-MM-DD HH:mm"),
//             crossoverPrice: latestCrossover.price,
//             pullbackLow: pbLow,
//             pullbackHigh: pbHigh,
//             pullbackEMA9: +ema9AtPb.toFixed(2),
//             confirmClose: cfClose,
//             confirmHigh: cfHigh,
//             confirmEMA9: +ema9AtCf.toFixed(2),
//             entryPrice: cfClose,
//             stopLoss: pbLow,
//           },
//         };
//       }
//     }

//     return { found: false, reason: "No valid pullback + body-breakout pair found after latest bullish crossover" };

//     // ═══════════════════════════════════════════════════════════════════════════
//     // BEARISH LOGIC — exact mirror
//     // ═══════════════════════════════════════════════════════════════════════════
//   } else if (latestCrossover.type === "BEARISH_CROSSOVER") {

//     for (let pbIdx = 0; pbIdx < candlesAfterCrossover.length; pbIdx++) {
//       const pbCandle = candlesAfterCrossover[pbIdx];
//       const pbTs = pbCandle[0];
//       const pbOpen = parseFloat(pbCandle[1]);
//       const pbHigh = parseFloat(pbCandle[2]);
//       const pbLow = parseFloat(pbCandle[3]);
//       const pbClose = parseFloat(pbCandle[4]);

//       const ema9AtPb = ema9ByTimestamp[pbTs]?.ema9High;
//       if (ema9AtPb === undefined) {
//         console.log(`  ⚠️  EMA9(High) lookup miss at ${moment.unix(pbTs).format("HH:mm")} — skipping`);
//         continue;
//       }

//       // Condition 2: HIGH must touch or go above EMA9(High)
//       if (pbHigh < ema9AtPb) continue;

//       console.log(`  📍 Bearish pullback at ${moment.unix(pbTs).format("HH:mm")} | High ₹${pbHigh} ≥ EMA9(High) ₹${ema9AtPb.toFixed(2)}`);

//       // Condition 3: within 1–3 candles, body closes BELOW pullback LOW
//       for (let cfOffset = 1; cfOffset <= 3; cfOffset++) {
//         const cfCandle = candlesAfterCrossover[pbIdx + cfOffset];
//         if (!cfCandle) break;

//         const cfTs = cfCandle[0];
//         const cfOpen = parseFloat(cfCandle[1]);
//         const cfHigh = parseFloat(cfCandle[2]);
//         const cfLow = parseFloat(cfCandle[3]);
//         const cfClose = parseFloat(cfCandle[4]);

//         const ema9AtCf = ema9ByTimestamp[cfTs]?.ema9High;
//         if (ema9AtCf === undefined) {
//           console.log(`  ⚠️  EMA9(High) lookup miss at confirm ${moment.unix(cfTs).format("HH:mm")} — skipping`);
//           continue;
//         }

//         if (cfClose >= pbLow) {
//           console.log(`  ↩️  +${cfOffset} ${moment.unix(cfTs).format("HH:mm")}: close ₹${cfClose} ≥ pb low ₹${pbLow}`);
//           continue;
//         }

//         if (!isRecentEnough(cfTs)) {
//           console.log(`  ⏩  Bearish confirm at ${moment.unix(cfTs).format("YYYY-MM-DD")} not recent — skipping pullback`);
//           break;
//         }

//         // ── PURITY CHECK ───────────────────────────────────────────────────
//         if (hasCrossoverPollution(crossoverTimestamp, cfTs, allCrossovers)) {
//           return { found: false, reason: "Bearish setup invalidated — crossover occurred between C1 and C3" };
//         }

//         console.log(`  ✅ BEARISH signal | ${moment.unix(cfTs).format("HH:mm")} close ₹${cfClose} < pb low ₹${pbLow} (+${cfOffset} candle)`);

//         return {
//           found: true,
//           crossoverType: "BEARISH_CROSSOVER",
//           crossover: latestCrossover,
//           pullbackCandle: {
//             timestampUnix: pbTs,
//             timestamp: moment.unix(pbTs).format("YYYY-MM-DD HH:mm"),
//             open: pbOpen, high: pbHigh, low: pbLow, close: pbClose,
//             ema9: +ema9AtPb.toFixed(2),
//           },
//           confirmationCandle: {
//             timestampUnix: cfTs,
//             timestamp: moment.unix(cfTs).format("YYYY-MM-DD HH:mm"),
//             open: cfOpen, high: cfHigh, low: cfLow, close: cfClose,
//             ema9: +ema9AtCf.toFixed(2),
//           },
//           entryPrice: cfClose,
//           stopLoss: pbHigh,
//           validation: {
//             pullbackHigh: pbHigh,
//             pullbackEMA9High: +ema9AtPb.toFixed(2),
//             touchedAboveEMA9: pbHigh >= ema9AtPb,
//             pullbackLow: pbLow,
//             confirmClose: cfClose,
//             bodyBreakBelowPullbackLow: cfClose < pbLow,
//             confirmationOffset: cfOffset,
//             purityClean: true,
//           },
//           summary: {
//             tag: "EMA9 HIGH Strategy Bearish",
//             crossoverTime: latestCrossover.timestamp,
//             pullbackTime: moment.unix(pbTs).format("YYYY-MM-DD HH:mm"),
//             confirmationTime: moment.unix(cfTs).format("YYYY-MM-DD HH:mm"),
//             crossoverPrice: latestCrossover.price,
//             pullbackHigh: pbHigh,
//             pullbackLow: pbLow,
//             pullbackEMA9: +ema9AtPb.toFixed(2),
//             confirmClose: cfClose,
//             confirmLow: cfLow,
//             confirmEMA9: +ema9AtCf.toFixed(2),
//             entryPrice: cfClose,
//             stopLoss: pbHigh,
//           },
//         };
//       }
//     }

//     return { found: false, reason: "No valid pullback + body-breakdown pair found after latest bearish crossover" };
//   }

//   return { found: false, reason: `Unknown crossover type: ${latestCrossover?.type}` };
// };

module.exports = { analyzePattern };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getTradingViewLink = (symbol) => {
  // Strip NSE: prefix and -EQ suffix → e.g. "NSE:BAJAJFINSV-EQ" → "BAJAJFINSV"
  const clean = symbol.replace(/^NSE:/i, "").replace(/-EQ$/i, "");
  // 15-min chart on NSE
  return `https://www.tradingview.com/chart/?symbol=NSE%3A${clean}&interval=15`;
};

const getTrailingTradingDays = (tradingDaysCount) => {
  const now = moment();
  let calendarDaysBack = 0;
  let tradingDaysFound = 0;

  while (tradingDaysFound < tradingDaysCount) {
    calendarDaysBack++;
    const checkDate = moment().subtract(calendarDaysBack, "days");
    const dayOfWeek = checkDate.day();

    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      tradingDaysFound++;
    }
  }

  // ✅ FIX: Set lookback to 9:15 AM of that trading day, not current time
  const lookbackDate = moment()
    .subtract(calendarDaysBack, "days")
    .hour(9)
    .minute(15)
    .second(0)
    .millisecond(0);

  console.log(`📊 Trading Days Calculation:`);
  console.log(`  Requested: ${tradingDaysCount} trading days`);
  console.log(`  Requires: ${calendarDaysBack} calendar days to look back`);
  console.log(`  Lookback Date: ${lookbackDate.format("YYYY-MM-DD HH:mm:ss")}`);
  console.log(`  Today is: ${now.format("dddd, YYYY-MM-DD")}`);

  return { lookbackDate, calendarDaysBack, tradingDaysCount };
};
const generatePatternId = (symbol, pattern) => {
  const crossoverTime = pattern.crossover.timestampUnix;
  const signalTime = pattern.confirmationCandle.timestampUnix;
  const typePrefix = pattern.crossoverType === "BULLISH_CROSSOVER" ? "BULL" : "BEAR";
  return `${symbol}_${typePrefix}_${crossoverTime}_${signalTime}`;
};
// const generatePatternId = (symbol, pattern) => {
//   const crossoverTime = pattern.crossover.timestampUnix;

//   if (pattern.crossoverType === "BULLISH_CROSSOVER") {
//     const signalTime = pattern.bullishBCVC.timestampUnix;
//     return `${symbol}_BULL_${crossoverTime}_${signalTime}`;
//   } else {
//     const signalTime = pattern.redCandle.timestampUnix;
//     return `${symbol}_BEAR_${crossoverTime}_${signalTime}`;
//   }
// };

// 🎯 OPTIMIZED FOR INTRADAY: Track only within current session
// Since you run fresh daily, we only need to prevent duplicate notifications
// for SAME crossover within the trading day (not across days)
let sentPatterns = new Set(); // Patterns already notified today
let symbolCrossoverCache = new Map(); // Symbol -> {crossoverTimestamp, crossoverType} for intraday tracking

const startlogic = async (isFirstRun = false) => {
  try {
    const symbols = loadSymbols(INPUT_EXCEL, SYMBOL_COLUMN);
    console.log(symbols);
    const niftyBias = await getNiftyBias();
    console.log(
      `🧭 Nifty Bias this run: ${niftyBias.bias} | ${niftyBias.reason}`,
    );

    const now = moment();
    const today = now.format("YYYY-MM-DD");

    let bcvc = null;
    const TRADING_DAYS_LOOKBACK = 3;
    const { lookbackDate, calendarDaysBack, tradingDaysCount } = getTrailingTradingDays(TRADING_DAYS_LOOKBACK);
    const BCVC_LOOKBACK_DAYS = calendarDaysBack + 2;

    // For daily runs, we process ALL symbols that have recent crossovers
    // No need for "targeted scan" since it's fresh every morning
    const symbolsToProcess = symbols.slice(0, Math.min(208, symbols.length));

    let patternsFound = 0;
    let newPatternsFound = 0;
    let crossoversChecked = 0;
    let recentCrossovers = 0;
    let skippedSymbols = 0;
    let differentCrossoversDetected = 0;
    ``;
    const BATCH_SIZE = 25;
    const WAIT_TIME = 5000;

    console.log(`\n🕐 Current Time: ${now.format("YYYY-MM-DD HH:mm:ss")}`);
    console.log(
      `🔄 Run Type: ${isFirstRun ? "INITIAL RUN (no notifications)" : "SCHEDULED RUN (notifications enabled)"}`,
    );
    console.log(`🎯 Processing ALL symbols with recent crossovers`);
    console.log(
      `📅 Checking for crossovers since: ${lookbackDate.format("YYYY-MM-DD HH:mm:ss")} (${tradingDaysCount} trading days)`,
    );
    console.log(
      `📊 BCVC fetch period: ${BCVC_LOOKBACK_DAYS} days (${calendarDaysBack} lookback + 2 buffer)`,
    );
    console.log(
      `⚙️  Rate Limiting: Processing ${BATCH_SIZE} symbols, then waiting ${WAIT_TIME / 1000} seconds`,
    );
    console.log(`📝 Patterns already notified today: ${sentPatterns.size}`);
    console.log("=".repeat(60));

    for (let i = 0; i < symbolsToProcess.length; i++) {
      const symbol = symbolsToProcess[i];
      console.log(
        `\n--- Processing Symbol ${i + 1}/${symbolsToProcess.length}: ${symbol} ---`,
      );

      try {
        const emadata = await emaManager.generateEMAReport(symbol);

        if (!emadata.crossover || emadata.crossover.length === 0) {
          console.log(`⏭️  Skipping ${symbol}: No crossovers found`);
          continue;
        }

        crossoversChecked++;
        const latestCrossover = emadata.crossover[0];
        const crossoverTime = moment.unix(latestCrossover.timestampUnix);

        // 🔥 CRITICAL FIX: Check if this is a DIFFERENT crossover than what we've seen today
        const cachedCrossover = symbolCrossoverCache.get(symbol);
        const currentCrossoverKey = `${latestCrossover.type}_${latestCrossover.timestampUnix}`;

        let isNewOrDifferentCrossover = false;

        if (!cachedCrossover) {
          // First time seeing this symbol's crossover today
          isNewOrDifferentCrossover = true;
          symbolCrossoverCache.set(symbol, {
            crossoverTimestamp: latestCrossover.timestampUnix,
            crossoverType: latestCrossover.type,
            key: currentCrossoverKey,
          });
          console.log(
            `✓ New crossover detected for ${symbol}: ${latestCrossover.type}`,
          );
        } else if (cachedCrossover.key !== currentCrossoverKey) {
          // 🎯 DIFFERENT crossover detected (direction changed or new timestamp)
          // This is the KEY scenario: bullish -> bearish or bearish -> bullish
          isNewOrDifferentCrossover = true;
          differentCrossoversDetected++;
          console.log(`🔄 ⚡ DIFFERENT CROSSOVER DETECTED for ${symbol}!`);
          console.log(
            `   Previous: ${cachedCrossover.crossoverType} @ ${moment.unix(cachedCrossover.crossoverTimestamp).format("HH:mm")}`,
          );
          console.log(
            `   Current: ${latestCrossover.type} @ ${crossoverTime.format("HH:mm")}`,
          );
          console.log(`   👉 This is a REVERSAL - will check for new pattern`);

          // Update cache with new crossover
          symbolCrossoverCache.set(symbol, {
            crossoverTimestamp: latestCrossover.timestampUnix,
            crossoverType: latestCrossover.type,
            key: currentCrossoverKey,
          });
        }

        // ── Dedup: skip only if same direction already sent today ──────────────────
        const directionKey = `${symbol}_${latestCrossover.type.includes("BULLISH") ? "BULL" : "BEAR"}_TODAY_${today}`;

        if (!TESTING_MODE && !isFirstRun) {
          if (sentPatterns.has(directionKey)) {
            skippedSymbols++;
            console.log(`⏭️  Skipping ${symbol}: same direction (${latestCrossover.type}) already sent today`);
            continue;
          }
        }

        recentCrossovers++;
        const daysAgo = now.diff(crossoverTime, "days");
        const hoursAgo = now.diff(crossoverTime, "hours");
        const minutesAgo = now.diff(crossoverTime, "minutes");

        console.log(`✓ Recent crossover found:`);
        console.log(`  Type: ${latestCrossover.type}`);
        console.log(
          `  Time: ${crossoverTime.format("YYYY-MM-DD HH:mm:ss")} (${crossoverTime.format("dddd")})`,
        );
        console.log(
          `  Age: ${daysAgo} calendar days, ${hoursAgo % 24} hours, ${minutesAgo % 60} minutes ago`,
        );
        console.log(`  Relative: ${crossoverTime.fromNow()}`);
        let bcvc = null
        // console.log(
        //   `📊 Fetching BCVC data for ${symbol} (${BCVC_LOOKBACK_DAYS} days)...`,
        // );
        // let bcvc;

        // if (latestCrossover.type === "BEARISH_CROSSOVER") {
        //   console.log(
        //     `  🔻 Bearish crossover detected - including RED candles`,
        //   );
        //   bcvc = await bcvcManager.getHistoricalBCVC(
        //     symbol,
        //     "15",
        //     BCVC_LOOKBACK_DAYS,
        //     "red",
        //   );
        // } else {
        //   console.log(
        //     `  🚀 Bullish crossover detected - BCVC with white, orange & maroon`,
        //   );
        //   bcvc = await bcvcManager.getHistoricalBCVC(
        //     symbol,
        //     "15",
        //     BCVC_LOOKBACK_DAYS,
        //   );
        //   // No special flag needed — maroon is now always detected in analyzeBCVC
        // }

        const pattern = analyzePattern(emadata);
        if (pattern.found) {
          const signalCandle = pattern.confirmationCandle;
          const srAnalysis = srAnalyzer.analyze(emadata.rawCandles, signalCandle.close);

          // const dowAnalysis = analyzeDowTheory(
          //   emadata.rawCandles,
          //   pattern.crossoverType,
          // );
          // const dowBlock = buildDowTheoryTelegramBlock(dowAnalysis);

          // // Wyckoff analysis
          // let wyckoffAnalysis = null;
          // let wyckoffBlock = "";
          // try {
          //   wyckoffAnalysis = analyzeWyckoff(emadata.rawCandles);
          //   wyckoffBlock = buildWyckoffTelegramBlock(wyckoffAnalysis);
          // } catch (e) {
          //   console.error("⚠️ Wyckoff analysis failed:", e.message);
          // }

          // let waveAnalysis = null;
          // let waveBlock = "";
          // try {
          //   waveAnalysis = analyzeWaves(emadata.rawCandles);
          //   waveBlock = buildWaveAnalysisTelegramBlock(waveAnalysis);
          //   console.log(
          //     `🌊 Wave structure for ${symbol}: ${waveAnalysis.structureLabel} | ${waveAnalysis.waveCount} completed waves`,
          //   );
          // } catch (e) {
          //   console.error("⚠️ Wave analysis failed:", e.message);
          // }

          // Entry quality scoring
          let entryScore = null;
          let entryMapBlock = "";
          try {
            entryScore = scoreEntry({
              pattern,
              srAnalysis,
              niftyBias,
              signalCandle: pattern.confirmationCandle,
              entryPrice: pattern.entryPrice,
              stopLoss: pattern.stopLoss,
              direction: pattern.crossoverType,
            });
            // entryMapBlock = buildEntryMapTelegramBlock(entryScore);
          } catch (e) {
            console.error("⚠️ Entry scoring failed:", e.message);
          }
          patternsFound++;

          const patternId = generatePatternId(symbol, pattern);
          const isNewPattern = !sentPatterns.has(patternId);

          console.log(`✅ PATTERN FOUND for ${symbol}!`);
          console.log(`📊 Crossover Type: ${pattern.crossoverType}`);
          console.log(`🆔 Pattern ID: ${patternId}`);
          console.log(
            `🔔 Status: ${isNewPattern ? "NEW - Will send notification" : "ALREADY SENT - Skipping notification"}`,
          );

          const formattedSummary = {
            ...pattern.summary,
            crossoverTime: moment
              .unix(pattern.crossover.timestampUnix)
              .format("YYYY-MM-DD HH:mm"),
            crossoverAge: moment
              .unix(pattern.crossover.timestampUnix)
              .fromNow(),
          };

          console.log(`📊 Summary:`, JSON.stringify(formattedSummary, null, 2));
          console.log(
            `✓ Validation:`,
            JSON.stringify(pattern.validation, null, 2),
          );
          var telegramMessage = "";
          if (pattern.crossoverType === "BULLISH_CROSSOVER") {
            const tvLink = getTradingViewLink(symbol);
            const { risk, t1, t2 } = calcTieredExits(
              pattern.entryPrice,
              pattern.stopLoss,
              "BULLISH_CROSSOVER",
            );
            const pb = pattern.pullbackCandle;
            const cf = pattern.confirmationCandle;

            const alignLabel =
              niftyBias.bias === "LONG"
                ? `${niftyBias.emoji} ${niftyBias.bias} — Aligned ✅`
                : niftyBias.bias === "SHORT"
                  ? `${niftyBias.emoji} ${niftyBias.bias} — Counter Trend ⚠️`
                  : `${niftyBias.emoji} ${niftyBias.bias} — Choppy ⚠️`;

            // const srBlock = BCVCManager.buildSRTelegramBlock(srAnalysis, "BULLISH");

            telegramMessage = `
🟢 <b>BULLISH SIGNAL</b> — ${symbol}
━━━━━━━━━━━━━━━━━━━━━━━━
📊 <b>Chart       :</b> <a href="${tvLink}">${symbol} (15min)</a>
🧭 Nifty Bias  : ${alignLabel}
 
🔄 <b>Crossover   :</b> ${pattern.crossover.timestamp} (${moment.unix(pattern.crossover.timestampUnix).fromNow()})
 
📍 <b>Pullback    :</b> ${pb.timestamp}
   Low  ₹${pb.low} ≤ EMA9(Low) ₹${pb.ema9} ✅
   High ₹${pb.high} (breakout level)
 
✅ <b>Confirm     :</b> ${cf.timestamp}  (+${pattern.validation.confirmationOffset} candle)
   Close ₹${cf.close} &gt; Pullback High ₹${pb.high} ✅ (body breakout)
 
💰 <b>Entry       :</b> ₹${pattern.entryPrice}
🛑 <b>Stop Loss   :</b> ₹${pattern.stopLoss}  (pullback Low)
📐 Risk         : ₹${(pattern.entryPrice - pattern.stopLoss).toFixed(2)}
 
⏰ <b>Detected    :</b> ${moment().format("YYYY-MM-DD HH:mm:ss")}
`.trim();
          }

          // ── BEARISH message  (replace your existing bearish telegramMessage string) ──
          else if (pattern.crossoverType === "BEARISH_CROSSOVER") {
            const tvLink = getTradingViewLink(symbol);
            const { risk, t1, t2 } = calcTieredExits(
              pattern.entryPrice,
              pattern.stopLoss,
              "BEARISH_CROSSOVER",
            );
            const pb = pattern.pullbackCandle;
            const cf = pattern.confirmationCandle;

            const alignLabel =
              niftyBias.bias === "SHORT"
                ? `${niftyBias.emoji} ${niftyBias.bias} — Aligned ✅`
                : niftyBias.bias === "LONG"
                  ? `${niftyBias.emoji} ${niftyBias.bias} — Counter Trend ⚠️`
                  : `${niftyBias.emoji} ${niftyBias.bias} — Choppy ⚠️`;

            // const srBlock = BCVCManager.buildSRTelegramBlock(srAnalysis, "BEARISH");

            telegramMessage = `
🔴 <b>BEARISH SIGNAL</b> — ${symbol}
━━━━━━━━━━━━━━━━━━━━━━━━
📊 <b>Chart       :</b> <a href="${tvLink}">${symbol} (15min)</a>
🧭 Nifty Bias  : ${alignLabel}
 
🔄 <b>Crossover   :</b> ${pattern.crossover.timestamp} (${moment.unix(pattern.crossover.timestampUnix).fromNow()})
 
📍 <b>Pullback    :</b> ${pb.timestamp}
   High ₹${pb.high} ≥ EMA9(High) ₹${pb.ema9} ✅
   Low  ₹${pb.low} (breakdown level)
 
✅ <b>Confirm     :</b> ${cf.timestamp}  (+${pattern.validation.confirmationOffset} candle)
   Close ₹${cf.close} &lt; Pullback Low ₹${pb.low} ✅ (body breakdown)
 
💰 <b>Entry       :</b> ₹${pattern.entryPrice}
🛑 <b>Stop Loss   :</b> ₹${pattern.stopLoss}  (pullback High)
📐 Risk         : ₹${(pattern.stopLoss - pattern.entryPrice).toFixed(2)}
 
⏰ <b>Detected    :</b> ${moment().format("YYYY-MM-DD HH:mm:ss")}
`.trim();
          }
          const sendAndRecord = async () => {
            // 1) Telegram
            await bot.sendMessage(telegramchat, telegramMessage, {
              parse_mode: "HTML",
            });
            console.log(`✅ Telegram notification sent for ${symbol}`);

            // 2) Excel  (bcvc already in scope from the outer for-loop)
            await writePatternToExcel(
              symbol,
              pattern,
              isFirstRun,
              SEND_FIRST_RUN_NOTIFICATIONS,
              null,
            );

            // 3) Mark as sent in memory
            sentPatterns.add(patternId);
            sentPatterns.add(directionKey);
            console.log(`📝 Pattern tracked: ${patternId}`);
          };
          if (isNewPattern || TESTING_MODE) {
            newPatternsFound++;

            // ── Decide whether to send Telegram ──────────────────────────
            // First run + SEND_FIRST_RUN_NOTIFICATIONS=false → silent baseline
            // First run + SEND_FIRST_RUN_NOTIFICATIONS=true  → send all
            // Any subsequent run                             → always send
            const shouldSendTelegram = !isFirstRun || SEND_FIRST_RUN_NOTIFICATIONS;

            try {
              if (shouldSendTelegram) {
                await bot.sendMessage(telegramchat, telegramMessage, { parse_mode: "HTML" });
                console.log(`✅ Telegram notification sent for ${symbol}`);
              } else {
                console.log(`🔕 First run silent baseline — Telegram suppressed for ${symbol}`);
              }

              if (TESTING_MODE) {
                // TESTING MODE — Telegram only (if allowed above), no Excel, no JSON, no tracking
                console.log(`🧪 TESTING MODE — no Excel, no JSON, no sentPatterns tracking`);
              } else {
                // Production — always track in memory so it won't re-send next run
                sentPatterns.add(patternId);
                sentPatterns.add(directionKey);
                console.log(`📝 Pattern tracked in memory: ${patternId}`);

                // ── Save to telegram_signals.json (only if actually sent) ──
                if (shouldSendTelegram) {
                  try {
                    const symClean = symbol.replace(/^NSE:/i, "").replace(/-EQ$/i, "");
                    appendSignalToFile({
                      patternId,
                      raw: telegramMessage,
                      symbol: symClean,
                      direction: pattern.crossoverType,
                      crossoverTime: pattern.crossover.timestamp,
                      pullbackTime: pattern.pullbackCandle.timestamp,
                      confirmTime: pattern.confirmationCandle.timestamp,
                      niftyBias: niftyBias.bias,
                      niftyEmoji: niftyBias.emoji,
                      niftyAlignLabel: niftyBias.bias === "LONG"
                        ? (pattern.crossoverType === "BULLISH_CROSSOVER" ? "Aligned ✅" : "Counter Trend ⚠️")
                        : niftyBias.bias === "SHORT"
                          ? (pattern.crossoverType === "BEARISH_CROSSOVER" ? "Aligned ✅" : "Counter Trend ⚠️")
                          : "Choppy ⚠️",
                      entry: pattern.entryPrice,
                      sl: pattern.stopLoss,
                      date: moment().format("YYYY-MM-DD"),
                    });
                    console.log(`💾 Signal saved to telegram_signals.json: ${symClean}`);
                  } catch (jsonError) {
                    console.error(`⚠️  appendSignalToFile failed for ${symbol}:`, jsonError.message);
                  }
                }

                // ── Save to Excel ──────────────────────────────────────────
                try {
                  await writePatternToExcel(symbol, pattern, isFirstRun, SEND_FIRST_RUN_NOTIFICATIONS, null);
                } catch (excelError) {
                  console.error(`⚠️  writePatternToExcel failed for ${symbol}:`, excelError.message);
                }
              }
            } catch (telegramError) {
              console.error(`❌ Failed to send Telegram:`, telegramError.message);
            }
          } else {
            console.log(`⏭️  Pattern already sent — skipping`);
          }
        } else {
          console.log(`❌ Pattern not found for ${symbol}: ${pattern.reason}`);
          console.log(
            `   Will check again in next run if crossover still recent`,
          );
        }
      } catch (error) {
        console.error(`Error processing ${symbol}:`, error.message);
      }

      if ((i + 1) % BATCH_SIZE === 0 && i + 1 < symbolsToProcess.length) {
        const waitUntil = moment().add(WAIT_TIME / 1000, "seconds");
        console.log("\n" + "⏸️ ".repeat(30));
        console.log(`⏸️  RATE LIMIT: Processed ${i + 1} symbols`);
        console.log(
          `⏸️  Waiting ${WAIT_TIME / 1000} seconds to avoid API limits...`,
        );
        console.log(`⏸️  Will resume at: ${waitUntil.format("HH:mm:ss")}`);
        console.log("⏸️ ".repeat(30) + "\n");

        await delay(WAIT_TIME);

        console.log(`✅ Resuming processing...`);
      }
    }

    // Summary statistics
    console.log("\n" + "=".repeat(60));
    console.log("📊 SUMMARY STATISTICS");
    console.log("=".repeat(60));
    console.log(`Scan completed at: ${moment().format("YYYY-MM-DD HH:mm:ss")}`);
    console.log(`Total symbols in list: ${symbols.length}`);
    console.log(`Symbols processed this run: ${symbolsToProcess.length}`);
    console.log(`Symbols skipped (already sent): ${skippedSymbols}`);
    console.log(
      `🔄 Symbols with DIFFERENT crossovers today: ${differentCrossoversDetected} ⚡`,
    );
    console.log(`Symbols with crossovers: ${crossoversChecked}`);
    console.log(
      `Recent crossovers (within ${tradingDaysCount} trading days): ${recentCrossovers}`,
    );
    console.log(`Total patterns found: ${patternsFound}`);
    console.log(`New patterns (not previously notified): ${newPatternsFound}`);
    console.log(
      `Telegram notifications sent: ${isFirstRun && !SEND_FIRST_RUN_NOTIFICATIONS ? 0 : newPatternsFound}`,
    );
    console.log(`Total patterns tracked today: ${sentPatterns.size}`);
    console.log(
      `Success rate: ${recentCrossovers > 0 ? ((patternsFound / recentCrossovers) * 100).toFixed(2) : 0}%`,
    );
    console.log("=".repeat(60));
  } catch (error) {
    console.log(error);
  }
};

const startPatternScheduler = () => {
  stopPatternScheduler();

  const now = moment();
  const startTime = moment().hour(9).minute(15).second(0).millisecond(0);
  const endTime = moment().hour(15).minute(45).second(0).millisecond(0);

  // if (now.isAfter(endTime)) {
  //   console.log("⏰ Trading hours ended (after 3:15 PM). Pattern scheduler will not start.");
  //   console.log("⏰ Will resume tomorrow at 9:15 AM");
  //   return;
  // }

  // if (now.isBefore(startTime)) {
  //   console.log("⏰ Before trading hours. Pattern scheduler will start at 9:15 AM");
  //   const delay = startTime.diff(now);
  //   patternSchedulerTimeout = setTimeout(startPatternScheduler, delay);
  //   return;
  // }

  let firstRun = moment().hour(9).minute(15).second(10).millisecond(0);

  if (now.isAfter(firstRun)) {
    firstRun = now.clone().add(2, "seconds"); // run almost immediately
  }

  // if (firstRun.isAfter(endTime)) {
  //   console.log("⏰ Next run would be after 3:15 PM. Pattern scheduler stopped.");
  //   return;
  // }

  const delay = Math.max(0, firstRun.diff(moment()));
  console.log(
    `⏳ Pattern detection will start at: ${firstRun.format("HH:mm:ss")}`,
  );
  console.log(`⏰ Auto-stop scheduled at: ${endTime.format("HH:mm:ss")}`);
  console.log(`⏰ Will run every 15 minutes during trading hours\n`);

  let isFirstRun = true;

  const scheduleNext = () => {
    const now = moment();

    // if (now.isAfter(endTime)) {
    //   console.log("⏰ 3:15 PM reached. Stopping pattern scheduler...");
    //   stopPatternScheduler();
    //   return;
    // }

    if (isExecuting) {
      console.log("⚠️ startlogic already executing, skipping this cycle");

      const nextRun = calculateNextAlignedRun(now);

      if (nextRun.isAfter(endTime)) {
        console.log("⏰ Next run would be after 3:15 PM. Stopping scheduler.");
        return;
      }

      const delay = Math.max(0, nextRun.diff(now));
      patternSchedulerTimeout = setTimeout(scheduleNext, delay);
      return;
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(
      `▶ Pattern Detection Started: ${now.format("YYYY-MM-DD HH:mm:ss")}`,
    );
    console.log(`▶ Run Type: ${isFirstRun ? "INITIAL RUN" : "SCHEDULED RUN"}`);
    console.log("=".repeat(60) + "\n");

    const nextRun = calculateNextAlignedRun(now);

    isExecuting = true;
    startlogic(isFirstRun)
      .then(async () => {
        const completedAt = moment();

        console.log(
          `\n✅ Pattern detection completed at: ${completedAt.format("YYYY-MM-DD HH:mm:ss")}`,
        );

        if (isFirstRun) {
          isFirstRun = false;
          await sendDailyBiasMessage();
          console.log(
            `✅ Initial baseline established. Future runs will send Telegram notifications.\n`,
          );
        }

        if (nextRun.isAfter(endTime)) {
          console.log(
            `⏰ Next run (${nextRun.format("HH:mm:ss")}) would be after 3:15 PM. Stopping scheduler.`,
          );
          stopPatternScheduler();
          return;
        }

        console.log(
          `⏰ Next run scheduled at: ${nextRun.format("HH:mm:ss")}\n`,
        );

        const delay = Math.max(0, nextRun.diff(moment()));
        patternSchedulerTimeout = setTimeout(scheduleNext, delay);
      })
      .catch((error) => {
        console.error(`\n❌ Pattern detection error:`, error);

        if (nextRun.isAfter(endTime)) {
          console.log(
            `⏰ Next run would be after 3:15 PM. Stopping scheduler.`,
          );
          stopPatternScheduler();
          return;
        }

        console.log(`⏰ Retrying at: ${nextRun.format("HH:mm:ss")}\n`);

        const delay = Math.max(0, nextRun.diff(moment()));
        patternSchedulerTimeout = setTimeout(scheduleNext, delay);
      })
      .finally(() => {
        isExecuting = false;
      });
  };

  const calculateNextAlignedRun = (now) => {
    let nextRun = moment().hour(9).minute(15).second(10).millisecond(0);

    while (nextRun.isSameOrBefore(now)) {
      nextRun.add(15, "minute");
    }
    return nextRun;
  };

  patternSchedulerTimeout = setTimeout(scheduleNext, delay);
};

const stopPatternScheduler = () => {
  if (patternSchedulerTimeout) {
    clearTimeout(patternSchedulerTimeout);
    patternSchedulerTimeout = null;
    console.log("🛑 Pattern detection scheduler stopped.");
  }
  isExecuting = false;
};

// Start the scheduler
startPatternScheduler();
// runauth();
// startlogic(true)
// authenticate()
// runBacktest();


const PORT = process.env.PORT ? Number(process.env.PORT) : 3100;

app.listen(PORT, async () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
