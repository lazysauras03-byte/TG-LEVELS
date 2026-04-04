// // 3C Break FUT 

// const moment = require("moment");
// const fyers = require("./fyersapi");
// const bot = require("./telegram");
// const telegramchat = "8559767849";

// // ─── Helper: detect Fyers "invalid symbol" errors ────────────────────────────
// // Fyers returns s:"error" with a message containing "Invalid symbol" for
// // symbols that simply don't exist (e.g. SYNGENE has no Apr FUT, only Mar).
// // In these cases we should NOT waste 10 retries — bail after 1 attempt.
// const isInvalidSymbolError = (error) => {
//   if (!error) return false;
//   const msg = (error.message || "").toLowerCase();
//   const data = error.response?.data;
//   // Fyers API error body: { s: "error", code: -101, message: "Invalid symbol provided" }
//   if (data && data.s === "error" && typeof data.message === "string") {
//     if (data.message.toLowerCase().includes("invalid symbol")) return true;
//   }
//   if (msg.includes("invalid symbol")) return true;
//   return false;
// };

// // Also check the response object itself (when getHistory resolves but returns error payload)
// const isInvalidSymbolResponse = (response) => {
//   if (!response) return false;
//   if (response.s === "error" || response.s === "no_data") {
//     const msg = (response.message || "").toLowerCase();
//     if (msg.includes("invalid symbol") || msg.includes("invalid")) return true;
//   }
//   return false;
// };

// class EMAManager {
//   constructor() {
//     this.fyers = fyers;
//     this.ema9Period = 9;
//     this.ema100Period = 100;
//     this.emaCache = new Map();
//     this.timeframe = {
//       resolution: "15",
//       duration: 15,
//       rollingDays: 100,
//     };
//     this.ema9Multiplier = 2 / (this.ema9Period + 1);
//     this.ema100Multiplier = 2 / (this.ema100Period + 1);
//   }

//   isFormingCandle(candleTimestamp) {
//     const candleTime = moment.unix(candleTimestamp);
//     const closeTime = candleTime.clone().add(this.timeframe.duration, "minutes");
//     const now = moment();
//     const isForming = now.isBefore(closeTime);
//     if (isForming) {
//       console.log(
//         `🕐 Candle at ${candleTime.format("HH:mm")} is still forming (closes at ${closeTime.format("HH:mm:ss")}, now: ${now.format("HH:mm:ss")})`
//       );
//     }
//     return isForming;
//   }

//   calculateEMA(candles) {
//     if (candles.length < this.ema100Period) {
//       console.log(
//         `Not enough data. Need at least ${this.ema100Period} candles, have ${candles.length}`
//       );
//       return null;
//     }

//     const highs = candles.map((c) => parseFloat(c[2]));
//     const lows = candles.map((c) => parseFloat(c[3]));
//     const closes = candles.map((c) => parseFloat(c[4]));

//     const ema9Low = this.calculateSingleEMA(lows, this.ema9Period, this.ema9Multiplier);
//     const ema9High = this.calculateSingleEMA(highs, this.ema9Period, this.ema9Multiplier);
//     const ema100Close = this.calculateSingleEMA(closes, this.ema100Period, this.ema100Multiplier);

//     if (!ema9Low || !ema9High || !ema100Close) return null;

//     return {
//       ema9Low: ema9Low.current,
//       ema9LowPrevious: ema9Low.previous,
//       ema9High: ema9High.current,
//       ema9HighPrevious: ema9High.previous,
//       ema100Close: ema100Close.current,
//       ema100ClosePrevious: ema100Close.previous,
//       lastHigh: highs[highs.length - 1],
//       lastLow: lows[lows.length - 1],
//       lastClose: closes[closes.length - 1],
//     };
//   }

//   calculateSingleEMA(values, period, multiplier) {
//     if (values.length < period) return null;
//     let sma = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
//     let ema = sma;
//     let previousEMA = sma;
//     for (let i = period; i < values.length; i++) {
//       previousEMA = ema;
//       ema = (values[i] - ema) * multiplier + ema;
//     }
//     return { current: ema, previous: previousEMA };
//   }

//   updateEMA(symbol, newCandle) {
//     const cache = this.emaCache.get(symbol);

//     if (
//       !cache ||
//       cache.ema9Low === undefined ||
//       cache.ema9High === undefined ||
//       cache.ema100Close === undefined
//     ) {
//       console.log(`Cache miss for ${symbol}, needs initialization`);
//       return null;
//     }

//     const candleTimestamp = newCandle[0];
//     const candleTime = moment.unix(candleTimestamp);

//     if (cache.lastCandleTimestamp === candleTimestamp) {
//       console.log(
//         `⚠ Skipping update for ${symbol} - same candle already processed (${candleTime.format("YYYY-MM-DD HH:mm")})`
//       );
//       return {
//         ema9Low: cache.ema9Low,
//         ema9High: cache.ema9High,
//         ema100Close: cache.ema100Close,
//         ema9LowPrevious: cache.ema9LowPrevious,
//         ema9HighPrevious: cache.ema9HighPrevious,
//         ema100ClosePrevious: cache.ema100ClosePrevious,
//       };
//     }

//     if (cache.lastCandleTimestamp) {
//       const lastTime = moment.unix(cache.lastCandleTimestamp);
//       const minutesDiff = candleTime.diff(lastTime, "minutes");
//       const expectedDiff = this.timeframe.duration;

//       if (minutesDiff > expectedDiff) {
//         const missedCandles = Math.floor(minutesDiff / expectedDiff) - 1;
//         console.error(`🔴 CANDLE GAP DETECTED for ${symbol}!`);
//         console.error(`   Last processed: ${lastTime.format("YYYY-MM-DD HH:mm")}`);
//         console.error(`   New candle: ${candleTime.format("YYYY-MM-DD HH:mm")}`);
//         console.error(`   Gap: ${minutesDiff} minutes (${missedCandles} candles missed)`);
//         console.error(`   ⚠ FORCING REINITIALIZATION`);
//         this.emaCache.delete(symbol);
//         return null;
//       }

//       if (minutesDiff < 0) {
//         console.error(`🔴 OUT-OF-ORDER CANDLE for ${symbol}!`);
//         console.error(`   Last processed: ${lastTime.format("YYYY-MM-DD HH:mm")}`);
//         console.error(`   New candle: ${candleTime.format("YYYY-MM-DD HH:mm")} (${Math.abs(minutesDiff)} min in the past)`);
//         console.error(`   ⚠ Ignoring this candle`);
//         return {
//           ema9Low: cache.ema9Low,
//           ema9High: cache.ema9High,
//           ema100Close: cache.ema100Close,
//           ema9LowPrevious: cache.ema9LowPrevious,
//           ema9HighPrevious: cache.ema9HighPrevious,
//           ema100ClosePrevious: cache.ema100ClosePrevious,
//         };
//       }
//     }

//     const currentHigh = parseFloat(newCandle[2]);
//     const currentLow = parseFloat(newCandle[3]);
//     const currentClose = parseFloat(newCandle[4]);

//     const newEma9Low = (currentLow - cache.ema9Low) * this.ema9Multiplier + cache.ema9Low;
//     const newEma9High = (currentHigh - cache.ema9High) * this.ema9Multiplier + cache.ema9High;
//     const newEma100Close = (currentClose - cache.ema100Close) * this.ema100Multiplier + cache.ema100Close;

//     const ema9LowPrevious = cache.ema9Low;
//     const ema9HighPrevious = cache.ema9High;
//     const ema100ClosePrevious = cache.ema100Close;

//     this.emaCache.set(symbol, {
//       ema9Low: newEma9Low,
//       ema9High: newEma9High,
//       ema100Close: newEma100Close,
//       ema9LowPrevious,
//       ema9HighPrevious,
//       ema100ClosePrevious,
//       lastHigh: currentHigh,
//       lastLow: currentLow,
//       lastClose: currentClose,
//       lastUpdate: Date.now(),
//       lastCandleTimestamp: candleTimestamp,
//       symbol,
//     });

//     return {
//       ema9Low: newEma9Low,
//       ema9High: newEma9High,
//       ema100Close: newEma100Close,
//       ema9LowPrevious,
//       ema9HighPrevious,
//       ema100ClosePrevious,
//     };
//   }

//   async getEMA(symbol, maxRetries = 10, retryDelay = 2000) {
//     const cache = this.emaCache.get(symbol);

//     const needsInit =
//       !cache ||
//       cache.symbol !== symbol ||
//       cache.ema9Low === undefined ||
//       cache.ema9High === undefined ||
//       cache.ema100Close === undefined ||
//       Date.now() - cache.lastUpdate > 24 * 60 * 60 * 1000;

//     if (needsInit) {
//       if (cache && cache.symbol !== symbol) {
//         console.log(`🔄 Symbol changed, clearing cache for ${symbol}`);
//         this.emaCache.delete(symbol);
//       }

