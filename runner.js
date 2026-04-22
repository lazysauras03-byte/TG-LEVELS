// runner.js
require("dotenv").config();
const moment = require("moment");
const { loadStocks, chunkArray } = require("./loadStocks");
const { fetchCandles, clearCache } = require("./fetchCandles");
const { processSymbol, resetAll } = require("./strategy");
const logger = require("./utils/logger");
const { getStoredTokens } = require("./src/generate");
const { fyers, setToken } = require("./utils/fyersClient");

const INPUT_EXCEL = process.env.EXCEL_FILE || "./stocks.xlsx";
const SYMBOL_COLUMN = process.env.SYMBOL_COLUMN || "symbol";
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "25", 10);
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS || "1200", 10);

// ── Market window ─────────────────────────────────────────────────────────────
// First scan: 09:15:10  |  Interval: 3 min 10 sec  |  Last scan: ≤ 15:30:10
const SCAN_INTERVAL_MS = 3 * 60 * 1000 + 10 * 1000; // 190 000 ms
const MARKET_OPEN_H = 9;
const MARKET_OPEN_M = 15;
const MARKET_OPEN_S = 10;   // first scan fires at 09:15:10
const MARKET_CLOSE_H = 15;
const MARKET_CLOSE_M = 30;
const MARKET_CLOSE_S = 10;   // last scan may fire up to 15:30:10

let schedulerTimeout = null;
let isRunning = false;
let lastResetDate = null;
let runCount = 0;
let allSignals = [];

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isWeekend() {
  const d = moment().day();
  return d === 0 || d === 6;
}

/** Returns true while market window is open (09:15:00 – 15:30:10 inclusive) */
function isMarketOpen() {
  const now = moment();
  const open = moment().set({ hour: MARKET_OPEN_H, minute: MARKET_OPEN_M, second: 0, millisecond: 0 });
  const close = moment().set({ hour: MARKET_CLOSE_H, minute: MARKET_CLOSE_M, second: MARKET_CLOSE_S, millisecond: 0 });
  return now.isSameOrAfter(open) && now.isSameOrBefore(close);
}

/** Next aligned scan slot: 09:15:10, 09:18:20, 09:21:30 … */
function nextScanTime() {
  const base = moment().startOf("day")
    .set({ hour: MARKET_OPEN_H, minute: MARKET_OPEN_M, second: MARKET_OPEN_S, millisecond: 0 });
  const now = moment();
  if (now.isBefore(base)) return base;

  const elapsed = now.diff(base);
  const steps = Math.floor(elapsed / SCAN_INTERVAL_MS) + 1;
  return base.clone().add(steps * SCAN_INTERVAL_MS, "ms");
}

// ── Daily state reset ─────────────────────────────────────────────────────────
function checkDailyReset() {
  const today = moment().format("YYYY-MM-DD");
  if (lastResetDate !== today) {
    logger.info(`🌅 New day (${today}) — resetting all states.`);
    resetAll();
    clearCache();
    allSignals = [];
    lastResetDate = today;
  }
}

// ── Batch processing ──────────────────────────────────────────────────────────
async function processBatch(symbols, batchNum, total) {
  logger.debug(`📦 Batch ${batchNum}/${total}`);
  const results = [];
  await Promise.all(symbols.map(async (symbol) => {
    try {
      const candles = await fetchCandles(symbol);
      if (!candles) return;
      const sigs = processSymbol(symbol, candles);
      results.push(...sigs);
    } catch (err) {
      logger.error(`❌ ${symbol}: ${err.message}`);
    }
  }));
  return results;
}

// ── Single scan cycle ─────────────────────────────────────────────────────────
async function runCycle(symbols) {
  if (isRunning) {
    logger.warn("⚠️  Cycle still running — skipping tick.");
    return;
  }
  isRunning = true;
  runCount++;

  const t0 = Date.now();
  logger.info(`\n${"─".repeat(55)}`);
  logger.info(`🚀 Cycle #${runCount} @ ${moment().format("HH:mm:ss")} | ${symbols.length} symbols`);
  logger.info(`${"─".repeat(55)}`);

  checkDailyReset();

  const batches = chunkArray(symbols, BATCH_SIZE);
  const newSigs = [];

  for (let i = 0; i < batches.length; i++) {
    const bs = await processBatch(batches[i], i + 1, batches.length);
    newSigs.push(...bs);
    if (i < batches.length - 1) await sleep(BATCH_DELAY_MS);
  }

  allSignals.push(...newSigs);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  logger.info(`✅ Done in ${elapsed}s | New: ${newSigs.length} | Session total: ${allSignals.length}`);

  isRunning = false;
  return newSigs;
}

