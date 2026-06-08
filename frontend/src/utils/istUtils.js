/**
 * istUtils.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all IST (Asia/Kolkata) date/time helpers.
 *
 * Previously each of these functions was copy-pasted into 9 separate files:
 *   SignalTable, StatsPanel, WaveSignalTable, WaveStatsPanel,
 *   ConsolidationZoneTable, ConsolidationStatsPanel, CandleChart,
 *   BubbleIndicator, ChartsPage, ReportsPage
 *
 * Now all files import from here. To change timezone logic, change it once.
 */

/**
 * Convert a timestamp (ms) to an IST calendar date string.
 * Used for "today mode" filtering — compare two results to check same day.
 * @param {number} tsMs - Unix timestamp in milliseconds
 * @returns {string} e.g. "06/06/2026" (en-IN locale, IST)
 */
export function toISTDate(tsMs) {
  if (!tsMs) return "";
  return new Date(tsMs).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

/**
 * Get today's IST calendar date string.
 * Used as the reference value when todayMode is on.
 * @returns {string} e.g. "06/06/2026" (en-IN locale, IST)
 */
export function getTodayIST() {
  return new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

/**
 * Format a timestamp (ms) as an IST time string (HH:MM, 24h).
 * @param {number} tsMs - Unix timestamp in milliseconds
 * @returns {string} e.g. "09:15" or "—" if falsy
 */
export function formatTimeIST(tsMs) {
  if (!tsMs) return "—";
  return new Date(tsMs).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
}