//       console.log(`🔧 Initializing EMA for ${symbol}...`);

//       let retryCount = 0;
//       while (retryCount < maxRetries) {
//         try {
//           const validTo = moment();
//           const validFrom = validTo.clone().subtract(this.timeframe.rollingDays, "days");

//           const response = await this.fyers.getHistory({
//             symbol,
//             resolution: this.timeframe.resolution,
//             date_format: "1",
//             range_from: validFrom.format("YYYY-MM-DD"),
//             range_to: validTo.format("YYYY-MM-DD"),
//             cont_flag: "1",
//           });

//           // FIX: Detect invalid symbol from response payload — bail immediately (1 attempt)
//           if (isInvalidSymbolResponse(response)) {
//             console.warn(`⚠️  Symbol ${symbol} is invalid on Fyers (no contract exists). Skipping.`);
//             return null;
//           }

//           if (!response || !response.candles || response.candles.length === 0) {
//             console.log(`No data for ${symbol}, retry ${retryCount + 1}/${maxRetries}`);
//             retryCount++;
//             if (retryCount < maxRetries) await this.sleep(Math.max(retryDelay * retryCount, 2000));
//             continue;
//           }

//           let candles = response.candles;
//           const lastCandle = candles[candles.length - 1];
//           if (this.isFormingCandle(lastCandle[0])) {
//             console.log(`🔧 Removing forming candle at ${moment.unix(lastCandle[0]).format("HH:mm")} for initialization`);
//             candles = candles.slice(0, -1);
//           }

//           const emaResult = this.calculateEMA(candles);

//           if (emaResult) {
//             const lastCompletedCandle = candles[candles.length - 1];
//             const lastCandleTimestamp = lastCompletedCandle[0];

//             this.emaCache.set(symbol, {
//               ema9Low: emaResult.ema9Low,
//               ema9High: emaResult.ema9High,
//               ema100Close: emaResult.ema100Close,
//               ema9LowPrevious: emaResult.ema9LowPrevious,
//               ema9HighPrevious: emaResult.ema9HighPrevious,
//               ema100ClosePrevious: emaResult.ema100ClosePrevious,
//               lastHigh: emaResult.lastHigh,
//               lastLow: emaResult.lastLow,
//               lastClose: emaResult.lastClose,
//               lastUpdate: Date.now(),
//               lastCandleTimestamp,
//               symbol,
//             });

//             console.log(`✅ EMA initialized for ${symbol}:`);
//             console.log(`   9 EMA Low:  ${emaResult.ema9Low.toFixed(2)}  (prev: ${emaResult.ema9LowPrevious?.toFixed(2) ?? "N/A"})`);
//             console.log(`   9 EMA High: ${emaResult.ema9High.toFixed(2)} (prev: ${emaResult.ema9HighPrevious?.toFixed(2) ?? "N/A"})`);
//             console.log(`   100 EMA Close: ${emaResult.ema100Close.toFixed(2)}`);
//             console.log(`   Completed candle: ${moment.unix(lastCandleTimestamp).format("YYYY-MM-DD HH:mm")}`);

//             return {
//               symbol,
//               ema9Low: emaResult.ema9Low,
//               ema9High: emaResult.ema9High,
//               ema100Close: emaResult.ema100Close,
//               ema9LowPrevious: emaResult.ema9LowPrevious,
//               ema9HighPrevious: emaResult.ema9HighPrevious,
//               ema100ClosePrevious: emaResult.ema100ClosePrevious,
//               timestamp: moment.unix(lastCandleTimestamp).format("YYYY-MM-DD HH:mm"),
//               candleCount: candles.length,
//               isLive: false,
//             };
//           } else {
//             console.log(`❌ EMA calculation failed for ${symbol}, retry ${retryCount + 1}/${maxRetries}`);
//           }

//           retryCount++;
//           if (retryCount < maxRetries) await this.sleep(retryDelay * retryCount);
//         } catch (error) {
//           // FIX: Invalid symbol error → bail after 1 attempt, no retries
//           if (isInvalidSymbolError(error)) {
//             console.warn(`⚠️  Invalid symbol ${symbol} — Fyers has no contract for this ticker. Skipping after 1 attempt.`);
//             return null;
//           }
//           console.error(`Error initializing EMA for ${symbol} (${retryCount + 1}/${maxRetries}):`, error.message);
//           retryCount++;
//           if (retryCount < maxRetries) await this.sleep(retryDelay * retryCount);
//         }
//       }

//       console.error(`❌ Failed to initialize EMA for ${symbol} after ${maxRetries} attempts`);
//       return null;
//     }

//     // ── Live update path ──
//     let retryCount = 0;
//     while (retryCount < maxRetries) {
//       try {
//         const validTo = moment();
//         const validFrom = validTo.clone().subtract(5, "hours");

//         const response = await this.fyers.getHistory({
//           symbol,
//           resolution: this.timeframe.resolution,
//           date_format: "1",
//           range_from: validFrom.format("YYYY-MM-DD"),
//           range_to: validTo.format("YYYY-MM-DD"),
//           cont_flag: "1",
//         });

//         // FIX: Invalid symbol on live update path too — bail immediately
//         if (isInvalidSymbolResponse(response)) {
//           console.warn(`⚠️  Symbol ${symbol} is invalid on Fyers. Skipping.`);
//           return null;
//         }

//         if (!response || !response.candles || response.candles.length === 0) {
//           console.log(`No candle data for ${symbol}, retry ${retryCount + 1}/${maxRetries}`);
//           retryCount++;
//           if (retryCount < maxRetries) { await this.sleep(retryDelay * retryCount); continue; }
//           if (cache?.ema9Low !== undefined) {
//             console.log(`⚠️ Returning cached EMA values for ${symbol}`);
//             return {
//               symbol,
//               ema9Low: cache.ema9Low,
//               ema9High: cache.ema9High,
//               ema100Close: cache.ema100Close,
//               ema9LowPrevious: cache.ema9LowPrevious,
//               ema9HighPrevious: cache.ema9HighPrevious,
//               ema100ClosePrevious: cache.ema100ClosePrevious,
//               timestamp: moment.unix(cache.lastCandleTimestamp).format("YYYY-MM-DD HH:mm"),
//               candleCount: 0,
//               isLive: false,
//               cached: true,
//             };
//           }
//           return null;
//         }

//         let completedCandles = response.candles.filter((c) => !this.isFormingCandle(c[0]));

//         if (completedCandles.length === 0) {
//           console.log(`⚠️ No completed candles available yet for ${symbol}`);
//           retryCount++;
//           if (retryCount < maxRetries) { await this.sleep(retryDelay * retryCount); continue; }
//           if (cache?.ema9Low !== undefined) {
//             return {
//               symbol,
//               ema9Low: cache.ema9Low,
//               ema9High: cache.ema9High,
//               ema100Close: cache.ema100Close,
//               ema9LowPrevious: cache.ema9LowPrevious,
//               ema9HighPrevious: cache.ema9HighPrevious,
//               ema100ClosePrevious: cache.ema100ClosePrevious,
//               timestamp: moment.unix(cache.lastCandleTimestamp).format("YYYY-MM-DD HH:mm"),
//               candleCount: 0,
//               isLive: false,
//               cached: true,
//             };
//           }
//           return null;
//         }

//         const lastCompletedCandle = completedCandles[completedCandles.length - 1];
//         const candleTimestamp = lastCompletedCandle[0];
//         const emaData = this.updateEMA(symbol, lastCompletedCandle);

//         if (emaData !== null && emaData.ema9Low !== undefined) {
//           console.log(`✅ EMA updated for ${symbol}:`);
//           console.log(`   9 EMA Low:  ${emaData.ema9Low.toFixed(2)}  (prev: ${emaData.ema9LowPrevious?.toFixed(2) ?? "N/A"})`);
//           console.log(`   9 EMA High: ${emaData.ema9High.toFixed(2)} (prev: ${emaData.ema9HighPrevious?.toFixed(2) ?? "N/A"})`);
//           console.log(`   100 EMA Close: ${emaData.ema100Close.toFixed(2)}`);
//           console.log(`   Completed candle: ${moment.unix(candleTimestamp).format("YYYY-MM-DD HH:mm")}`);

//           return {
//             symbol,
//             ema9Low: emaData.ema9Low,
//             ema9High: emaData.ema9High,
//             ema100Close: emaData.ema100Close,
//             ema9LowPrevious: emaData.ema9LowPrevious,
//             ema9HighPrevious: emaData.ema9HighPrevious,
//             ema100ClosePrevious: emaData.ema100ClosePrevious,
//             timestamp: moment.unix(candleTimestamp).format("YYYY-MM-DD HH:mm"),
//             candleCount: completedCandles.length,
//             isLive: false,
//           };
//         }

