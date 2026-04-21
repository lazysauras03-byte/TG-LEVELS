require("dotenv").config();
const path = require("path");
const fs = require("fs");
const moment = require("moment");

const { parseNeoStoxTrades } = require("./src/parseNeostox");
const { parseBacktestResults } = require("./src/parseBacktest");
const { getTimeSlot, getCandleSlot } = require("./src/timeSlot");
const {
  fetchNiftyForTrades, fetchNiftyCandles,
  getNiftyTrend, isNiftyAligned, isNiftyAlignedBacktest,
  getNiftyCandleAtTime, floorTo15Min,
} = require("./src/fyersService");
const { buildAnalytics } = require("./src/analytics");
const { exportNeoStoxToExcel, exportBacktestToExcel, exportAnalyticsSummary } = require("./src/exportExcel");

const NEOSTOX_FILE = path.join(__dirname, "data", "NeoStox_Trade_History.xls");
const BACKTEST_FILE = path.join(__dirname, "data", "backtest_results.xlsx");
const OUT_NEO = path.join(__dirname, "data", "neostox_enriched.xlsx");
const OUT_BT = path.join(__dirname, "data", "backtest_enriched.xlsx");
const OUT_SUM = path.join(__dirname, "data", "analytics_summary.xlsx");

let cachedData = null, lastRefresh = null;

function hasFyersToken() {
  const txt = path.join(process.cwd(), "fyers_access_token.txt");
  if (fs.existsSync(txt)) { const t = fs.readFileSync(txt, "utf8").trim(); if (t.length > 20) return true; }
  try {
    const { LocalStorage } = require("node-localstorage");
    const ls = new LocalStorage("./scratch");
    const raw = ls.getItem("token");
    if (raw && raw.length > 20) return true;
  } catch (_) { }
  return false;
}

/**
 * Fetch the day-high AFTER entry time for a given date and symbol.
 * We use Nifty 15m candles as a proxy when per-symbol data isn't available.
 * For accurate per-symbol RR you'd need to fetch each symbol's candles.
 * This gives us a market-level RR approximation.
 *
 * For BULLISH: RR = (day_high_after_entry - entry) / risk
 * For BEARISH: RR = (entry - day_low_after_entry) / risk
 *
 * Returns null if data unavailable.
 */
function computeRR(trade, candleMap) {
  if (!candleMap || candleMap.size === 0) return null;
  if (!trade.entry_price || !trade.risk || trade.risk <= 0) return null;
  if (!trade.signal_time_moment) return null;

  // Get all candles on same date after entry time
  const entryTs = floorTo15Min(trade.signal_time_moment).unix();
  const tradeDateStr = trade.trade_date;

  const dayCandles = [];
  for (const [ts, c] of candleMap.entries()) {
    const cd = moment.unix(ts).format("YYYY-MM-DD");
    if (cd === tradeDateStr && ts >= entryTs) {
      dayCandles.push(c);
    }
  }

  if (dayCandles.length === 0) return null;

  const isBull = trade.direction === "BULLISH";
  if (isBull) {
    const dayHigh = Math.max(...dayCandles.map(c => c.high));
    const rr = (dayHigh - trade.entry_price) / trade.risk;
    return +rr.toFixed(2);
  } else {
    const dayLow = Math.min(...dayCandles.map(c => c.low));
    const rr = (trade.entry_price - dayLow) / trade.risk;
    return +rr.toFixed(2);
  }
}