// ── Status line (lean — no last-5 dump) ──────────────────────────────────────
function printStatus(symbols, nextTime) {
  const nextStr = nextTime ? nextTime.format("HH:mm:ss") : "—";
  logger.info(
    `📊 ${moment().format("HH:mm:ss")} | Tracked: ${symbols.length} | Session signals: ${allSignals.length}\n` +
    `   ⏭  Next scan at: ${nextStr}`
  );
}

// ── Aligned scheduler ─────────────────────────────────────────────────────────
// Fires at 09:15:10, then every 190 s (3 min 10 s), stops after 15:30:10.
function scheduleNext(symbols) {
  const next = nextScanTime();
  const lastOk = moment().startOf("day")
    .set({ hour: MARKET_CLOSE_H, minute: MARKET_CLOSE_M, second: MARKET_CLOSE_S, millisecond: 0 });

  if (next.isAfter(lastOk)) {
    logger.info("🏁 Market closed — no more scans today.");
    return;
  }

  const delayMs = Math.max(0, next.diff(moment()));
  logger.info(`⏳ Next scan scheduled at: ${next.format("HH:mm:ss")} (in ${(delayMs / 1000).toFixed(0)}s)`);

  schedulerTimeout = setTimeout(async () => {
    if (isWeekend() || !isMarketOpen()) {
      logger.debug("⏳ Market closed — skipping.");
      scheduleNext(symbols);
      return;
    }

    await runCycle(symbols);

    const after = nextScanTime();
    printStatus(symbols, after);
    scheduleNext(symbols);
  }, delayMs);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  logger.info("═".repeat(55));
  logger.info("  EMA 9 High/Low Market Structure Strategy");
  logger.info("═".repeat(55));

  // ── Auth: use stored token, never prompt again ────────────────────────────
  const stored = getStoredTokens();
  if (!stored || !stored.access_token) {
    logger.error("❌ No stored access token. Run authentication once first.");
    process.exit(1);
  }
  setToken(stored.access_token);
  logger.info("✅ Fyers authenticated (stored token)");
  logger.info("═".repeat(55));

  const symbols = loadStocks(INPUT_EXCEL, SYMBOL_COLUMN);
  if (!symbols.length) { logger.error("❌ No symbols loaded."); process.exit(1); }

  logger.info(`📂 ${INPUT_EXCEL} | ${symbols.length} symbols | interval: ${SCAN_INTERVAL_MS / 1000}s`);

  if (isWeekend()) { logger.warn("📅 Weekend — market closed."); process.exit(0); }

  // ── Wait until 09:15:10 if early, else fire immediately ──────────────────
  const firstScan = moment().startOf("day")
    .set({ hour: MARKET_OPEN_H, minute: MARKET_OPEN_M, second: MARKET_OPEN_S, millisecond: 0 });

  const now = moment();

  if (now.isBefore(firstScan)) {
    const waitMs = firstScan.diff(now);
    logger.info(`⏳ Market not open yet — first scan at ${firstScan.format("HH:mm:ss")} (in ${(waitMs / 1000).toFixed(0)}s)`);

    schedulerTimeout = setTimeout(async () => {
      await runCycle(symbols);
      const next = nextScanTime();
      printStatus(symbols, next);
      scheduleNext(symbols);
    }, waitMs);

  } else if (isMarketOpen()) {
    // Started mid-session — fire immediately then align
    await runCycle(symbols);
    const next = nextScanTime();
    printStatus(symbols, next);
    scheduleNext(symbols);

  } else {
    logger.warn("⏰ Market already closed for today.");
    process.exit(0);
  }

  process.on("SIGINT", () => { if (schedulerTimeout) clearTimeout(schedulerTimeout); logger.info(`\n🛑 Stopped. Total signals: ${allSignals.length}`); process.exit(0); });
  process.on("SIGTERM", () => { if (schedulerTimeout) clearTimeout(schedulerTimeout); process.exit(0); });
  logger.info("✅ Runner active. Ctrl+C to stop.\n");
}

main().catch(err => {
  logger.error("💥 Fatal:", err.message);
  process.exit(1);
});