//         console.log(`🔄 Cache lost or gap detected for ${symbol}, reinitializing...`);
//         this.emaCache.delete(symbol);
//         await this.sleep(2000);
//         return await this.getEMA(symbol, 8, retryDelay);
//       } catch (error) {
//         // FIX: Invalid symbol on live update — bail immediately
//         if (isInvalidSymbolError(error)) {
//           console.warn(`⚠️  Invalid symbol ${symbol} — skipping after 1 attempt.`);
//           return null;
//         }
//         console.error(`Error updating EMA for ${symbol} (${retryCount + 1}/${maxRetries}):`, error.message);
//         retryCount++;
//         if (retryCount < maxRetries) await this.sleep(retryDelay * retryCount);
//       }
//     }

//     if (cache?.ema9Low !== undefined) {
//       console.log(`⚠️ All retries failed, returning cached EMA values for ${symbol}`);
//       return {
//         symbol,
//         ema9Low: cache.ema9Low,
//         ema9High: cache.ema9High,
//         ema100Close: cache.ema100Close,
//         ema9LowPrevious: cache.ema9LowPrevious,
//         ema9HighPrevious: cache.ema9HighPrevious,
//         ema100ClosePrevious: cache.ema100ClosePrevious,
//         timestamp: moment.unix(cache.lastCandleTimestamp).format("YYYY-MM-DD HH:mm"),
//         candleCount: 0,
//         isLive: false,
//         cached: true,
//       };
//     }

//     console.error(`❌ Failed to get EMA for ${symbol} after ${maxRetries} attempts`);
//     return null;
//   }

//   sleep(ms) {
//     return new Promise((resolve) => setTimeout(resolve, ms));
//   }

//   async getMultipleEMA(symbols, maxRetries = 10, retryDelay = 2000) {
//     const results = {};
//     for (const symbol of symbols) {
//       results[symbol] = await this.getEMA(symbol, maxRetries, retryDelay);
//     }
//     return results;
//   }

//   clearSymbolData(symbol) {
//     if (this.emaCache.has(symbol)) {
//       this.emaCache.delete(symbol);
//       console.log(`✓ Cleared EMA data for symbol ${symbol}`);
//     }
//   }

//   clearAllCache() {
//     this.emaCache.clear();
//     console.log("✓ EMA cache cleared completely");
//   }

//   getCacheStatus() {
//     return Array.from(this.emaCache.entries()).map(([, value]) => ({
//       symbol: value.symbol,
//       lastUpdate: new Date(value.lastUpdate).toLocaleTimeString(),
//       lastCandleTimestamp: moment.unix(value.lastCandleTimestamp).format("YYYY-MM-DD HH:mm"),
//       ema9Low: value.ema9Low?.toFixed(2),
//       ema9High: value.ema9High?.toFixed(2),
//       ema100Close: value.ema100Close?.toFixed(2),
//       ema9LowPrevious: value.ema9LowPrevious?.toFixed(2),
//       ema9HighPrevious: value.ema9HighPrevious?.toFixed(2),
//       ema100ClosePrevious: value.ema100ClosePrevious?.toFixed(2),
//       lastHigh: value.lastHigh?.toFixed(2),
//       lastLow: value.lastLow?.toFixed(2),
//       lastClose: value.lastClose?.toFixed(2),
//     }));
//   }

//   getDebugInfo(symbol) {
//     const cache = this.emaCache.get(symbol);
//     if (!cache) return { error: "Symbol not found in cache" };
//     return {
//       symbol: cache.symbol,
//       lastUpdate: new Date(cache.lastUpdate).toLocaleString(),
//       lastCandleTimestamp: moment.unix(cache.lastCandleTimestamp).format("YYYY-MM-DD HH:mm"),
//       ema9Low: cache.ema9Low?.toFixed(2),
//       ema9High: cache.ema9High?.toFixed(2),
//       ema100Close: cache.ema100Close?.toFixed(2),
//       ema9LowPrevious: cache.ema9LowPrevious?.toFixed(2),
//       ema9HighPrevious: cache.ema9HighPrevious?.toFixed(2),
//       ema100ClosePrevious: cache.ema100ClosePrevious?.toFixed(2),
//       lastHigh: cache.lastHigh?.toFixed(2),
//       lastLow: cache.lastLow?.toFixed(2),
//       lastClose: cache.lastClose?.toFixed(2),
//     };
//   }

//   async analyzeSymbol(symbol, maxRetries = 10, retryDelay = 2000) {
//     console.log(`\n=== Analyzing Symbol: ${symbol} ===`);
//     const emaData = await this.getEMA(symbol, maxRetries, retryDelay);
//     if (emaData) {
//       console.log(`  9 EMA Low:  ${emaData.ema9Low.toFixed(2)}`);
//       console.log(`  9 EMA High: ${emaData.ema9High?.toFixed(2) ?? "N/A"}`);
//       console.log(`  100 EMA Close: ${emaData.ema100Close.toFixed(2)}`);
//       console.log(`  Timestamp: ${emaData.timestamp}`);
//       return {
//         ema9Low: emaData.ema9Low,
//         ema9High: emaData.ema9High,
//         ema100Close: emaData.ema100Close,
//         ema9LowPrevious: emaData.ema9LowPrevious,
//         ema9HighPrevious: emaData.ema9HighPrevious,
//         ema100ClosePrevious: emaData.ema100ClosePrevious,
//         timestamp: emaData.timestamp,
//       };
//     } else {
//       console.log(`  Failed to calculate EMA`);
//       return null;
//     }
//   }

//   async getHistoricalEMA(symbol, days = 5, maxRetries = 10, retryDelay = 2000) {
//     console.log(`🔍 Fetching ${days} days of EMA history for ${symbol}...`);

//     let retryCount = 0;
//     while (retryCount < maxRetries) {
//       try {
//         const validTo = moment();
//         const validFrom = validTo.clone().subtract(this.timeframe.rollingDays, "days");

//         const response = await this.fyers.getHistory({
//           symbol,
//           resolution: this.timeframe.resolution,
//           date_format: "1",
//           range_from: validFrom.format("YYYY-MM-DD"),
//           range_to: validTo.format("YYYY-MM-DD"),
//           cont_flag: "1",
//         });

//         // FIX: Detect invalid symbol from response payload — bail immediately (1 attempt only)
//         if (isInvalidSymbolResponse(response)) {
//           console.warn(`⚠️  Symbol ${symbol} is invalid on Fyers (no contract exists for this expiry). Skipping after 1 attempt.`);
//           return null;
//         }

//         if (!response || !response.candles || response.candles.length === 0) {
//           console.log(`No data for ${symbol}, retry ${retryCount + 1}/${maxRetries}`);
//           retryCount++;
//           if (retryCount < maxRetries) { await this.sleep(Math.max(retryDelay * retryCount, 2000)); continue; }
//           console.error(`❌ Failed to get candle data after ${maxRetries} retries`);
//           return null;
//         }

//         let candles = response.candles;
//         const lastCandle = candles[candles.length - 1];
//         if (this.isFormingCandle(lastCandle[0])) {
//           console.log(`🔧 Removing forming candle for historical analysis`);
//           candles = candles.slice(0, -1);
//         }

//         const emaHistory = [];
//         const crossovers = [];
//         const ema9SeriesFull = [];
//         const ema100SeriesFull = [];
//         let bullishCrossovers = 0;
//         let bearishCrossovers = 0;
//         let currentTrend = null;
//         let trendDuration = 0;

//         for (let i = this.ema100Period; i < candles.length; i++) {
//           const candlesUpToIndex = candles.slice(0, i + 1);
//           const emaResult = this.calculateEMA(candlesUpToIndex);

//           if (emaResult) {
//             const candle = candles[i];
//             const timestamp = candle[0];
//             const open = parseFloat(candle[1]);
//             const high = parseFloat(candle[2]);
//             const low = parseFloat(candle[3]);
//             const close = parseFloat(candle[4]);
//             const volume = parseFloat(candle[5]);

//             const ema9Low = emaResult.ema9Low;
//             const ema9High = emaResult.ema9High;
//             const ema100Close = emaResult.ema100Close;

//             ema9SeriesFull.push({ timestampUnix: timestamp, ema9Low, ema9High });
//             ema100SeriesFull.push({ timestampUnix: timestamp, ema100Close });

//             const isBullishTrend = ema9Low > ema100Close;
//             const isBearishTrend = ema9High < ema100Close;
//             const trend = isBullishTrend ? "BULLISH" : isBearishTrend ? "BEARISH" : "NEUTRAL";

//             if (i > this.ema100Period) {
//               const prevEmaResult = this.calculateEMA(candles.slice(0, i));
//               if (prevEmaResult) {
//                 const prevEma9Low = prevEmaResult.ema9Low;
//                 const prevEma9High = prevEmaResult.ema9High;
//                 const prevEma100Close = prevEmaResult.ema100Close;

