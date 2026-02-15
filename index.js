const express = require("express");
const axios = require("axios");
const XLSX = require("xlsx");
require("dotenv").config();
const fs = require("fs");
const moment = require("moment");
var fyersModel = require("fyers-api-v3").fyersModel;
const { DateTime } = require("luxon");
// const TelegramBot = require('node-telegram-bot-api');
const EMAManager = require("./utils/func/emaManager");
const BCVCManager = require("./utils/func/bcvcManager");
const bot = require("./utils/func/telegram");
const fyers = require("./utils/func/fyersapi");
const { initializeServices, runScanner, CONFIG } = require("./emascanner");
const { CLIENT_RENEG_LIMIT } = require("tls");
const INPUT_EXCEL = "./NIFTY.xlsx";
const SYMBOL_COLUMN = "symbol";
// var fyers = new fyersModel({ "path": "", "enableLogging": true })
if (typeof localStorage === "undefined" || localStorage === null) {
  var LocalStorage = require("node-localstorage").LocalStorage;
  localStorage = new LocalStorage("./scratch");
}
/////////////------------ogbot
// const telegramtoken = '8199688040:AAHGqr4cECCMb9kd4qXNM5bKAXXrqj8shQk';
// const telegramchat = "-1003727905299";
/////////////------------pgfbot
// const telegramtoken = "8390227157:AAFYQ2eWFAJdm9P8me9Nk2voYe00Mn33dSU";
// const telegramchat = "8559767849";
/////////////------------pnlbot
// const telegramtoken = "7764791634:AAGGwGa6Sl7jNauuQvgnTXRTVixikBZCb-g";
const telegramchat = "7781596314";
let patternSchedulerTimeout = null;
let isExecuting = false;
const emaManager = new EMAManager(fyers);
const bcvcManager = new BCVCManager(fyers);
const symbols = [
  "NSE:EICHERMOT-EQ",

];
// Create a bot that uses 'polling' to fetch new updates
// const bot = new TelegramBot(telegramtoken, {polling: true});


// 31847270
// fa654c1bbdc73fefd2549ad3ba32b4f0
const app = express();

const refresh_token =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOlsiZDoxIiwiZDoyIiwieDowIiwieDoxIiwieDoyIl0sImF0X2hhc2giOiJnQUFBQUFCcGdaLWN4UTdoaEhfcW5EV0xWZzdUS29SOUo2dGUyV3RnbFFBUjlKY19sNm9ILXFXeEY1QWlYWncyQ0EwYkUtUUJGZVREQm42Wm13Zkh2RVZrNWFsUHYtNEdFYWNiU3p3WWhhbXFyV2hpaDEtTVdUOD0iLCJkaXNwbGF5X25hbWUiOiIiLCJvbXMiOiJLMSIsImhzbV9rZXkiOiI0ZDcwNTIwMzlmMmM2NzI3NGViNzBlZTNlZmU4NzU0Y2E3ZDAyMDg1ZTQ1ZDhkY2FlOGRiMzJiOSIsImlzRGRwaUVuYWJsZWQiOiJOIiwiaXNNdGZFbmFibGVkIjoiTiIsImZ5X2lkIjoiWFQwMzYyOSIsImFwcFR5cGUiOjEwMCwiZXhwIjoxNzcxMzc0NjAwLCJpYXQiOjE3NzAxMDI2ODQsImlzcyI6ImFwaS5meWVycy5pbiIsIm5iZiI6MTc3MDEwMjY4NCwic3ViIjoicmVmcmVzaF90b2tlbiJ9.cLq8p9w_qJs3nE8MdkPjmvzeeNUITDPjo2cvc504r6Y";
var tempauth;