async function analyzeNeoStoxTrades(skipFyers) {
  console.log("\n📂 Parsing NeoStox trade history...");
  const trades = parseNeoStoxTrades(NEOSTOX_FILE);
  if (!trades.length) { console.warn("⚠️  No trades found"); return []; }

  for (const t of trades) {
    t.time_slot = getTimeSlot(t.entry_time_moment);
    t.candle_slot = getCandleSlot(t.entry_time_moment);
    t.is_win = t.net_pnl !== null && t.net_pnl > 0;
    t.is_loss = t.net_pnl !== null && t.net_pnl < 0;
    t.is_open = t.net_pnl === null;
  }

  if (!skipFyers) {
    console.log("📡 Fetching Nifty 15m data...");
    const dates = ([...new Set(trades.map(t => t.trade_date).filter(Boolean))]);
    const cm = await fetchNiftyForTrades(dates);
    for (const t of trades) {
      if (t.is_open || !t.entry_time_moment || !t.exit_time_moment) {
        t.nifty_trend = "UNKNOWN"; t.nifty_alignment = "UNKNOWN";
        t.nifty_entry_close = null; t.nifty_exit_close = null; continue;
      }
      const ec = getNiftyCandleAtTime(cm, t.entry_time_moment);
      const xc = getNiftyCandleAtTime(cm, t.exit_time_moment);
      t.nifty_entry_close = ec ? ec.close : null;
      t.nifty_exit_close = xc ? xc.close : null;
      t.nifty_trend = getNiftyTrend(cm, t.entry_time_moment, t.exit_time_moment);
      t.nifty_alignment = isNiftyAligned(t.direction, t.nifty_trend);
    }
  } else {
    for (const t of trades) { t.nifty_trend = "UNKNOWN"; t.nifty_alignment = "UNKNOWN"; t.nifty_entry_close = null; t.nifty_exit_close = null; }
  }

  exportNeoStoxToExcel(trades, OUT_NEO);
  console.log(`✅ NeoStox: ${trades.length} trades`);
  return trades;
}

async function analyzeBacktestTrades(skipFyers) {
  console.log("\n📂 Parsing backtest results...");
  const trades = parseBacktestResults(BACKTEST_FILE);
  if (!trades.length) { console.warn("⚠️  No backtest trades"); return []; }

  for (const t of trades) {
    t.time_slot = getTimeSlot(t.signal_time_moment);
    t.candle_slot = getCandleSlot(t.signal_time_moment);
  }

  let candleMap = new Map();
  if (!skipFyers) {
    console.log("📡 Fetching Nifty 15m data for backtest + RR calculation...");
    const dates = [...new Set(trades.map(t => t.trade_date).filter(Boolean))];
    candleMap = await fetchNiftyForTrades(dates);

    for (const t of trades) {
      if (!t.signal_time_moment) {
        t.nifty_trend = "UNKNOWN"; t.nifty_alignment = "UNKNOWN"; t.nifty_entry_close = null;
        t.actual_rr = null; continue;
      }
      const ec = getNiftyCandleAtTime(candleMap, t.signal_time_moment);
      t.nifty_entry_close = ec ? ec.close : null;

      if (t.hit_time) {
        const hitMoment = moment(t.hit_time, "YYYY-MM-DD HH:mm:ss");
        t.nifty_trend = getNiftyTrend(candleMap, t.signal_time_moment, hitMoment);
      } else {
        t.nifty_trend = "UNKNOWN";
      }
      t.nifty_alignment = isNiftyAlignedBacktest(t.direction, t.nifty_trend);

      // ── Compute actual RR: (day high/low after entry - entry) / risk ────────
      t.actual_rr = computeRR(t, candleMap);
    }
  } else {
    for (const t of trades) {
      t.nifty_trend = "UNKNOWN"; t.nifty_alignment = "UNKNOWN";
      t.nifty_entry_close = null; t.actual_rr = null;
    }
  }

  exportBacktestToExcel(trades, OUT_BT);
  console.log(`✅ Backtest: ${trades.length} trades`);
  return trades;
}

async function runFullAnalysis(skipFyers) {
  if (skipFyers === undefined) skipFyers = !hasFyersToken();
  console.log(skipFyers ? "⚠️  No Fyers token — skipping Nifty alignment + RR" : "✅ Fyers token found — Nifty alignment + RR calc ON");
  const [neoT, btT] = await Promise.all([analyzeNeoStoxTrades(skipFyers), analyzeBacktestTrades(skipFyers)]);
  const neoA = buildAnalytics(neoT), btA = buildAnalytics(btT);
  exportAnalyticsSummary(btA, OUT_SUM);
  const data = { neostox: { trades: neoT, analytics: neoA }, backtest: { trades: btT, analytics: btA }, generated_at: new Date().toISOString() };
  cachedData = data; lastRefresh = new Date();
  console.log(`\n🎉 Done! NeoStox: ${neoT.length} (${neoA.overall.win_rate}% WR) | Backtest: ${btT.length} (${btA.overall.win_rate}% WR)`);
  return data;
}

module.exports = { runFullAnalysis, getCachedData: () => cachedData, getLastRefresh: () => lastRefresh };