//                 if (prevEma9Low <= prevEma100Close && ema9Low > ema100Close) {
//                   bullishCrossovers++;
//                   crossovers.push({
//                     timestamp: moment.unix(timestamp).format("YYYY-MM-DD HH:mm"),
//                     timestampUnix: timestamp,
//                     type: "BULLISH_CROSSOVER",
//                     ema9Low,
//                     ema100Close,
//                     price: close,
//                     description: "🚀 9 EMA(Low) crossed above 100 EMA(Close)",
//                   });
//                 }

//                 if (prevEma9High >= prevEma100Close && ema9High < ema100Close) {
//                   bearishCrossovers++;
//                   crossovers.push({
//                     timestamp: moment.unix(timestamp).format("YYYY-MM-DD HH:mm"),
//                     timestampUnix: timestamp,
//                     type: "BEARISH_CROSSOVER",
//                     ema9High,
//                     ema100Close,
//                     price: close,
//                     description: "🔴 9 EMA(High) crossed below 100 EMA(Close)",
//                   });
//                 }
//               }
//             }

//             if (trend === currentTrend) {
//               trendDuration++;
//             } else {
//               currentTrend = trend;
//               trendDuration = 1;
//             }

//             const periodStartTimestamp = validTo.clone().subtract(days, "days").unix();
//             if (timestamp >= periodStartTimestamp) {
//               emaHistory.push({
//                 timestamp: moment.unix(timestamp).format("YYYY-MM-DD HH:mm"),
//                 timestampUnix: timestamp,
//                 open, high, low, close, volume,
//                 ema9Low,
//                 ema9High,
//                 ema100Close,
//                 trend,
//                 emaDifference: ema9Low - ema100Close,
//                 emaDifferencePercent: (((ema9Low - ema100Close) / ema100Close) * 100).toFixed(2),
//               });
//             }
//           }
//         }

//         const totalCandles = emaHistory.length;
//         const bullishCandles = emaHistory.filter((h) => h.trend === "BULLISH").length;
//         const bearishCandles = emaHistory.filter((h) => h.trend === "BEARISH").length;
//         const avgEma9Low = totalCandles > 0 ? emaHistory.reduce((s, h) => s + h.ema9Low, 0) / totalCandles : 0;
//         const avgEma100Close = totalCandles > 0 ? emaHistory.reduce((s, h) => s + h.ema100Close, 0) / totalCandles : 0;

//         const largestBullishSpread = [...emaHistory].filter((h) => h.trend === "BULLISH").sort((a, b) => b.emaDifference - a.emaDifference)[0];
//         const largestBearishSpread = [...emaHistory].filter((h) => h.trend === "BEARISH").sort((a, b) => a.emaDifference - b.emaDifference)[0];

//         const result = {
//           symbol,
//           period: `${days} days`,
//           periodStart: validTo.clone().subtract(days, "days").format("YYYY-MM-DD"),
//           periodEnd: validTo.format("YYYY-MM-DD"),
//           totalCandles,

//           trendStats: {
//             bullishCandles,
//             bearishCandles,
//             bullishPercentage: ((bullishCandles / totalCandles) * 100).toFixed(2),
//             bearishPercentage: ((bearishCandles / totalCandles) * 100).toFixed(2),
//             currentTrend: emaHistory.length > 0 ? emaHistory[emaHistory.length - 1].trend : null,
//             currentTrendDuration: trendDuration,
//           },

//           crossoverStats: {
//             bullishCrossovers,
//             bearishCrossovers,
//             totalCrossovers: bullishCrossovers + bearishCrossovers,
//             allCrossovers: crossovers,
//           },

//           emaStats: {
//             avgEma9Low: avgEma9Low.toFixed(2),
//             avgEma100Close: avgEma100Close.toFixed(2),
//             currentEma9Low: emaHistory.length > 0 ? emaHistory[emaHistory.length - 1].ema9Low.toFixed(2) : null,
//             currentEma9High: emaHistory.length > 0 ? emaHistory[emaHistory.length - 1].ema9High?.toFixed(2) : null,
//             currentEma100Close: emaHistory.length > 0 ? emaHistory[emaHistory.length - 1].ema100Close.toFixed(2) : null,
//           },

//           spreadAnalysis: {
//             largestBullishSpread: largestBullishSpread ? {
//               timestamp: largestBullishSpread.timestamp,
//               difference: largestBullishSpread.emaDifference.toFixed(2),
//               differencePercent: largestBullishSpread.emaDifferencePercent,
//             } : null,
//             largestBearishSpread: largestBearishSpread ? {
//               timestamp: largestBearishSpread.timestamp,
//               difference: largestBearishSpread.emaDifference.toFixed(2),
//               differencePercent: largestBearishSpread.emaDifferencePercent,
//             } : null,
//           },

//           history: emaHistory,
//           current: emaHistory.length > 0 ? emaHistory[emaHistory.length - 1] : null,
//         };

//         result._rawCandles = candles;
//         result.ema9SeriesFull = ema9SeriesFull;
//         result.ema100SeriesFull = ema100SeriesFull;
//         return result;

//       } catch (error) {
//         // FIX: Invalid symbol — bail after 1 attempt
//         if (isInvalidSymbolError(error)) {
//           console.warn(`⚠️  Invalid symbol ${symbol} — no contract exists. Skipping after 1 attempt.`);
//           return null;
//         }
//         console.error(`Error fetching historical EMA for ${symbol} (${retryCount + 1}/${maxRetries}):`, error.message);
//         retryCount++;
//         if (retryCount < maxRetries) await this.sleep(retryDelay * retryCount);
//       }
//     }

//     console.error(`❌ Failed to get historical EMA for ${symbol} after ${maxRetries} attempts`);
//     return null;
//   }

//   async generateEMAReport(symbol, days = 5) {
//     const historical = await this.getHistoricalEMA(symbol, days);
//     if (!historical) return null;

//     const ema9ByTimestamp = {};
//     if (historical.ema9SeriesFull) {
//       for (const entry of historical.ema9SeriesFull) {
//         ema9ByTimestamp[entry.timestampUnix] = {
//           ema9Low: entry.ema9Low,
//           ema9High: entry.ema9High,
//         };
//       }
//     }

//     const ema100ByTimestamp = {};
//     if (historical.ema100SeriesFull) {
//       for (const entry of historical.ema100SeriesFull) {
//         ema100ByTimestamp[entry.timestampUnix] = entry.ema100Close;
//       }
//     }

//     // All crossovers (chronological order, used by purity check in analyzePattern)
//     const allCrossovers = historical.crossoverStats.allCrossovers || [];

//     return {
//       header: {
//         symbol: historical.symbol,
//         period: historical.period,
//         dateRange: `${historical.periodStart} to ${historical.periodEnd}`,
//         generatedAt: moment().format("YYYY-MM-DD HH:mm:ss"),
//       },
//       crossover: allCrossovers.slice().reverse(), // all crossovers, newest first
//       // Full chronological list — used by purity / window intersection check
//       allCrossovers,
//       rawCandles: historical._rawCandles || [],
//       ema9ByTimestamp,
//       ema100ByTimestamp,
//     };
//   }

//   async getMultipleHistoricalEMA(symbols, days = 20, maxRetries = 10, retryDelay = 2000) {
//     console.log(`\n🔍 Analyzing ${symbols.length} symbols for EMA patterns over ${days} days...\n`);
//     const results = {};
//     const summary = {
//       totalSymbols: symbols.length,
//       bullishSymbols: 0,
//       bearishSymbols: 0,
//       totalCrossovers: 0,
//       topBullish: [],
//       topBearish: [],
//     };
//     for (const symbol of symbols) {
//       const historical = await this.getHistoricalEMA(symbol, days, maxRetries, retryDelay);
//       if (historical) {
//         results[symbol] = historical;
//         const currentTrend = historical.trendStats.currentTrend;
//         if (currentTrend === "BULLISH") {
//           summary.bullishSymbols++;
//           summary.topBullish.push({
//             symbol,
//             trendDuration: historical.trendStats.currentTrendDuration,
//             ema9Low: parseFloat(historical.emaStats.currentEma9Low),
//             ema100Close: parseFloat(historical.emaStats.currentEma100Close),
//             crossovers: historical.crossoverStats.bullishCrossovers,
//           });
//         } else if (currentTrend === "BEARISH") {
//           summary.bearishSymbols++;
//           summary.topBearish.push({
//             symbol,
//             trendDuration: historical.trendStats.currentTrendDuration,
//             ema9High: parseFloat(historical.emaStats.currentEma9High),
//             ema100Close: parseFloat(historical.emaStats.currentEma100Close),
//             crossovers: historical.crossoverStats.bearishCrossovers,
//           });
//         }
//         summary.totalCrossovers += historical.crossoverStats.totalCrossovers;
//       }
//     }