const raw = localStorage.getItem("token");
tempauth = raw ? JSON.parse(raw) : null;
const authcode =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOlsiZDoxIiwiZDoyIiwieDowIiwieDoxIiwieDoyIl0sImF0X2hhc2giOiJnQUFBQUFCcGpidDZYR3BFNV9xOE1nRUpIUUh3WWJyQXRhUkFtSHlLOS13OWp6c25RTEg4SUY1bE9aek9iTVEwZWFLNXVxSWxhN1Q4alFaU1BINEM2TFhZalBjR0hESTktRVllaV9mUUQwYWd0eUJtQVJHRUlmdz0iLCJkaXNwbGF5X25hbWUiOiIiLCJvbXMiOiJLMSIsImhzbV9rZXkiOiI0ZDcwNTIwMzlmMmM2NzI3NGViNzBlZTNlZmU4NzU0Y2E3ZDAyMDg1ZTQ1ZDhkY2FlOGRiMzJiOSIsImlzRGRwaUVuYWJsZWQiOiJOIiwiaXNNdGZFbmFibGVkIjoiTiIsImZ5X2lkIjoiWFQwMzYyOSIsImFwcFR5cGUiOjEwMCwiZXhwIjoxNzcwOTQyNjAwLCJpYXQiOjE3NzA4OTYyNTAsImlzcyI6ImFwaS5meWVycy5pbiIsIm5iZiI6MTc3MDg5NjI1MCwic3ViIjoiYWNjZXNzX3Rva2VuIn0.WyKuRsHbQ0EHuHlFoaKnrjHp5D5UMtmEY_WyjGobTJg";

const appid = "KETLMLSN3I-100";
let data = {
  grant_type: "refresh_token",
  appIdHash: "e86d29ff056bcc78df9cd894f163914c9b2d7581cc0aaf417fe03cbbfbd97db4",
  refresh_token: refresh_token,
  pin: "1234",
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
    console.log("Status:", response.status);
    return response.data;
  } catch (error) {
    console.error("Error:", error.message);
    if (error.response) {
      // Server responded with error status
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
    }
    throw error;
  }
}
// createAccess()
const runauth = async () => {
  await createAccess();
  fyers.setAppId(process.env.APP_ID);

  fyers.setRedirectUrl("https://www.google.com/");

  fyers.setAccessToken(tempauth);

  fyers
    .get_profile()
    .then((response) => {
      console.log(response);
    })
    .catch((err) => {
      console.log(err);
    });
};
// runauth()
// fyers.setAppId("KETLMLSN3I-100")

// fyers.setRedirectUrl("https://www.google.com/")

// fyers.setAccessToken(tempauth)

const sendmess = () => {
  bot.sendMessage(telegramchat, "🚀  TEST</b>");
};
function loadSymbols(inputExcel, columnName = "symbol") {
  // Read Excel file
  const workbook = XLSX.readFile(inputExcel);

  // Get first sheet
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert sheet to JSON
  const data = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  if (!data.length) {
    throw new Error("Excel file is empty");
  }

  // Check if column exists
  if (!(columnName in data[0])) {
    throw new Error(`Column '${columnName}' not found in Excel`);
  }

  // Extract and clean symbols
  let cleanSymbols = data
    .map((row) => String(row[columnName]).trim().toUpperCase())
    .filter((s) => s.length > 3)
    .map((s) => (s.endsWith("-EQ") ? s : `${s}-EQ`));

  console.log("✅ Symbols ready for FYERS:", cleanSymbols.slice(0, 10));
  console.log(`✅ Loaded ${cleanSymbols.length} symbols`);

  return cleanSymbols;
}

