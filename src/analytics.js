/**
 * analytics.js
 * Aggregates enriched trade data into summary statistics.
 * Works for both live NeoStox trades and backtest results.
 */

const { getSlotOrder } = require("./timeSlot");

// ── Helper: compute stats for an array of trade objects ───────────────────────
function computeStats(trades) {
  const completed = trades.filter((t) => !t.is_open);
  const wins = completed.filter((t) => t.is_win);
  const total_pnl = completed.reduce((sum, t) => sum + (t.net_pnl || t.pnl_pts || 0), 0);

  return {
    total_trades: completed.length,
    wins: wins.length,
    losses: completed.length - wins.length,
    win_rate: completed.length > 0 ? ((wins.length / completed.length) * 100).toFixed(1) : "0.0",
    total_pnl: parseFloat(total_pnl.toFixed(2)),
    avg_pnl: completed.length > 0 ? parseFloat((total_pnl / completed.length).toFixed(2)) : 0,
  };
}

// ── Group trades by a key and compute stats per group ─────────────────────────
function groupBy(trades, keyFn) {
  const groups = {};
  for (const trade of trades) {
    const key = keyFn(trade);
    if (!groups[key]) groups[key] = [];
    groups[key].push(trade);
  }
  const result = {};
  for (const [key, group] of Object.entries(groups)) {
    result[key] = { ...computeStats(group), trades: group.length };
  }
  return result;
}

/**
 * Build full analytics report from enriched trades array.
 * Each trade should have: is_win, is_open, net_pnl/pnl_pts, time_slot,
 * nifty_alignment, direction.
 */
function buildAnalytics(trades) {
  const completedTrades = trades.filter((t) => !t.is_open);
  const slotOrder = getSlotOrder();

  // ── Overall summary ─────────────────────────────────────────────────────────
  const overall = computeStats(completedTrades);

  // ── By time slot (ordered) ───────────────────────────────────────────────────
  const rawBySlot = groupBy(completedTrades, (t) => t.time_slot || "Unknown");
  const byTimeSlot = slotOrder.reduce((acc, slot) => {
    acc[slot] = rawBySlot[slot] || { total_trades: 0, wins: 0, losses: 0, win_rate: "0.0", total_pnl: 0, avg_pnl: 0 };
    return acc;
  }, {});

  // ── By Nifty alignment ───────────────────────────────────────────────────────
  const byAlignment = groupBy(completedTrades, (t) => t.nifty_alignment || "UNKNOWN");

  // ── By direction (BUY/SELL or BULLISH/BEARISH) ────────────────────────────
  const byDirection = groupBy(completedTrades, (t) => t.direction || "UNKNOWN");

  // ── Combined: time slot × nifty alignment ────────────────────────────────────
  const combinedStats = {};
  for (const slot of slotOrder) {
    combinedStats[slot] = {};
    for (const align of ["YES", "NO", "UNKNOWN"]) {
      const subset = completedTrades.filter(
        (t) => (t.time_slot || "Unknown") === slot && (t.nifty_alignment || "UNKNOWN") === align
      );
      combinedStats[slot][align] = computeStats(subset);
    }
  }

  // ── Daily breakdown ──────────────────────────────────────────────────────────
  const byDate = groupBy(completedTrades, (t) => t.trade_date || "Unknown");

  // ── Consecutive wins/losses ──────────────────────────────────────────────────
  let maxConsecWins = 0, maxConsecLosses = 0;
  let curWins = 0, curLosses = 0;
  for (const t of completedTrades) {
    if (t.is_win) {
      curWins++; curLosses = 0;
      if (curWins > maxConsecWins) maxConsecWins = curWins;
    } else {
      curLosses++; curWins = 0;
      if (curLosses > maxConsecLosses) maxConsecLosses = curLosses;
    }
  }

  // ── Best/worst trade ─────────────────────────────────────────────────────────
  const pnlValues = completedTrades.map((t) => t.net_pnl || t.pnl_pts || 0);
  const bestPnl = pnlValues.length > 0 ? Math.max(...pnlValues) : 0;
  const worstPnl = pnlValues.length > 0 ? Math.min(...pnlValues) : 0;

  return {
    overall,
    byTimeSlot,
    byAlignment,
    byDirection,
    combinedStats,
    byDate,
    streaks: { maxConsecWins, maxConsecLosses },
    extremes: { bestPnl: parseFloat(bestPnl.toFixed(2)), worstPnl: parseFloat(worstPnl.toFixed(2)) },
    slotOrder,
    totalTrades: trades.length,
    openTrades: trades.filter((t) => t.is_open).length,
  };
}

module.exports = { buildAnalytics, computeStats };