//     summary.topBullish.sort((a, b) => b.trendDuration - a.trendDuration);
//     summary.topBearish.sort((a, b) => b.trendDuration - a.trendDuration);

//     console.log(`\n📊 Multi-Symbol EMA Summary (${days} days):`);
//     console.log(`   Symbols Analyzed: ${summary.totalSymbols}`);
//     console.log(`   🚀 Bullish: ${summary.bullishSymbols}`);
//     console.log(`   🔴 Bearish: ${summary.bearishSymbols}`);
//     console.log(`   Total Crossovers: ${summary.totalCrossovers}`);
//     if (summary.topBullish.length > 0) {
//       console.log(`\n   Top 5 Bullish (by trend duration):`);
//       summary.topBullish.slice(0, 5).forEach((item, idx) =>
//         console.log(`   ${idx + 1}. ${item.symbol}: ${item.trendDuration} candles, ${item.crossovers} crossovers`)
//       );
//     }
//     if (summary.topBearish.length > 0) {
//       console.log(`\n   Top 5 Bearish (by trend duration):`);
//       summary.topBearish.slice(0, 5).forEach((item, idx) =>
//         console.log(`   ${idx + 1}. ${item.symbol}: ${item.trendDuration} candles, ${item.crossovers} crossovers`)
//       );
//     }

//     return { results, summary };
//   }
// }

// module.exports = EMAManager;


// 3C Break FUT 

const moment = require("moment");
const fyers = require("./fyersapi");
const bot = require("./telegram");
const telegramchat = "8559767849";

// ─── Helper: detect Fyers "invalid symbol" errors ────────────────────────────
const isInvalidSymbolError = (error) => {
  if (!error) return false;
  const msg = (error.message || "").toLowerCase();
  const data = error.response?.data;
  if (data && data.s === "error" && typeof data.message === "string") {
    if (data.message.toLowerCase().includes("invalid symbol")) return true;
  }
  if (msg.includes("invalid symbol")) return true;
  return false;
};

const isInvalidSymbolResponse = (response) => {
  if (!response) return false;
  if (response.s === "error" || response.s === "no_data") {
    const msg = (response.message || "").toLowerCase();
    if (msg.includes("invalid symbol") || msg.includes("invalid")) return true;
  }
  return false;
};

class EMAManager {
  constructor() {
    this.fyers = fyers;
    this.ema9Period = 9;
    this.ema100Period = 100;
    this.emaCache = new Map();
    this.timeframe = {
      resolution: "15",
      duration: 15,
      rollingDays: 100,
    };
    this.ema9Multiplier = 2 / (this.ema9Period + 1);
    this.ema100Multiplier = 2 / (this.ema100Period + 1);
  }

  isFormingCandle(candleTimestamp) {
    const candleTime = moment.unix(candleTimestamp);
    const closeTime = candleTime.clone().add(this.timeframe.duration, "minutes");
    const now = moment();
    const isForming = now.isBefore(closeTime);
    if (isForming) {
      console.log(
        `🕐 Candle at ${candleTime.format("HH:mm")} is still forming (closes at ${closeTime.format("HH:mm:ss")}, now: ${now.format("HH:mm:ss")})`
      );
    }
    return isForming;
  }

  calculateEMA(candles) {
    if (candles.length < this.ema100Period) {
      console.log(
        `Not enough data. Need at least ${this.ema100Period} candles, have ${candles.length}`
      );
      return null;
    }

    const highs = candles.map((c) => parseFloat(c[2]));
    const lows = candles.map((c) => parseFloat(c[3]));
    const closes = candles.map((c) => parseFloat(c[4]));

    const ema9Low = this.calculateSingleEMA(lows, this.ema9Period, this.ema9Multiplier);
    const ema9High = this.calculateSingleEMA(highs, this.ema9Period, this.ema9Multiplier);
    const ema100Close = this.calculateSingleEMA(closes, this.ema100Period, this.ema100Multiplier);

    if (!ema9Low || !ema9High || !ema100Close) return null;

    return {
      ema9Low: ema9Low.current,
      ema9LowPrevious: ema9Low.previous,
      ema9High: ema9High.current,
      ema9HighPrevious: ema9High.previous,
      ema100Close: ema100Close.current,
      ema100ClosePrevious: ema100Close.previous,
      lastHigh: highs[highs.length - 1],
      lastLow: lows[lows.length - 1],
      lastClose: closes[closes.length - 1],
    };
  }

  calculateSingleEMA(values, period, multiplier) {
    if (values.length < period) return null;
    let sma = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let ema = sma;
    let previousEMA = sma;
    for (let i = period; i < values.length; i++) {
      previousEMA = ema;
      ema = (values[i] - ema) * multiplier + ema;
    }
    return { current: ema, previous: previousEMA };
  }

  updateEMA(symbol, newCandle) {
    const cache = this.emaCache.get(symbol);

    if (
      !cache ||
      cache.ema9Low === undefined ||
      cache.ema9High === undefined ||
      cache.ema100Close === undefined
    ) {
      console.log(`Cache miss for ${symbol}, needs initialization`);
      return null;
    }

    const candleTimestamp = newCandle[0];
    const candleTime = moment.unix(candleTimestamp);

    if (cache.lastCandleTimestamp === candleTimestamp) {
      console.log(
        `⚠ Skipping update for ${symbol} - same candle already processed (${candleTime.format("YYYY-MM-DD HH:mm")})`
      );
      return {
        ema9Low: cache.ema9Low,
        ema9High: cache.ema9High,
        ema100Close: cache.ema100Close,
        ema9LowPrevious: cache.ema9LowPrevious,
        ema9HighPrevious: cache.ema9HighPrevious,
        ema100ClosePrevious: cache.ema100ClosePrevious,
      };
    }

    if (cache.lastCandleTimestamp) {
      const lastTime = moment.unix(cache.lastCandleTimestamp);
      const minutesDiff = candleTime.diff(lastTime, "minutes");
      const expectedDiff = this.timeframe.duration;

      if (minutesDiff > expectedDiff) {
        const missedCandles = Math.floor(minutesDiff / expectedDiff) - 1;
        console.error(`🔴 CANDLE GAP DETECTED for ${symbol}!`);
        console.error(`   Last processed: ${lastTime.format("YYYY-MM-DD HH:mm")}`);
        console.error(`   New candle: ${candleTime.format("YYYY-MM-DD HH:mm")}`);
        console.error(`   Gap: ${minutesDiff} minutes (${missedCandles} candles missed)`);
        console.error(`   ⚠ FORCING REINITIALIZATION`);
        this.emaCache.delete(symbol);
        return null;
      }

      if (minutesDiff < 0) {
        console.error(`🔴 OUT-OF-ORDER CANDLE for ${symbol}!`);
        console.error(`   Last processed: ${lastTime.format("YYYY-MM-DD HH:mm")}`);
        console.error(`   New candle: ${candleTime.format("YYYY-MM-DD HH:mm")} (${Math.abs(minutesDiff)} min in the past)`);
        console.error(`   ⚠ Ignoring this candle`);
        return {
          ema9Low: cache.ema9Low,
          ema9High: cache.ema9High,
          ema100Close: cache.ema100Close,
          ema9LowPrevious: cache.ema9LowPrevious,
          ema9HighPrevious: cache.ema9HighPrevious,
          ema100ClosePrevious: cache.ema100ClosePrevious,
        };
      }
    }

    const currentHigh = parseFloat(newCandle[2]);
    const currentLow = parseFloat(newCandle[3]);
    const currentClose = parseFloat(newCandle[4]);

    const newEma9Low = (currentLow - cache.ema9Low) * this.ema9Multiplier + cache.ema9Low;
    const newEma9High = (currentHigh - cache.ema9High) * this.ema9Multiplier + cache.ema9High;
    const newEma100Close = (currentClose - cache.ema100Close) * this.ema100Multiplier + cache.ema100Close;

    const ema9LowPrevious = cache.ema9Low;
    const ema9HighPrevious = cache.ema9High;
    const ema100ClosePrevious = cache.ema100Close;

    this.emaCache.set(symbol, {
      ema9Low: newEma9Low,
      ema9High: newEma9High,
      ema100Close: newEma100Close,
      ema9LowPrevious,
      ema9HighPrevious,
      ema100ClosePrevious,
      lastHigh: currentHigh,
      lastLow: currentLow,
      lastClose: currentClose,
      lastUpdate: Date.now(),
      lastCandleTimestamp: candleTimestamp,
      symbol,
    });

    return {
      ema9Low: newEma9Low,
      ema9High: newEma9High,
      ema100Close: newEma100Close,
      ema9LowPrevious,
      ema9HighPrevious,
      ema100ClosePrevious,
    };
  }

