/**
 * scannerRunner.js
 * ─────────────────────────────────────────────────────────────────
 * Runs ALL registered strategies across all symbols.
 *
 * Results are stored per-strategy:
 *   _results = Map<strategyId, Map<symbol, ScanResult>>
 *
 * Manual-only scan control:
 *   scanner.triggerNow()  — run one scan immediately
 *   scanner.stop()        — abort any running scan / cancel scheduled one
 *   No auto-start. No periodic timer. You control when it runs.
 *
 * Symbol filtering:
 *   MCX continuous contract symbols (ending in -I or -I suffix pattern)
 *   are silently dropped — Fyers does not support them for intraday history.
 * ─────────────────────────────────────────────────────────────────
 */

"use strict";

const EventEmitter = require("events");
const { fetchCandles } = require("./fyers");
const strategies = require("./strategies/strategyRegistry");

// ─── Config ───────────────────────────────────────────────────────────────────
const CONCURRENCY = parseInt(process.env.SCANNER_CONCURRENCY || "3");
const BATCH_DELAY_MS = parseInt(process.env.SCANNER_BATCH_DELAY_MS || "1000");
const SCANNER_RESOLUTION = parseInt(process.env.SCANNER_RESOLUTION || "15");
const RETRY_LIMIT = 5;

// ─── Symbol filter ────────────────────────────────────────────────────────────
// MCX continuous contracts like MCX:CRUDEOIL-I, MCX:SILVER-I etc. are not
// supported by Fyers for intraday history. Drop them silently at load time
// so they never waste API calls or log errors during scans.
function isValidScanSymbol(symbol) {
  if (!symbol) return false;
  const s = String(symbol).trim().toUpperCase();
  // Drop MCX continuous-contract symbols: anything ending in -I or like GOLDPETAL-I
  if (s.startsWith("MCX:") && /-I$/.test(s.split(":")[1] || "")) return false;
  return true;
}

// ─── ScannerRunner ────────────────────────────────────────────────────────────
class ScannerRunner extends EventEmitter {
  constructor() {
    super();
    // Map<strategyId, Map<symbol, ScanResult>>
    this._results = new Map();
    this._errors = new Map();   // symbol → { count, lastError }
    this._retryQueue = [];
    this._running = false;
    this._aborted = false;
    this._scanCount = 0;
    this._symbolList = [];
    this._lastScanAt = null;
    this._lastScanDurationMs = null;
    this._progress = { total: 0, done: 0, found: 0 };

    for (const s of strategies) {
      this._results.set(s.id, new Map());
    }
  }

  // ── Symbol list ──────────────────────────────────────────────────────────────
  setSymbols(symbols) {
    const raw = [...new Set(symbols.filter(Boolean))];
    const valid = raw.filter(isValidScanSymbol);
    const dropped = raw.length - valid.length;
    this._symbolList = valid;
    console.log(
      `[Scanner] Symbol list: ${valid.length} symbols` +
      (dropped > 0 ? ` (${dropped} unsupported symbols dropped)` : "")
    );
  }
  getSymbols() { return [...this._symbolList]; }

  // ── Manual trigger ───────────────────────────────────────────────────────────
  async triggerNow() {
    if (this._running) return { status: "already_running", progress: this._progress };
    this._aborted = false;
    await this._runScan();
    return { status: "triggered", symbols: this._symbolList.length };
  }

  // ── Stop ─────────────────────────────────────────────────────────────────────
  stop() {
    if (this._running) {
      this._aborted = true;
      console.log("[Scanner] Stop requested — aborting current scan.");
    } else {
      console.log("[Scanner] Stop called — no scan running.");
    }
  }

  // ── Core scan loop ────────────────────────────────────────────────────────────
  async _runScan() {
    if (this._running) return;
    if (this._symbolList.length === 0) { console.log("[Scanner] No symbols — skipping"); return; }

    this._running = true;
    this._aborted = false;
    this._scanCount++;
    const scanId = this._scanCount;
    const startMs = Date.now();

    const toScan = [...new Set([...this._retryQueue, ...this._symbolList])];
    this._retryQueue = [];
    this._progress = { total: toScan.length, done: 0, found: 0 };

    console.log(`[Scanner #${scanId}] ${toScan.length} symbols × ${strategies.length} strategies @ res=${SCANNER_RESOLUTION}m`);
    this.emit("scan_start", {
      scanId,
      total: toScan.length,
      resolution: SCANNER_RESOLUTION,
      strategies: strategies.map(s => ({ id: s.id, name: s.name })),
    });

    for (let i = 0; i < toScan.length; i += CONCURRENCY) {
      if (this._aborted) {
        console.log(`[Scanner #${scanId}] Aborted after ${i} symbols.`);
        break;
      }
      const batch = toScan.slice(i, i + CONCURRENCY);
      await Promise.allSettled(batch.map((sym) => this._processSymbol(sym)));
      this._progress.done = Math.min(i + CONCURRENCY, toScan.length);
      this.emit("scan_progress", { ...this._progress, scanId });
      if (i + CONCURRENCY < toScan.length) await delay(BATCH_DELAY_MS);
    }

    // Retry pass (only if not aborted)
    if (!this._aborted && this._retryQueue.length > 0) {
      const retries = [...this._retryQueue];
      this._retryQueue = [];
      console.log(`[Scanner #${scanId}] Retrying ${retries.length} symbols...`);
      for (const sym of retries) {
        if (this._aborted) break;
        await this._processSymbol(sym, true);
        await delay(600);
      }
    }

    const durationMs = Date.now() - startMs;
    this._lastScanAt = new Date().toISOString();
    this._lastScanDurationMs = durationMs;
    this._running = false;
    this._aborted = false;

    const summary = this.getSummaryAll();
    const totalFound = Object.values(summary).reduce((acc, s) => acc + s.full.length, 0);

    console.log(`[Scanner #${scanId}] Done in ${(durationMs / 1000).toFixed(1)}s — ${totalFound} total signals across ${strategies.length} strategies`);
    this.emit("scan_complete", {
      scanId,
      total: toScan.length,
      durationMs,
      scannedAt: this._lastScanAt,
      summary,
    });
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

  getResultsByStrategy(strategyId) {
    const map = this._results.get(strategyId);
    return map ? [...map.values()] : [];
  }

  getResult(strategyId, symbol) {
    return this._results.get(strategyId)?.get(symbol) || null;
  }

  getSummary(strategyId) {
    const all = this.getResultsByStrategy(strategyId);
    return {
      full: all.filter((r) => r.found),
      partial: all.filter((r) => r.patternStage === "s2"),
      errors: all.filter((r) => r.error),
    };
  }

  getSummaryAll() {
    const out = {};
    for (const s of strategies) { out[s.id] = this.getSummary(s.id); }
    return out;
  }

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