const analyzePattern = (emadata, bcvc) => {
  // Get the most recent crossover
  if (!emadata.crossover || emadata.crossover.length === 0) {
    return { found: false, reason: "No crossovers found" };
  }

  const latestCrossover = emadata.crossover[0];
  const crossoverTimestamp = latestCrossover.timestampUnix;

  // Filter BCVC formations that occurred AFTER the crossover
  const formationsAfterCrossover = bcvc.formations
    .filter((formation) => formation.timestampUnix > crossoverTimestamp)
    .sort((a, b) => a.timestampUnix - b.timestampUnix); // Sort by time ascending

  if (formationsAfterCrossover.length === 0) {
    return {
      found: false,
      reason: "No BCVC formations found after the crossover",
    };
  }

  // For BULLISH crossover: look for BEARISH BCVC, then immediate BULLISH BCVC that crosses its high
  if (latestCrossover.type === "BULLISH_CROSSOVER") {
    // Find first BEARISH BCVC after crossover
    const firstBearishIndex = formationsAfterCrossover.findIndex(
      (f) => f.isBearish,
    );

    if (firstBearishIndex === -1) {
      return {
        found: false,
        reason: "No BEARISH BCVC found after the bullish crossover",
      };
    }

    const firstBearishBCVC = formationsAfterCrossover[firstBearishIndex];

    // Check if there's an immediate next BCVC (no gap)
    if (firstBearishIndex + 1 >= formationsAfterCrossover.length) {
      return {
        found: false,
        reason: "No BCVC found after the BEARISH BCVC",
      };
    }

    const nextBCVC = formationsAfterCrossover[firstBearishIndex + 1];

    // Must be BULLISH and immediately after (no other BCVC in between)
    if (!nextBCVC.isBullish) {
      return {
        found: false,
        reason: "Next BCVC after BEARISH is not BULLISH",
      };
    }

    // Check if BULLISH BCVC crosses the BEARISH BCVC's high
    const bearishHigh = firstBearishBCVC.high;
    const bullishCrossedHigh =
      nextBCVC.high > bearishHigh || nextBCVC.close > bearishHigh;

    if (!bullishCrossedHigh) {
      return {
        found: false,
        reason: `BULLISH BCVC (high: ${nextBCVC.high}, close: ${nextBCVC.close}) did not cross BEARISH BCVC high (${bearishHigh})`,
      };
    }

    // Pattern found!
    return {
      found: true,
      crossoverType: "BULLISH_CROSSOVER",
      crossover: latestCrossover,
      bearishBCVC: firstBearishBCVC,
      bullishBCVC: nextBCVC,
      validation: {
        isImmediate: true,
        bearishHigh: bearishHigh,
        bullishHigh: nextBCVC.high,
        bullishClose: nextBCVC.close,
        crossedHigh: bullishCrossedHigh,
      },
      summary: {
        crossoverTime: latestCrossover.timestamp,
        bearishTime: firstBearishBCVC.timestamp,
        bullishTime: nextBCVC.timestamp,
        crossoverPrice: latestCrossover.price,
        bearishClose: firstBearishBCVC.close,
        bearishHigh: bearishHigh,
        bullishClose: nextBCVC.close,
        bullishHigh: nextBCVC.high,
      },
    };
  }

  // For BEARISH crossover: look for BULLISH (WHITE) BCVC, then any RED candle that closes below its low
  else if (latestCrossover.type === "BEARISH_CROSSOVER") {
    // Find first BULLISH (WHITE) BCVC after crossover
    const firstWhiteIndex = formationsAfterCrossover.findIndex(
      (f) => f.isBullish && f.candleColor === "white",
    );

    if (firstWhiteIndex === -1) {
      return {
        found: false,
        reason: "No WHITE (BULLISH) BCVC found after the bearish crossover",
      };
    }

    const firstWhiteBCVC = formationsAfterCrossover[firstWhiteIndex];

    // Look for any RED candle after the WHITE BCVC that closes below the WHITE's low
    const redCandlesAfterWhite = formationsAfterCrossover
      .slice(firstWhiteIndex + 1)
      .filter((f) => f.candleColor === "red");

    if (redCandlesAfterWhite.length === 0) {
      return {
        found: false,
        reason: "No RED candles found after the WHITE BCVC",
      };
    }

    // Find the first RED candle that closes below the WHITE BCVC's low
    const whiteLow = firstWhiteBCVC.low;
    const redCandleBelowLow = redCandlesAfterWhite.find(
      (f) => f.close < whiteLow,
    );

    if (!redCandleBelowLow) {
      return {
        found: false,
        reason: `No RED candle closed below WHITE BCVC low (${whiteLow})`,
      };
    }

    // Pattern found!
    return {
      found: true,
      crossoverType: "BEARISH_CROSSOVER",
      crossover: latestCrossover,
      whiteBCVC: firstWhiteBCVC,
      redCandle: redCandleBelowLow,
      validation: {
        whiteLow: whiteLow,
        redClose: redCandleBelowLow.close,
        redLow: redCandleBelowLow.low,
        closedBelowWhiteLow: true,
      },
      summary: {
        crossoverTime: latestCrossover.timestamp,
        whiteTime: firstWhiteBCVC.timestamp,
        redTime: redCandleBelowLow.timestamp,
        crossoverPrice: latestCrossover.price,
        whiteClose: firstWhiteBCVC.close,
        whiteLow: whiteLow,
        redClose: redCandleBelowLow.close,
        redLow: redCandleBelowLow.low,
      },
    };
  }

  return {
    found: false,
    reason: `Unknown crossover type: ${latestCrossover.type}`,
  };
};