  async getEMA(symbol, maxRetries = 10, retryDelay = 2000) {
    const cache = this.emaCache.get(symbol);

    const needsInit =
      !cache ||
      cache.symbol !== symbol ||
      cache.ema9Low === undefined ||
      cache.ema9High === undefined ||
      cache.ema100Close === undefined ||
      Date.now() - cache.lastUpdate > 24 * 60 * 60 * 1000;

    if (needsInit) {
      if (cache && cache.symbol !== symbol) {
        console.log(`🔄 Symbol changed, clearing cache for ${symbol}`);
        this.emaCache.delete(symbol);
      }

      console.log(`🔧 Initializing EMA for ${symbol}...`);

      let retryCount = 0;
      while (retryCount < maxRetries) {
        try {
          const validTo = moment();
          const validFrom = validTo.clone().subtract(this.timeframe.rollingDays, "days");

          const response = await this.fyers.getHistory({
            symbol,
            resolution: this.timeframe.resolution,
            date_format: "1",
            range_from: validFrom.format("YYYY-MM-DD"),
            range_to: validTo.format("YYYY-MM-DD"),
            cont_flag: "1",
          });

          if (isInvalidSymbolResponse(response)) {
            console.warn(`⚠️  Symbol ${symbol} is invalid on Fyers (no contract exists). Skipping.`);
            return null;
          }

          if (!response || !response.candles || response.candles.length === 0) {
            console.log(`No data for ${symbol}, retry ${retryCount + 1}/${maxRetries}`);
            retryCount++;
            if (retryCount < maxRetries) await this.sleep(Math.max(retryDelay * retryCount, 2000));
            continue;
          }

          let candles = response.candles;
          const lastCandle = candles[candles.length - 1];
          if (this.isFormingCandle(lastCandle[0])) {
            console.log(`🔧 Removing forming candle at ${moment.unix(lastCandle[0]).format("HH:mm")} for initialization`);
            candles = candles.slice(0, -1);
          }

          const emaResult = this.calculateEMA(candles);

          if (emaResult) {
            const lastCompletedCandle = candles[candles.length - 1];
            const lastCandleTimestamp = lastCompletedCandle[0];

            this.emaCache.set(symbol, {
              ema9Low: emaResult.ema9Low,
              ema9High: emaResult.ema9High,
              ema100Close: emaResult.ema100Close,
              ema9LowPrevious: emaResult.ema9LowPrevious,
              ema9HighPrevious: emaResult.ema9HighPrevious,
              ema100ClosePrevious: emaResult.ema100ClosePrevious,
              lastHigh: emaResult.lastHigh,
              lastLow: emaResult.lastLow,
              lastClose: emaResult.lastClose,
              lastUpdate: Date.now(),
              lastCandleTimestamp,
              symbol,
            });

            console.log(`✅ EMA initialized for ${symbol}:`);
            console.log(`   9 EMA Low:  ${emaResult.ema9Low.toFixed(2)}  (prev: ${emaResult.ema9LowPrevious?.toFixed(2) ?? "N/A"})`);
            console.log(`   9 EMA High: ${emaResult.ema9High.toFixed(2)} (prev: ${emaResult.ema9HighPrevious?.toFixed(2) ?? "N/A"})`);
            console.log(`   100 EMA Close: ${emaResult.ema100Close.toFixed(2)}`);
            console.log(`   Completed candle: ${moment.unix(lastCandleTimestamp).format("YYYY-MM-DD HH:mm")}`);

            return {
              symbol,
              ema9Low: emaResult.ema9Low,
              ema9High: emaResult.ema9High,
              ema100Close: emaResult.ema100Close,
              ema9LowPrevious: emaResult.ema9LowPrevious,
              ema9HighPrevious: emaResult.ema9HighPrevious,
              ema100ClosePrevious: emaResult.ema100ClosePrevious,
              timestamp: moment.unix(lastCandleTimestamp).format("YYYY-MM-DD HH:mm"),
              candleCount: candles.length,
              isLive: false,
            };
          } else {
            console.log(`❌ EMA calculation failed for ${symbol}, retry ${retryCount + 1}/${maxRetries}`);
          }

          retryCount++;
          if (retryCount < maxRetries) await this.sleep(retryDelay * retryCount);
        } catch (error) {
          if (isInvalidSymbolError(error)) {
            console.warn(`⚠️  Invalid symbol ${symbol} — Fyers has no contract for this ticker. Skipping after 1 attempt.`);
            return null;
          }
          console.error(`Error initializing EMA for ${symbol} (${retryCount + 1}/${maxRetries}):`, error.message);
          retryCount++;
          if (retryCount < maxRetries) await this.sleep(retryDelay * retryCount);
        }
      }

      console.error(`❌ Failed to initialize EMA for ${symbol} after ${maxRetries} attempts`);
      return null;
    }

    // ── Live update path ──
    let retryCount = 0;
    while (retryCount < maxRetries) {
      try {
        const validTo = moment();
        const validFrom = validTo.clone().subtract(5, "hours");

        const response = await this.fyers.getHistory({
          symbol,
          resolution: this.timeframe.resolution,
          date_format: "1",
          range_from: validFrom.format("YYYY-MM-DD"),
          range_to: validTo.format("YYYY-MM-DD"),
          cont_flag: "1",
        });

        if (isInvalidSymbolResponse(response)) {
          console.warn(`⚠️  Symbol ${symbol} is invalid on Fyers. Skipping.`);
          return null;
        }

        if (!response || !response.candles || response.candles.length === 0) {
          console.log(`No candle data for ${symbol}, retry ${retryCount + 1}/${maxRetries}`);
          retryCount++;
          if (retryCount < maxRetries) { await this.sleep(retryDelay * retryCount); continue; }
          if (cache?.ema9Low !== undefined) {
            console.log(`⚠️ Returning cached EMA values for ${symbol}`);
            return {
              symbol,
              ema9Low: cache.ema9Low,
              ema9High: cache.ema9High,
              ema100Close: cache.ema100Close,
              ema9LowPrevious: cache.ema9LowPrevious,
              ema9HighPrevious: cache.ema9HighPrevious,
              ema100ClosePrevious: cache.ema100ClosePrevious,
              timestamp: moment.unix(cache.lastCandleTimestamp).format("YYYY-MM-DD HH:mm"),
              candleCount: 0,
              isLive: false,
              cached: true,
            };
          }
          return null;
        }

        let completedCandles = response.candles.filter((c) => !this.isFormingCandle(c[0]));

        if (completedCandles.length === 0) {
          console.log(`⚠️ No completed candles available yet for ${symbol}`);
          retryCount++;
          if (retryCount < maxRetries) { await this.sleep(retryDelay * retryCount); continue; }
          if (cache?.ema9Low !== undefined) {
            return {
              symbol,
              ema9Low: cache.ema9Low,
              ema9High: cache.ema9High,
              ema100Close: cache.ema100Close,
              ema9LowPrevious: cache.ema9LowPrevious,
              ema9HighPrevious: cache.ema9HighPrevious,
              ema100ClosePrevious: cache.ema100ClosePrevious,
              timestamp: moment.unix(cache.lastCandleTimestamp).format("YYYY-MM-DD HH:mm"),
              candleCount: 0,
              isLive: false,
              cached: true,
            };
          }
          return null;
        }

        const lastCompletedCandle = completedCandles[completedCandles.length - 1];
        const candleTimestamp = lastCompletedCandle[0];
        const emaData = this.updateEMA(symbol, lastCompletedCandle);

        if (emaData !== null && emaData.ema9Low !== undefined) {
          console.log(`✅ EMA updated for ${symbol}:`);
          console.log(`   9 EMA Low:  ${emaData.ema9Low.toFixed(2)}  (prev: ${emaData.ema9LowPrevious?.toFixed(2) ?? "N/A"})`);
          console.log(`   9 EMA High: ${emaData.ema9High.toFixed(2)} (prev: ${emaData.ema9HighPrevious?.toFixed(2) ?? "N/A"})`);
          console.log(`   100 EMA Close: ${emaData.ema100Close.toFixed(2)}`);
          console.log(`   Completed candle: ${moment.unix(candleTimestamp).format("YYYY-MM-DD HH:mm")}`);

          return {
            symbol,
            ema9Low: emaData.ema9Low,
            ema9High: emaData.ema9High,
            ema100Close: emaData.ema100Close,
            ema9LowPrevious: emaData.ema9LowPrevious,
            ema9HighPrevious: emaData.ema9HighPrevious,
            ema100ClosePrevious: emaData.ema100ClosePrevious,
            timestamp: moment.unix(candleTimestamp).format("YYYY-MM-DD HH:mm"),
            candleCount: completedCandles.length,
            isLive: false,
          };
        }

        console.log(`🔄 Cache lost or gap detected for ${symbol}, reinitializing...`);
        this.emaCache.delete(symbol);
        await this.sleep(2000);
        return await this.getEMA(symbol, 8, retryDelay);
      } catch (error) {
        if (isInvalidSymbolError(error)) {
          console.warn(`⚠️  Invalid symbol ${symbol} — skipping after 1 attempt.`);
          return null;
        }
        console.error(`Error updating EMA for ${symbol} (${retryCount + 1}/${maxRetries}):`, error.message);
        retryCount++;
        if (retryCount < maxRetries) await this.sleep(retryDelay * retryCount);
      }
    }

    if (cache?.ema9Low !== undefined) {
      console.log(`⚠️ All retries failed, returning cached EMA values for ${symbol}`);
      return {
        symbol,
        ema9Low: cache.ema9Low,
        ema9High: cache.ema9High,
        ema100Close: cache.ema100Close,
        ema9LowPrevious: cache.ema9LowPrevious,
        ema9HighPrevious: cache.ema9HighPrevious,
        ema100ClosePrevious: cache.ema100ClosePrevious,
        timestamp: moment.unix(cache.lastCandleTimestamp).format("YYYY-MM-DD HH:mm"),
        candleCount: 0,
        isLive: false,
        cached: true,
      };
    }

    console.error(`❌ Failed to get EMA for ${symbol} after ${maxRetries} attempts`);
    return null;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getMultipleEMA(symbols, maxRetries = 10, retryDelay = 2000) {
    const results = {};
    for (const symbol of symbols) {
      results[symbol] = await this.getEMA(symbol, maxRetries, retryDelay);
    }
    return results;
  }

  clearSymbolData(symbol) {
    if (this.emaCache.has(symbol)) {
      this.emaCache.delete(symbol);
      console.log(`✓ Cleared EMA data for symbol ${symbol}`);
    }
  }

  clearAllCache() {
    this.emaCache.clear();
    console.log("✓ EMA cache cleared completely");
  }

  getCacheStatus() {
    return Array.from(this.emaCache.entries()).map(([, value]) => ({
      symbol: value.symbol,
      lastUpdate: new Date(value.lastUpdate).toLocaleTimeString(),
      lastCandleTimestamp: moment.unix(value.lastCandleTimestamp).format("YYYY-MM-DD HH:mm"),
      ema9Low: value.ema9Low?.toFixed(2),
      ema9High: value.ema9High?.toFixed(2),
      ema100Close: value.ema100Close?.toFixed(2),
      ema9LowPrevious: value.ema9LowPrevious?.toFixed(2),
      ema9HighPrevious: value.ema9HighPrevious?.toFixed(2),
      ema100ClosePrevious: value.ema100ClosePrevious?.toFixed(2),
      lastHigh: value.lastHigh?.toFixed(2),
      lastLow: value.lastLow?.toFixed(2),
      lastClose: value.lastClose?.toFixed(2),
    }));
  }

  getDebugInfo(symbol) {
    const cache = this.emaCache.get(symbol);
    if (!cache) return { error: "Symbol not found in cache" };
    return {
      symbol: cache.symbol,
      lastUpdate: new Date(cache.lastUpdate).toLocaleString(),
      lastCandleTimestamp: moment.unix(cache.lastCandleTimestamp).format("YYYY-MM-DD HH:mm"),
      ema9Low: cache.ema9Low?.toFixed(2),
      ema9High: cache.ema9High?.toFixed(2),
      ema100Close: cache.ema100Close?.toFixed(2),
      ema9LowPrevious: cache.ema9LowPrevious?.toFixed(2),
      ema9HighPrevious: cache.ema9HighPrevious?.toFixed(2),
      ema100ClosePrevious: cache.ema100ClosePrevious?.toFixed(2),
      lastHigh: cache.lastHigh?.toFixed(2),
      lastLow: cache.lastLow?.toFixed(2),
      lastClose: cache.lastClose?.toFixed(2),
    };
  }

  async analyzeSymbol(symbol, maxRetries = 10, retryDelay = 2000) {
    console.log(`\n=== Analyzing Symbol: ${symbol} ===`);
    const emaData = await this.getEMA(symbol, maxRetries, retryDelay);
    if (emaData) {
      console.log(`  9 EMA Low:  ${emaData.ema9Low.toFixed(2)}`);
      console.log(`  9 EMA High: ${emaData.ema9High?.toFixed(2) ?? "N/A"}`);
      console.log(`  100 EMA Close: ${emaData.ema100Close.toFixed(2)}`);
      console.log(`  Timestamp: ${emaData.timestamp}`);
      return {
        ema9Low: emaData.ema9Low,
        ema9High: emaData.ema9High,
        ema100Close: emaData.ema100Close,
        ema9LowPrevious: emaData.ema9LowPrevious,
        ema9HighPrevious: emaData.ema9HighPrevious,
        ema100ClosePrevious: emaData.ema100ClosePrevious,
        timestamp: emaData.timestamp,
      };
    } else {
      console.log(`  Failed to calculate EMA`);
      return null;
    }
  }

  async getHistoricalEMA(symbol, days = 5, maxRetries = 10, retryDelay = 2000) {
    console.log(`🔍 Fetching ${days} days of EMA history for ${symbol}...`);

    let retryCount = 0;
    while (retryCount < maxRetries) {
      try {
        const validTo = moment();
        const validFrom = validTo.clone().subtract(this.timeframe.rollingDays, "days");

        const response = await this.fyers.getHistory({
          symbol,
          resolution: this.timeframe.resolution,
          date_format: "1",
          range_from: validFrom.format("YYYY-MM-DD"),
          range_to: validTo.format("YYYY-MM-DD"),
          cont_flag: "1",
        });

        if (isInvalidSymbolResponse(response)) {
          console.warn(`⚠️  Symbol ${symbol} is invalid on Fyers (no contract exists for this expiry). Skipping after 1 attempt.`);
          return null;
        }

        if (!response || !response.candles || response.candles.length === 0) {
          console.log(`No data for ${symbol}, retry ${retryCount + 1}/${maxRetries}`);
          retryCount++;
          if (retryCount < maxRetries) { await this.sleep(Math.max(retryDelay * retryCount, 2000)); continue; }
          console.error(`❌ Failed to get candle data after ${maxRetries} retries`);
          return null;
        }

        let candles = response.candles;
        const lastCandle = candles[candles.length - 1];
        if (this.isFormingCandle(lastCandle[0])) {
          console.log(`🔧 Removing forming candle for historical analysis`);
          candles = candles.slice(0, -1);
        }

        const emaHistory = [];
        const crossovers = [];
        const ema9SeriesFull = [];
        const ema100SeriesFull = [];
        let bullishCrossovers = 0;
        let bearishCrossovers = 0;
        let currentTrend = null;
        let trendDuration = 0;

        for (let i = this.ema100Period; i < candles.length; i++) {
          const candlesUpToIndex = candles.slice(0, i + 1);
          const emaResult = this.calculateEMA(candlesUpToIndex);

          if (emaResult) {
            const candle = candles[i];
            const timestamp = candle[0];
            const open = parseFloat(candle[1]);
            const high = parseFloat(candle[2]);
            const low = parseFloat(candle[3]);
            const close = parseFloat(candle[4]);
            const volume = parseFloat(candle[5]);

            const ema9Low = emaResult.ema9Low;
            const ema9High = emaResult.ema9High;
            const ema100Close = emaResult.ema100Close;

            ema9SeriesFull.push({ timestampUnix: timestamp, ema9Low, ema9High });
            ema100SeriesFull.push({ timestampUnix: timestamp, ema100Close });

            const isBullishTrend = ema9Low > ema100Close;
            const isBearishTrend = ema9High < ema100Close;
            const trend = isBullishTrend ? "BULLISH" : isBearishTrend ? "BEARISH" : "NEUTRAL";

            if (i > this.ema100Period) {
              const prevEmaResult = this.calculateEMA(candles.slice(0, i));
              if (prevEmaResult) {
                const prevEma9Low = prevEmaResult.ema9Low;
                const prevEma9High = prevEmaResult.ema9High;
                const prevEma100Close = prevEmaResult.ema100Close;

                if (prevEma9Low <= prevEma100Close && ema9Low > ema100Close) {
                  bullishCrossovers++;
                  crossovers.push({
                    timestamp: moment.unix(timestamp).format("YYYY-MM-DD HH:mm"),
                    timestampUnix: timestamp,
                    type: "BULLISH_CROSSOVER",
                    ema9Low,
                    ema100Close,
                    price: close,
                    description: "🚀 9 EMA(Low) crossed above 100 EMA(Close)",
                  });
                }

                if (prevEma9High >= prevEma100Close && ema9High < ema100Close) {
                  bearishCrossovers++;
                  crossovers.push({
                    timestamp: moment.unix(timestamp).format("YYYY-MM-DD HH:mm"),
                    timestampUnix: timestamp,
                    type: "BEARISH_CROSSOVER",
                    ema9High,
                    ema100Close,
                    price: close,
                    description: "🔴 9 EMA(High) crossed below 100 EMA(Close)",
                  });
                }
              }
            }

            if (trend === currentTrend) {
              trendDuration++;
            } else {
              currentTrend = trend;
              trendDuration = 1;
            }

            const periodStartTimestamp = validTo.clone().subtract(days, "days").unix();
            if (timestamp >= periodStartTimestamp) {
              emaHistory.push({
                timestamp: moment.unix(timestamp).format("YYYY-MM-DD HH:mm"),
                timestampUnix: timestamp,
                open, high, low, close, volume,
                ema9Low,
                ema9High,
                ema100Close,
                trend,
                emaDifference: ema9Low - ema100Close,
                emaDifferencePercent: (((ema9Low - ema100Close) / ema100Close) * 100).toFixed(2),
              });
            }
          }
        }

        const totalCandles = emaHistory.length;
        const bullishCandles = emaHistory.filter((h) => h.trend === "BULLISH").length;
        const bearishCandles = emaHistory.filter((h) => h.trend === "BEARISH").length;
        const avgEma9Low = totalCandles > 0 ? emaHistory.reduce((s, h) => s + h.ema9Low, 0) / totalCandles : 0;
        const avgEma100Close = totalCandles > 0 ? emaHistory.reduce((s, h) => s + h.ema100Close, 0) / totalCandles : 0;

        const largestBullishSpread = [...emaHistory].filter((h) => h.trend === "BULLISH").sort((a, b) => b.emaDifference - a.emaDifference)[0];
        const largestBearishSpread = [...emaHistory].filter((h) => h.trend === "BEARISH").sort((a, b) => a.emaDifference - b.emaDifference)[0];

        const result = {
          symbol,
          period: `${days} days`,
          periodStart: validTo.clone().subtract(days, "days").format("YYYY-MM-DD"),
          periodEnd: validTo.format("YYYY-MM-DD"),
          totalCandles,

          trendStats: {
            bullishCandles,
            bearishCandles,
            bullishPercentage: ((bullishCandles / totalCandles) * 100).toFixed(2),
            bearishPercentage: ((bearishCandles / totalCandles) * 100).toFixed(2),
            currentTrend: emaHistory.length > 0 ? emaHistory[emaHistory.length - 1].trend : null,
            currentTrendDuration: trendDuration,
          },

          crossoverStats: {
            bullishCrossovers,
            bearishCrossovers,
            totalCrossovers: bullishCrossovers + bearishCrossovers,
            allCrossovers: crossovers,
          },

          emaStats: {
            avgEma9Low: avgEma9Low.toFixed(2),
            avgEma100Close: avgEma100Close.toFixed(2),
            currentEma9Low: emaHistory.length > 0 ? emaHistory[emaHistory.length - 1].ema9Low.toFixed(2) : null,
            currentEma9High: emaHistory.length > 0 ? emaHistory[emaHistory.length - 1].ema9High?.toFixed(2) : null,
            currentEma100Close: emaHistory.length > 0 ? emaHistory[emaHistory.length - 1].ema100Close.toFixed(2) : null,
          },

          spreadAnalysis: {
            largestBullishSpread: largestBullishSpread ? {
              timestamp: largestBullishSpread.timestamp,
              difference: largestBullishSpread.emaDifference.toFixed(2),
              differencePercent: largestBullishSpread.emaDifferencePercent,
            } : null,
            largestBearishSpread: largestBearishSpread ? {
              timestamp: largestBearishSpread.timestamp,
              difference: largestBearishSpread.emaDifference.toFixed(2),
              differencePercent: largestBearishSpread.emaDifferencePercent,
            } : null,
          },

          history: emaHistory,
          current: emaHistory.length > 0 ? emaHistory[emaHistory.length - 1] : null,
        };

        result._rawCandles = candles;
        result.ema9SeriesFull = ema9SeriesFull;
        result.ema100SeriesFull = ema100SeriesFull;
        return result;

      } catch (error) {
        if (isInvalidSymbolError(error)) {
          console.warn(`⚠️  Invalid symbol ${symbol} — no contract exists. Skipping after 1 attempt.`);
          return null;
        }
        console.error(`Error fetching historical EMA for ${symbol} (${retryCount + 1}/${maxRetries}):`, error.message);
        retryCount++;
        if (retryCount < maxRetries) await this.sleep(retryDelay * retryCount);
      }
    }

    console.error(`❌ Failed to get historical EMA for ${symbol} after ${maxRetries} attempts`);
    return null;
  }

  async generateEMAReport(symbol, days = 5) {
    const historical = await this.getHistoricalEMA(symbol, days);
    if (!historical) return null;

    const ema9ByTimestamp = {};
    if (historical.ema9SeriesFull) {
      for (const entry of historical.ema9SeriesFull) {
        ema9ByTimestamp[entry.timestampUnix] = {
          ema9Low: entry.ema9Low,
          ema9High: entry.ema9High,
        };
      }
    }

    const ema100ByTimestamp = {};
    if (historical.ema100SeriesFull) {
      for (const entry of historical.ema100SeriesFull) {
        ema100ByTimestamp[entry.timestampUnix] = entry.ema100Close;
      }
    }

    const allCrossovers = historical.crossoverStats.allCrossovers || [];

    return {
      header: {
        symbol: historical.symbol,
        period: historical.period,
        dateRange: `${historical.periodStart} to ${historical.periodEnd}`,
        generatedAt: moment().format("YYYY-MM-DD HH:mm:ss"),
      },
      crossover: allCrossovers.slice().reverse(), // newest first
      allCrossovers,                              // chronological — used by purity check
      rawCandles: historical._rawCandles || [],
      ema9ByTimestamp,
      ema100ByTimestamp,
    };
  }

  async getMultipleHistoricalEMA(symbols, days = 20, maxRetries = 10, retryDelay = 2000) {
    console.log(`\n🔍 Analyzing ${symbols.length} symbols for EMA patterns over ${days} days...\n`);
    const results = {};
    const summary = {
      totalSymbols: symbols.length,
      bullishSymbols: 0,
      bearishSymbols: 0,
      totalCrossovers: 0,
      topBullish: [],
      topBearish: [],
    };
    for (const symbol of symbols) {
      const historical = await this.getHistoricalEMA(symbol, days, maxRetries, retryDelay);
      if (historical) {
        results[symbol] = historical;
        const currentTrend = historical.trendStats.currentTrend;
        if (currentTrend === "BULLISH") {
          summary.bullishSymbols++;
          summary.topBullish.push({
            symbol,
            trendDuration: historical.trendStats.currentTrendDuration,
            ema9Low: parseFloat(historical.emaStats.currentEma9Low),
            ema100Close: parseFloat(historical.emaStats.currentEma100Close),
            crossovers: historical.crossoverStats.bullishCrossovers,
          });
        } else if (currentTrend === "BEARISH") {
          summary.bearishSymbols++;
          summary.topBearish.push({
            symbol,
            trendDuration: historical.trendStats.currentTrendDuration,
            ema9High: parseFloat(historical.emaStats.currentEma9High),
            ema100Close: parseFloat(historical.emaStats.currentEma100Close),
            crossovers: historical.crossoverStats.bearishCrossovers,
          });
        }
        summary.totalCrossovers += historical.crossoverStats.totalCrossovers;
      }
    }

    summary.topBullish.sort((a, b) => b.trendDuration - a.trendDuration);
    summary.topBearish.sort((a, b) => b.trendDuration - a.trendDuration);

    console.log(`\n📊 Multi-Symbol EMA Summary (${days} days):`);
    console.log(`   Symbols Analyzed: ${summary.totalSymbols}`);
    console.log(`   🚀 Bullish: ${summary.bullishSymbols}`);
    console.log(`   🔴 Bearish: ${summary.bearishSymbols}`);
    console.log(`   Total Crossovers: ${summary.totalCrossovers}`);
    if (summary.topBullish.length > 0) {
      console.log(`\n   Top 5 Bullish (by trend duration):`);
      summary.topBullish.slice(0, 5).forEach((item, idx) =>
        console.log(`   ${idx + 1}. ${item.symbol}: ${item.trendDuration} candles, ${item.crossovers} crossovers`)
      );
    }
    if (summary.topBearish.length > 0) {
      console.log(`\n   Top 5 Bearish (by trend duration):`);
      summary.topBearish.slice(0, 5).forEach((item, idx) =>
        console.log(`   ${idx + 1}. ${item.symbol}: ${item.trendDuration} candles, ${item.crossovers} crossovers`)
      );
    }

    return { results, summary };
  }
}

module.exports = EMAManager;
