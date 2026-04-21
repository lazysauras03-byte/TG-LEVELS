/**
 * parseBacktest.js
 * Reads backtest_results.xlsx.
 *
 * KEY RULES:
 * 1. Include ALL signals including OPEN and 15:15 candle signals
 * 2. Signal at 15:15 = "Entry Cannot Be Done" (entry would be at 15:30, market closed)
 * 3. OPEN signals = market closed before target/SL hit — still shown with warning
 * 4. RR column = (Day High after entry - entry) / risk — requires Fyers data for day high
 *    Without Fyers: RR computed from existing PnL data as approximation
 */

const XLSX = require("xlsx");
const moment = require("moment");

function parseBacktestResults(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: null });

  const trades = raw.map((row) => {
    const signalTime = row["Signal Candle Time"];
    const hitTime = row["Hit Candle Time"];

    const entryMoment = signalTime ? moment(signalTime, "YYYY-MM-DD HH:mm") : null;
    const hitMoment = hitTime ? moment(hitTime, "YYYY-MM-DD HH:mm") : null;

    const result = (row["Result"] || "").toUpperCase().trim();
    const isWin = result === "TARGET HIT";
    const isLoss = result === "SL HIT";
    const isOpen = result === "OPEN";

    // ── 15:15 candle rule ────────────────────────────────────────────────────
    // Signal candle = 15:15 → entry would be at 15:30 (next open) which doesn't
    // exist in intraday trading. Tag these as "entry cannot be done".
    const candleSlot = entryMoment ? entryMoment.format("HH:mm") : "";
    const isLastCandle = candleSlot === "15:15";
    const entryNote = isLastCandle ? "⚠️ Entry cannot be done — last candle" : "";

    const pnl = row["PnL (pts)"] || 0;
    const pnlPct = row["PnL %"] || 0;
    const entry = row["Entry (Next Open)"] || null;
    const sl = row["Stop Loss"] || null;
    const target = row["Target (1:1 RR)"] || null;

    // ── RR calculation (1:1 from backtest data) ──────────────────────────────
    // The backtest already uses 1:1 RR (Target = Entry ± risk).
    // True RR from "day high after entry" requires live Fyers candle data.
    // We store risk for use when Fyers data is available.
    let risk = null;
    if (entry && sl) {
      const dir = (row["Crossover Type"] || "").toUpperCase();
      risk = dir === "BULLISH" ? +(entry - sl).toFixed(4) : +(sl - entry).toFixed(4);
    }

    return {
      pattern_id: row["Pattern ID"] || "",
      symbol: (row["Symbol"] || "").replace("NSE:", "").replace(/-EQ$/, "").trim(),
      direction: (row["Crossover Type"] || "").toUpperCase().trim(),
      signal_time: entryMoment ? entryMoment.format("YYYY-MM-DD HH:mm:ss") : null,
      signal_time_moment: entryMoment,
      hit_time: hitMoment ? hitMoment.format("YYYY-MM-DD HH:mm:ss") : null,
      entry_price: entry,
      stop_loss: sl,
      target: target,
      hit_price: row["Hit Price"] || null,
      candles_to_hit: row["Candles to Hit"] || null,
      pnl_pts: pnl,
      pnl_pct: pnlPct,
      result: result,
      is_win: isWin,
      is_loss: isLoss,
      is_open: isOpen,
      is_last_candle: isLastCandle,   // NEW: 15:15 signal flag
      entry_note: entryNote,      // NEW: warning text
      risk: risk,           // NEW: risk in pts for RR calc
      trade_date: entryMoment ? entryMoment.format("YYYY-MM-DD") : null,
      sync_ok: row["Sync OK?"] === "YES",
    };
  });

  const total = trades.length;
  const open = trades.filter(t => t.is_open).length;
  const lastCandle = trades.filter(t => t.is_last_candle).length;
  console.log(`✅ Parsed ${total} backtest trades (${open} open, ${lastCandle} last-candle no-entry)`);
  return trades;
}

module.exports = { parseBacktestResults };