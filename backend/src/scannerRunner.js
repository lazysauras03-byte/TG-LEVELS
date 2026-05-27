/**
 * scannerRunner.js
 * ─────────────────────────────────────────────────────────────────
 * Runs ALL registered strategies across all symbols.
 *
 * Results are stored per-strategy:
 *   _results = Map<strategyId, Map<symbol, ScanResult>>
 *
 * Fyers rate limits:
 *   Candles are fetched ONCE per symbol per scan run and shared
 *   across all strategies — so adding more strategies costs zero
 *   extra API calls.
 * ─────────────────────────────────────────────────────────────────
 */

"use strict";

const EventEmitter = require("events");
const { fetchCandles } = require("./fyers");
const strategies = require("./strategies/strategyRegistry");

// ─── Config ───────────────────────────────────────────────────────────────────
const CONCURRENCY = parseInt(process.env.SCANNER_CONCURRENCY || "3");
const BATCH_DELAY_MS = parseInt(process.env.SCANNER_BATCH_DELAY_MS || "400");
const SCAN_INTERVAL_MS = parseInt(process.env.SCANNER_INTERVAL_MS || String(30 * 60 * 1000));
const SCANNER_RESOLUTION = parseInt(process.env.SCANNER_RESOLUTION || "15");
const RETRY_LIMIT = 2;

// ─── ScannerRunner ────────────────────────────────────────────────────────────
class ScannerRunner extends EventEmitter {
  constructor() {
    super();
    // Map<strategyId, Map<symbol, ScanResult>>
    this._results = new Map();
    this._errors = new Map();   // symbol → { count, lastError }
    this._retryQueue = [];
    this._running = false;
    this._scanTimer = null;
    this._scanCount = 0;
    this._symbolList = [];
    this._lastScanAt = null;
    this._lastScanDurationMs = null;
    this._progress = { total: 0, done: 0, found: 0 };

    // Init a result map for each strategy
    for (const s of strategies) {
      this._results.set(s.id, new Map());
    }
  }

  // ── Symbol list ──────────────────────────────────────────────────────────────
  setSymbols(symbols) {
    this._symbolList = [...new Set(symbols.filter(Boolean))];
    console.log(`[Scanner] Symbol list: ${this._symbolList.length} symbols`);
  }
  getSymbols() { return [...this._symbolList]; }

  // ── Start / Stop ─────────────────────────────────────────────────────────────
  start() {
    if (this._scanTimer) return;
    console.log(`[Scanner] Starting — ${strategies.length} strategies, ${this._symbolList.length} symbols, res=${SCANNER_RESOLUTION}m, every ${SCAN_INTERVAL_MS / 60000}min`);
    this._scheduleNext(0);
  }

  stop() {
    if (this._scanTimer) { clearTimeout(this._scanTimer); this._scanTimer = null; }
    console.log("[Scanner] Stopped");
  }

  async triggerNow() {
    if (this._running) return { status: "already_running", progress: this._progress };
    if (this._scanTimer) { clearTimeout(this._scanTimer); this._scanTimer = null; }
    await this._runScan();
    this._scheduleNext(SCAN_INTERVAL_MS);
    return { status: "triggered", symbols: this._symbolList.length };
  }

  _scheduleNext(delayMs) {
    this._scanTimer = setTimeout(async () => {
      await this._runScan();
      this._scheduleNext(SCAN_INTERVAL_MS);
    }, delayMs);
  }

  // ── Core scan loop ────────────────────────────────────────────────────────────
  async _runScan() {
    if (this._running) return;
    if (this._symbolList.length === 0) { console.log("[Scanner] No symbols — skipping"); return; }

    this._running = true;
    this._scanCount++;
    const scanId = this._scanCount;
    const startMs = Date.now();

    const toScan = [...new Set([...this._retryQueue, ...this._symbolList])];
    this._retryQueue = [];
    this._progress = { total: toScan.length, done: 0, found: 0 };

    console.log(`[Scanner #${scanId}] ${toScan.length} symbols × ${strategies.length} strategies @ res=${SCANNER_RESOLUTION}m`);
    this.emit("scan_start", { scanId, total: toScan.length, resolution: SCANNER_RESOLUTION, strategies: strategies.map(s => ({ id: s.id, name: s.name })) });

    for (let i = 0; i < toScan.length; i += CONCURRENCY) {
      const batch = toScan.slice(i, i + CONCURRENCY);
      await Promise.allSettled(batch.map((sym) => this._processSymbol(sym)));
      this._progress.done = Math.min(i + CONCURRENCY, toScan.length);
      this.emit("scan_progress", { ...this._progress, scanId });
      if (i + CONCURRENCY < toScan.length) await delay(BATCH_DELAY_MS);
    }

    // Retry pass
    if (this._retryQueue.length > 0) {
      const retries = [...this._retryQueue];
      this._retryQueue = [];
      console.log(`[Scanner #${scanId}] Retrying ${retries.length} symbols...`);
      for (const sym of retries) { await this._processSymbol(sym, true); await delay(600); }
    }

    const durationMs = Date.now() - startMs;
    this._lastScanAt = new Date().toISOString();
    this._lastScanDurationMs = durationMs;
    this._running = false;

    const summary = this.getSummaryAll();
    const totalFound = Object.values(summary).reduce((acc, s) => acc + s.full.length, 0);

    console.log(`[Scanner #${scanId}] Done in ${(durationMs / 1000).toFixed(1)}s — ${totalFound} total signals across ${strategies.length} strategies`);
    this.emit("scan_complete", { scanId, total: toScan.length, durationMs, scannedAt: this._lastScanAt, summary });
  }

