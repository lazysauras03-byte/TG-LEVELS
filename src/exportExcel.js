/**
 * exportExcel.js
 * Writes enriched trades data to Excel in a Power BI-friendly flat format.
 * Produces two sheets: "Trades" (flat enriched data) and "Analytics Summary".
 */

const XLSX = require("xlsx");
const path = require("path");

/**
 * Export NeoStox trades enriched with TimeSlot + Nifty_Alignment to Excel.
 */
function exportNeoStoxToExcel(trades, outputPath) {
  const rows = trades.map((t) => ({
    Trade_Date:       t.trade_date,
    Symbol:           t.symbol,
    Instrument:       t.instrument,
    Direction:        t.direction,
    Entry_Time:       t.entry_time,
    Exit_Time:        t.exit_time,
    Entry_Price:      t.entry_price,
    Exit_Price:       t.exit_price,
    Qty:              t.qty,
    Net_PnL:          t.net_pnl,
    Is_Win:           t.is_win ? "WIN" : "LOSS",
    Time_Slot:        t.time_slot,
    Nifty_Trend:      t.nifty_trend,
    Nifty_Alignment:  t.nifty_alignment,
    Nifty_Entry_Close: t.nifty_entry_close,
    Nifty_Exit_Close:  t.nifty_exit_close,
    Stop_Loss:        t.stop_loss,
    Target:           t.target,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);

  // Column widths
  ws["!cols"] = [
    { wch: 12 }, { wch: 16 }, { wch: 28 }, { wch: 8 },
    { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 12 },
    { wch: 8 },  { wch: 12 }, { wch: 8 },  { wch: 14 },
    { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 18 },
    { wch: 12 }, { wch: 12 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Trades");
  XLSX.writeFile(wb, outputPath);
  console.log(`✅ NeoStox enriched Excel → ${outputPath}`);
}

/**
 * Export backtest trades enriched with TimeSlot + Nifty_Alignment to Excel.
 */
function exportBacktestToExcel(trades, outputPath) {
  const rows = trades.map((t) => ({
    Trade_Date:       t.trade_date,
    Symbol:           t.symbol,
    Direction:        t.direction,
    Signal_Time:      t.signal_time,
    Hit_Time:         t.hit_time,
    Entry_Price:      t.entry_price,
    Stop_Loss:        t.stop_loss,
    Target:           t.target,
    Hit_Price:        t.hit_price,
    Candles_to_Hit:   t.candles_to_hit,
    Result:           t.result,
    PnL_Pts:          t.pnl_pts,
    PnL_Pct:          t.pnl_pct,
    Is_Win:           t.is_win ? "WIN" : t.is_open ? "OPEN" : "LOSS",
    Time_Slot:        t.time_slot,
    Nifty_Trend:      t.nifty_trend,
    Nifty_Alignment:  t.nifty_alignment,
    Nifty_Entry_Close: t.nifty_entry_close,
    Sync_OK:          t.sync_ok ? "YES" : "NO",
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);

  ws["!cols"] = [
    { wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 20 },
    { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 10 },
    { wch: 10 }, { wch: 8 },  { wch: 14 }, { wch: 12 },
    { wch: 16 }, { wch: 18 }, { wch: 10 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Backtest Trades");
  XLSX.writeFile(wb, outputPath);
  console.log(`✅ Backtest enriched Excel → ${outputPath}`);
}

/**
 * Export a combined analytics summary sheet with all aggregations.
 */
function exportAnalyticsSummary(analytics, outputPath) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Overall Summary
  const overallRows = [
    ["Metric", "Value"],
    ["Total Trades",   analytics.overall.total_trades],
    ["Wins",           analytics.overall.wins],
    ["Losses",         analytics.overall.losses],
    ["Win Rate (%)",   analytics.overall.win_rate],
    ["Total PnL",      analytics.overall.total_pnl],
    ["Avg PnL/Trade",  analytics.overall.avg_pnl],
    ["Max Consec Wins",   analytics.streaks.maxConsecWins],
    ["Max Consec Losses", analytics.streaks.maxConsecLosses],
    ["Best Trade PnL",    analytics.extremes.bestPnl],
    ["Worst Trade PnL",   analytics.extremes.worstPnl],
    ["Open Trades",       analytics.openTrades],
  ];
  const wsOverall = XLSX.utils.aoa_to_sheet(overallRows);
  wsOverall["!cols"] = [{ wch: 22 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsOverall, "Summary");

  // Sheet 2: By Time Slot
  const slotRows = [["Time Slot", "Trades", "Wins", "Losses", "Win Rate (%)", "Total PnL", "Avg PnL"]];
  for (const [slot, stats] of Object.entries(analytics.byTimeSlot)) {
    slotRows.push([slot, stats.total_trades, stats.wins, stats.losses, stats.win_rate, stats.total_pnl, stats.avg_pnl]);
  }
  const wsSlot = XLSX.utils.aoa_to_sheet(slotRows);
  wsSlot["!cols"] = [{ wch: 14 }, { wch: 8 }, { wch: 6 }, { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, wsSlot, "By Time Slot");

  // Sheet 3: By Nifty Alignment
  const alignRows = [["Alignment", "Trades", "Wins", "Losses", "Win Rate (%)", "Total PnL", "Avg PnL"]];
  for (const [align, stats] of Object.entries(analytics.byAlignment)) {
    alignRows.push([align, stats.total_trades, stats.wins, stats.losses, stats.win_rate, stats.total_pnl, stats.avg_pnl]);
  }
  const wsAlign = XLSX.utils.aoa_to_sheet(alignRows);
  wsAlign["!cols"] = [{ wch: 12 }, { wch: 8 }, { wch: 6 }, { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, wsAlign, "By Alignment");

  // Sheet 4: Combined (Time Slot × Alignment) — flat table for Power BI
  const combinedRows = [["Time Slot", "Alignment", "Trades", "Wins", "Losses", "Win Rate (%)", "Total PnL"]];
  for (const [slot, alignMap] of Object.entries(analytics.combinedStats)) {
    for (const [align, stats] of Object.entries(alignMap)) {
      if (stats.total_trades > 0) {
        combinedRows.push([slot, align, stats.total_trades, stats.wins, stats.losses, stats.win_rate, stats.total_pnl]);
      }
    }
  }
  const wsCombined = XLSX.utils.aoa_to_sheet(combinedRows);
  wsCombined["!cols"] = [{ wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 6 }, { wch: 8 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsCombined, "Slot x Alignment");

  // Sheet 5: By Direction
  const dirRows = [["Direction", "Trades", "Wins", "Losses", "Win Rate (%)", "Total PnL"]];
  for (const [dir, stats] of Object.entries(analytics.byDirection)) {
    dirRows.push([dir, stats.total_trades, stats.wins, stats.losses, stats.win_rate, stats.total_pnl]);
  }
  const wsDir = XLSX.utils.aoa_to_sheet(dirRows);
  wsDir["!cols"] = [{ wch: 12 }, { wch: 8 }, { wch: 6 }, { wch: 8 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsDir, "By Direction");

  // Sheet 6: Daily P&L
  const dailyRows = [["Date", "Trades", "Wins", "Losses", "Win Rate (%)", "Daily PnL"]];
  const sortedDates = Object.keys(analytics.byDate).sort();
  for (const date of sortedDates) {
    const stats = analytics.byDate[date];
    dailyRows.push([date, stats.total_trades, stats.wins, stats.losses, stats.win_rate, stats.total_pnl]);
  }
  const wsDaily = XLSX.utils.aoa_to_sheet(dailyRows);
  wsDaily["!cols"] = [{ wch: 12 }, { wch: 8 }, { wch: 6 }, { wch: 8 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsDaily, "Daily PnL");

  XLSX.writeFile(wb, outputPath);
  console.log(`✅ Analytics Summary Excel → ${outputPath}`);
}

module.exports = { exportNeoStoxToExcel, exportBacktestToExcel, exportAnalyticsSummary };