// Helper function to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper function to count trading days between two dates
const getTrailingTradingDays = (tradingDaysCount) => {
  const now = moment();
  let calendarDaysBack = 0;
  let tradingDaysFound = 0;

  while (tradingDaysFound < tradingDaysCount) {
    calendarDaysBack++;
    const checkDate = moment().subtract(calendarDaysBack, 'days');
    const dayOfWeek = checkDate.day(); // 0 = Sunday, 6 = Saturday

    // Count only weekdays (Monday=1 to Friday=5)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      tradingDaysFound++;
    }
  }

  const lookbackDate = moment().subtract(calendarDaysBack, 'days');

  console.log(`📊 Trading Days Calculation:`);
  console.log(`  Requested: ${tradingDaysCount} trading days`);
  console.log(`  Requires: ${calendarDaysBack} calendar days to look back`);
  console.log(`  Lookback Date: ${lookbackDate.format("YYYY-MM-DD HH:mm:ss")}`);
  console.log(`  Today is: ${now.format("dddd, YYYY-MM-DD")}`);

  return { lookbackDate, calendarDaysBack, tradingDaysCount };
};

// Generate unique pattern ID for tracking
const generatePatternId = (symbol, pattern) => {
  // Create unique ID based on symbol, crossover time, and signal candle time
  const crossoverTime = pattern.crossover.timestampUnix;

  if (pattern.crossoverType === "BULLISH_CROSSOVER") {
    const signalTime = pattern.bullishBCVC.timestampUnix;
    return `${symbol}_BULL_${crossoverTime}_${signalTime}`;
  } else {
    const signalTime = pattern.redCandle.timestampUnix;
    return `${symbol}_BEAR_${crossoverTime}_${signalTime}`;
  }
};

// Store for tracking sent patterns (persists across runs)
let sentPatterns = new Set();