  // ── Process one symbol — fetch candles ONCE, run all strategies ───────────────
  async _processSymbol(symbol, isRetry = false) {
    try {
      const candles = await fetchCandles(symbol, SCANNER_RESOLUTION, 5000);
      this._errors.delete(symbol);

      for (const strategy of strategies) {
        try {
          const result = strategy.scan(symbol, candles);
          this._results.get(strategy.id).set(symbol, result);

          if (result.found) {
            this._progress.found++;
            this.emit("signal_found", { ...result, strategyId: strategy.id, strategyName: strategy.name });
            console.log(`[Scanner] ✅ ${strategy.id} | ${symbol} — SIGNAL (${result.patternStage})`);
          } else if (result.patternStage === "s2") {
            this.emit("signal_partial", { ...result, strategyId: strategy.id, strategyName: strategy.name });
          }
        } catch (stratErr) {
          console.error(`[Scanner] Strategy ${strategy.id} error on ${symbol}: ${stratErr.message}`);
          this._results.get(strategy.id).set(symbol, {
            symbol, found: false, patternStage: "none",
            error: stratErr.message, scannedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      const prev = this._errors.get(symbol) || { count: 0, lastError: "" };
      prev.count++;
      prev.lastError = err.message;
      this._errors.set(symbol, prev);

      if (!isRetry && prev.count <= RETRY_LIMIT) {
        this._retryQueue.push(symbol);
        console.warn(`[Scanner] ⚠ ${symbol} fetch failed (retry): ${err.message}`);
      } else {
        console.error(`[Scanner] ✗ ${symbol} permanently failed: ${err.message}`);
        for (const strategy of strategies) {
          this._results.get(strategy.id).set(symbol, {
            symbol, found: false, patternStage: "none",
            error: err.message, scannedAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────────────────

  /** All results for a specific strategy */
  getResultsByStrategy(strategyId) {
    const map = this._results.get(strategyId);
    return map ? [...map.values()] : [];
  }

  /** Single symbol result for a specific strategy */
  getResult(strategyId, symbol) {
    return this._results.get(strategyId)?.get(symbol) || null;
  }

  /** Summary (full + partial) for one strategy */
  getSummary(strategyId) {
    const all = this.getResultsByStrategy(strategyId);
    return {
      full: all.filter((r) => r.found),
      partial: all.filter((r) => r.patternStage === "s2"),
      errors: all.filter((r) => r.error),
    };
  }

  /** Summary for ALL strategies: { strategyId: { full, partial, errors } } */
  getSummaryAll() {
    const out = {};
    for (const s of strategies) { out[s.id] = this.getSummary(s.id); }
    return out;
  }

  /** List of registered strategies (id + name + description) */
  getStrategies() {
    return strategies.map((s) => ({ id: s.id, name: s.name, description: s.description }));
  }

  getStatus() {
    return {
      running: this._running,
      symbolCount: this._symbolList.length,
      resolution: SCANNER_RESOLUTION,
      lastScanAt: this._lastScanAt,
      lastScanDurationMs: this._lastScanDurationMs,
      progress: this._progress,
      scanCount: this._scanCount,
      errorCount: this._errors.size,
      intervalMs: SCAN_INTERVAL_MS,
      concurrency: CONCURRENCY,
      batchDelayMs: BATCH_DELAY_MS,
      strategies: this.getStrategies(),
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Singleton ────────────────────────────────────────────────────────────────
const scanner = new ScannerRunner();
module.exports = { scanner, ScannerRunner };