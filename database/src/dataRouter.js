/**
 * database/src/dataRouter.js
 *
 * Drop-in, signature-compatible replacements for candleStore.js's
 * upsertCandles / getLatestCandle / loadCandles. Each function here parses
 * the symbol first:
 *   - not a dated NSE/MCX option or future (equities, indices, MCX
 *     continuous roots, anything unrecognized) → delegates straight to
 *     candleStore.js, UNCHANGED behavior.
 *   - a dated NSE/MCX option or future → delegates to derivativesStore.js,
 *     writing/reading the correct one of the 4 new tables instead.
 *
 * database/src/index.js spreads this module's exports LAST, so these
 * three names override candleStore.js's versions app-wide. Every existing
 * caller (server.js, backfill.js, scannerRunner.js, backtestRunner.js —
 * all of which call db.upsertCandles / db.getLatestCandle / db.loadCandles
 * through the shared `db` object) becomes derivatives-aware with ZERO
 * changes to any of those files. Callers that require candleStore.js
 * DIRECTLY (recoveryEngine.js, validationEngine.js) are intentionally NOT
 * affected — those only ever run against curated no-expiry symbols
 * (see backend/src/data/noExpirySymbols.json), so bypassing the router
 * there is correct, not an oversight.
 */

const candleStore = require("./candleStore");
const derivativesStore = require("./derivativesStore");
const { parseDerivativeSymbol } = require("./symbolParser");

/**
 * Upsert a batch of finalized 1m candles for `symbol`. Same signature as
 * candleStore.upsertCandles(symbol, resolution, candles).
 */
async function upsertCandles(symbol, resolution, candles) {
  const info = parseDerivativeSymbol(symbol);
  if (!info) return candleStore.upsertCandles(symbol, resolution, candles);

  if (resolution !== 1) {
    console.warn(`[DataRouter] ${symbol}: derivatives tables only store resolution=1, got ${resolution} — ignoring write`);
    return 0;
  }

  const rows = (candles || []).map((c) => ({ ...info, ...c }));
  return info.instrument_type === "option"
    ? derivativesStore.upsertOptionCandles(rows)
    : derivativesStore.upsertFutureCandles(rows);
}

/**
 * Load candles for `symbol`. Same signature as
 * candleStore.loadCandles(symbol, resolution, opts).
 */
async function loadCandles(symbol, resolution, opts = {}) {
  const info = parseDerivativeSymbol(symbol);
  if (!info) return candleStore.loadCandles(symbol, resolution, opts);

  return derivativesStore.loadCandlesBySymbol(info.exchange, info.instrument_type, symbol, opts);
}

/**
 * Most recent candle for `symbol`. Same signature as
 * candleStore.getLatestCandle(symbol, resolution).
 */
async function getLatestCandle(symbol, resolution) {
  const info = parseDerivativeSymbol(symbol);
  if (!info) return candleStore.getLatestCandle(symbol, resolution);

  return derivativesStore.getLatestCandleBySymbol(info.exchange, info.instrument_type, symbol);
}

module.exports = {
  upsertCandles,
  loadCandles,
  getLatestCandle,
};