const startlogic = async (isFirstRun = false) => {
  try {
    // const symbols = loadSymbols(INPUT_EXCEL, SYMBOL_COLUMN);
    console.log(symbols);

    // Get current time and calculate lookback period accounting for weekends
    const now = moment();

    // Look back 5 TRADING days (automatically accounts for weekends)
    const TRADING_DAYS_LOOKBACK = 5;
    const { lookbackDate, calendarDaysBack, tradingDaysCount } = getTrailingTradingDays(TRADING_DAYS_LOOKBACK);

    // Add buffer to BCVC fetch to ensure we have enough data
    // Use calendar days + small buffer for BCVC historical data
    const BCVC_LOOKBACK_DAYS = calendarDaysBack + 2; // +2 days buffer for safety

    let patternsFound = 0;
    let newPatternsFound = 0;
    let crossoversChecked = 0;
    let recentCrossovers = 0;

    // Rate limiting configuration
    const BATCH_SIZE = 20;
    const WAIT_TIME = 15000;

    console.log(`\n🕐 Current Time: ${now.format("YYYY-MM-DD HH:mm:ss")}`);
    console.log(`🔄 Run Type: ${isFirstRun ? "INITIAL RUN (no notifications)" : "SCHEDULED RUN (notifications enabled)"}`);
    console.log(
      `📅 Checking for crossovers since: ${lookbackDate.format("YYYY-MM-DD HH:mm:ss")}`,
    );
    console.log(
      `📊 BCVC fetch period: ${BCVC_LOOKBACK_DAYS} days (${calendarDaysBack} lookback + 2 buffer)`,
    );
    console.log(
      `⚙️  Rate Limiting: Processing ${BATCH_SIZE} symbols, then waiting ${WAIT_TIME / 1000} seconds`,
    );
    console.log(`📝 Patterns already tracked: ${sentPatterns.size}`);
    console.log("=".repeat(60));

    // Loop through symbols
    for (let i = 0; i < Math.min(208, symbols.length); i++) {
      const symbol = symbols[i];
      console.log(
        `\n--- Processing Symbol ${i + 1}/${Math.min(208, symbols.length)}: ${symbol} ---`,
      );

      try {
        // First, get EMA data to check for recent crossover
        const emadata = await emaManager.generateEMAReport(symbol);

        // Check if there are any crossovers
        if (!emadata.crossover || emadata.crossover.length === 0) {
          console.log(`⏭️  Skipping ${symbol}: No crossovers found`);
          continue;
        }

        crossoversChecked++;
        const latestCrossover = emadata.crossover[0];

        // Convert crossover timestamp to moment
        const crossoverTime = moment.unix(latestCrossover.timestampUnix);

        // Check if crossover is within lookback period
        if (crossoverTime.isBefore(lookbackDate)) {
          const daysAgo = now.diff(crossoverTime, "days");
          const hoursAgo = now.diff(crossoverTime, "hours");
          console.log(
            `⏭️  Skipping ${symbol}: Latest crossover is ${daysAgo} calendar days (${hoursAgo} hours) old`,
          );
          console.log(
            `   Crossover: ${latestCrossover.type} at ${crossoverTime.format("YYYY-MM-DD HH:mm")} (${crossoverTime.format("dddd")})`,
          );
          continue;
        }

        recentCrossovers++;
        const daysAgo = now.diff(crossoverTime, "days");
        const hoursAgo = now.diff(crossoverTime, "hours");
        const minutesAgo = now.diff(crossoverTime, "minutes");

        console.log(`✓ Recent crossover found:`);
        console.log(`  Type: ${latestCrossover.type}`);
        console.log(`  Time: ${crossoverTime.format("YYYY-MM-DD HH:mm:ss")} (${crossoverTime.format("dddd")})`);
        console.log(
          `  Age: ${daysAgo} calendar days, ${hoursAgo % 24} hours, ${minutesAgo % 60} minutes ago`,
        );
        console.log(`  Relative: ${crossoverTime.fromNow()}`);

        // Fetch BCVC data based on crossover type
        // Use calculated lookback days instead of hardcoded 50
        console.log(`📊 Fetching BCVC data for ${symbol} (${BCVC_LOOKBACK_DAYS} days)...`);
        let bcvc;

        if (latestCrossover.type === "BEARISH_CROSSOVER") {
          console.log(
            `  🔻 Bearish crossover detected - including RED candles`,
          );
          bcvc = await bcvcManager.getHistoricalBCVC(symbol, "60", BCVC_LOOKBACK_DAYS, "red");
        } else {
          console.log(
            `  🚀 Bullish crossover detected - normal BCVC (white & orange)`,
          );
          bcvc = await bcvcManager.getHistoricalBCVC(symbol, "60", BCVC_LOOKBACK_DAYS);
        }

        const pattern = analyzePattern(emadata, bcvc);
        if (pattern.found) {
          patternsFound++;

          // Generate unique ID for this pattern
          const patternId = generatePatternId(symbol, pattern);
          const isNewPattern = !sentPatterns.has(patternId);

          console.log(`✅ PATTERN FOUND for ${symbol}!`);
          console.log(`📊 Crossover Type: ${pattern.crossoverType}`);
          console.log(`🆔 Pattern ID: ${patternId}`);
          console.log(`🔔 Status: ${isNewPattern ? "NEW - Will send notification" : "ALREADY TRACKED - Skipping notification"}`);

          // Format timestamps in summary using moment
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

          // Only send Telegram if it's NOT the first run AND it's a NEW pattern
          if (!isFirstRun && isNewPattern) {
            newPatternsFound++;

            // Prepare Telegram message
            let telegramMessage = "";

            if (pattern.crossoverType === "BULLISH_CROSSOVER") {
              console.log(
                `🚀 Bullish Crossover: ${pattern.crossover.timestamp} @ ${pattern.crossover.price}`,
              );
              console.log(
                `🔴 Bearish BCVC: ${pattern.bearishBCVC.timestamp} (High: ${pattern.bearishBCVC.high})`,
              );
              console.log(
                `🚀 Bullish BCVC: ${pattern.bullishBCVC.timestamp} (High: ${pattern.bullishBCVC.high}) - CROSSED BEARISH HIGH ✓`,
              );

              // Format Telegram message for BULLISH pattern
              telegramMessage = `
🚀 <b>BULLISH PATTERN FOUND</b> 🚀

📈 <b>Symbol:</b> ${symbol}

🔄 <b>Bullish Crossover:</b>
  • Time: ${pattern.crossover.timestamp}
  • Price: ₹${pattern.crossover.price}
  • Age: ${formattedSummary.crossoverAge}

🔴 <b>Bearish BCVC:</b>
  • Time: ${pattern.bearishBCVC.timestamp}
  • High: ₹${pattern.bearishBCVC.high}
  • Close: ₹${pattern.bearishBCVC.close}

🚀 <b>Bullish BCVC (Entry Signal):</b>
  • Time: ${pattern.bullishBCVC.timestamp}
  • High: ₹${pattern.bullishBCVC.high}
  • Close: ₹${pattern.bullishBCVC.close}
  • ✅ CROSSED BEARISH HIGH

📊 <b>Validation:</b>
  • Bearish High: ₹${pattern.validation.bearishHigh}
  • Bullish High: ₹${pattern.validation.bullishHigh}
  • Bullish Close: ₹${pattern.validation.bullishClose}

⏰ <b>Detected:</b> ${moment().format("YYYY-MM-DD HH:mm:ss")}
              `.trim();
            } else if (pattern.crossoverType === "BEARISH_CROSSOVER") {
              console.log(
                `🔴 Bearish Crossover: ${pattern.crossover.timestamp} @ ${pattern.crossover.price}`,
              );
              console.log(
                `⚪ White BCVC: ${pattern.whiteBCVC.timestamp} (Low: ${pattern.whiteBCVC.low})`,
              );
              console.log(
                `🔻 Red Candle: ${pattern.redCandle.timestamp} (Close: ${pattern.redCandle.close}) - CLOSED BELOW WHITE LOW ✓`,
              );

              // Format Telegram message for BEARISH pattern
              telegramMessage = `
🔴 <b>BEARISH PATTERN FOUND</b> 🔴

📉 <b>Symbol:</b> ${symbol}

🔄 <b>Bearish Crossover:</b>
  • Time: ${pattern.crossover.timestamp}
  • Price: ₹${pattern.crossover.price}
  • Age: ${formattedSummary.crossoverAge}

⚪ <b>White BCVC:</b>
  • Time: ${pattern.whiteBCVC.timestamp}
  • Low: ₹${pattern.whiteBCVC.low}
  • Close: ₹${pattern.whiteBCVC.close}

🔻 <b>Red Candle (Entry Signal):</b>
  • Time: ${pattern.redCandle.timestamp}
  • Low: ₹${pattern.redCandle.low}
  • Close: ₹${pattern.redCandle.close}
  • ✅ CLOSED BELOW WHITE LOW

📊 <b>Validation:</b>
  • White Low: ₹${pattern.validation.whiteLow}
  • Red Close: ₹${pattern.validation.redClose}
  • Red Low: ₹${pattern.validation.redLow}

⏰ <b>Detected:</b> ${moment().format("YYYY-MM-DD HH:mm:ss")}
              `.trim();
            }

            // Send to Telegram
            try {
              await bot.sendMessage(telegramchat, telegramMessage, {
                parse_mode: "HTML",
              });
              console.log(`✅ Telegram notification sent for ${symbol}`);

              // Add to sent patterns set after successful send
              sentPatterns.add(patternId);
              console.log(`📝 Pattern tracked: ${patternId}`);
            } catch (telegramError) {
              console.error(
                `❌ Failed to send Telegram message:`,
                telegramError.message,
              );
            }
          } else {
            if (isFirstRun) {
              console.log(`🔕 First run - storing pattern without notification`);
              // Add to sent patterns set on first run
              sentPatterns.add(patternId);
              console.log(`📝 Pattern tracked: ${patternId}`);
            } else {
              console.log(`⏭️  Pattern already sent previously - skipping`);
            }
          }
        } else {
          console.log(`❌ Pattern not found for ${symbol}: ${pattern.reason}`);
        }
      } catch (error) {
        console.error(`Error processing ${symbol}:`, error.message);
      }

      // Rate limiting: Wait after every BATCH_SIZE symbols
      if ((i + 1) % BATCH_SIZE === 0 && i + 1 < Math.min(208, symbols.length)) {
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
    console.log(`Total symbols processed: ${Math.min(208, symbols.length)}`);
    console.log(`Symbols with crossovers: ${crossoversChecked}`);
    console.log(`Recent crossovers (within ${tradingDaysCount} trading days): ${recentCrossovers}`);
    console.log(`Total patterns found: ${patternsFound}`);
    console.log(`New patterns (not previously tracked): ${newPatternsFound}`);
    console.log(`Telegram notifications sent: ${isFirstRun ? 0 : newPatternsFound}`);
    console.log(`Total patterns tracked: ${sentPatterns.size}`);
    console.log(
      `Success rate: ${recentCrossovers > 0 ? ((patternsFound / recentCrossovers) * 100).toFixed(2) : 0}%`,
    );
    console.log("=".repeat(60));
  } catch (error) {
    console.log(error);
  }
};

const startPatternScheduler = () => {
  // Clear any existing scheduler first
  stopPatternScheduler();

  const now = moment();
  const startTime = moment().hour(9).minute(15).second(0).millisecond(0);
  const endTime = moment().hour(15).minute(45).second(0).millisecond(0);

  // Check if we're outside trading hours
  if (now.isAfter(endTime)) {
    console.log("⏰ Trading hours ended (after 3:15 PM). Pattern scheduler will not start.");
    console.log("⏰ Will resume tomorrow at 9:15 AM");
    return;
  }

  if (now.isBefore(startTime)) {
    console.log("⏰ Before trading hours. Pattern scheduler will start at 9:15 AM");
    const delay = startTime.diff(now);
    patternSchedulerTimeout = setTimeout(startPatternScheduler, delay);
    return;
  }

  // Determine first run time
  let firstRun = moment().hour(9).minute(15).second(0).millisecond(0);

  if (now.isAfter(firstRun)) {
    // If we're past 9:15 AM, start immediately
    firstRun = now.clone().second(0).millisecond(0);
  }

  if (firstRun.isAfter(endTime)) {
    console.log("⏰ Next run would be after 3:15 PM. Pattern scheduler stopped.");
    return;
  }

  const delay = firstRun.diff(moment());
  console.log(`⏳ Pattern detection will start at: ${firstRun.format("HH:mm:ss")}`);
  console.log(`⏰ Auto-stop scheduled at: ${endTime.format("HH:mm:ss")}`);
  console.log(`⏰ Will run every 1 hour during trading hours\n`);

  let isFirstRun = true;

  const scheduleNext = () => {
    const now = moment();

    // Check if trading hours ended
    if (now.isAfter(endTime)) {
      console.log("⏰ 3:15 PM reached. Stopping pattern scheduler...");
      stopPatternScheduler();
      return;
    }

    // Prevent concurrent executions
    if (isExecuting) {
      console.log("⚠️ startlogic already executing, skipping this cycle");

      // Calculate next aligned run time
      const nextRun = calculateNextAlignedRun(now);

      if (nextRun.isAfter(endTime)) {
        console.log("⏰ Next run would be after 3:15 PM. Stopping scheduler.");
        return;
      }

      const delay = Math.max(0, nextRun.diff(now));
      patternSchedulerTimeout = setTimeout(scheduleNext, delay);
      return;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`▶ Pattern Detection Started: ${now.format("YYYY-MM-DD HH:mm:ss")}`);
    console.log(`▶ Run Type: ${isFirstRun ? "INITIAL RUN" : "SCHEDULED RUN"}`);
    console.log('='.repeat(60) + '\n');

    // Calculate NEXT aligned run time (should be 10:15, 11:15, 12:15, etc.)
    const nextRun = calculateNextAlignedRun(now);

    // Execute startlogic with guard
    isExecuting = true;
    startlogic(isFirstRun)
      .then(() => {
        const completedAt = moment();

        console.log(`\n✅ Pattern detection completed at: ${completedAt.format("YYYY-MM-DD HH:mm:ss")}`);

        if (isFirstRun) {
          isFirstRun = false;
          console.log(`✅ Initial baseline established. Future runs will send Telegram notifications.\n`);
        }

        // Check if next run is within trading hours
        if (nextRun.isAfter(endTime)) {
          console.log(`⏰ Next run (${nextRun.format("HH:mm:ss")}) would be after 3:15 PM. Stopping scheduler.`);
          stopPatternScheduler();
          return;
        }

        console.log(`⏰ Next run scheduled at: ${nextRun.format("HH:mm:ss")}\n`);

        // Schedule next execution
        const delay = Math.max(0, nextRun.diff(moment()));
        patternSchedulerTimeout = setTimeout(scheduleNext, delay);
      })
      .catch((error) => {
        console.error(`\n❌ Pattern detection error:`, error);

        if (nextRun.isAfter(endTime)) {
          console.log(`⏰ Next run would be after 3:15 PM. Stopping scheduler.`);
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

  // Helper function to calculate next aligned run time
  const calculateNextAlignedRun = (now) => {
    // Start from 9:15 AM today
    let nextRun = moment().hour(9).minute(15).second(0).millisecond(0);

    // Keep adding 1 hour until we find a time after 'now'
    while (nextRun.isSameOrBefore(now)) {
      nextRun.add(1, 'hour');
    }

    return nextRun;
  };

  // Schedule first run
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
// runauth()

const PORT = process.env.PORT ? Number(process.env.PORT) : 3100;

app.listen(PORT, async () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
