/**
 * symbolsRouter.js
 * ─────────────────────────────────────────────────────────────────
 * Provides a REST endpoint that merges symbols from:
 *   1. frontend/src/symbols.json  (curated list)
 *   2. frontend/src/stocks.xlsx   (EQ sheet — 203 NSE equities)
 *   3. frontend/src/NIFTY.xlsx    (same format, Nifty-specific list)
 *
 * GET /api/symbols
 *   Returns: [{ symbol: "NSE:NIFTY50-INDEX", name: "NIFTY 50" }, ...]
 *   Deduped by symbol string, sorted alphabetically by name.
 *   Indices (NIFTY50-INDEX, NIFTYBANK-INDEX, SENSEX) appear first.
 *
 * The merged list is cached at startup (re-read if file changes).
 * ─────────────────────────────────────────────────────────────────
 */

"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");

const router = express.Router();

// Paths relative to backend/src/
const FRONTEND_SRC = path.resolve(__dirname, "../../frontend/src");
const SYMBOLS_JSON = path.join(FRONTEND_SRC, "symbols.json");
const STOCKS_XLSX = path.join(FRONTEND_SRC, "stocks.xlsx");
const NIFTY_XLSX = path.join(FRONTEND_SRC, "NIFTY.xlsx");

let _cachedSymbols = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function loadExcel(filePath) {
  try {
    // Dynamic require so the rest of the server doesn't hard-depend on xlsx
    // if it isn't installed. Gracefully return [] if unavailable.
    const XLSX = require("xlsx");
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    return rows
      .filter((r) => r.symbol && r.Name)
      .map((r) => ({
        symbol: String(r.symbol).trim(),
        name: String(r.Name).trim(),
      }));
  } catch (err) {
    console.warn(`[Symbols] Could not read ${path.basename(filePath)}: ${err.message}`);
    return [];
  }
}

function loadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const arr = JSON.parse(raw);
    return arr
      .filter((s) => s.symbol && s.name)
      .map((s) => ({ symbol: String(s.symbol).trim(), name: String(s.name).trim() }));
  } catch (err) {
    console.warn(`[Symbols] Could not read symbols.json: ${err.message}`);
    return [];
  }
}

function buildSymbolList() {
  const seen = new Map(); // symbol → entry

  const jsonSymbols = loadJson(SYMBOLS_JSON);
  const stocksSymbols = loadExcel(STOCKS_XLSX);
  const niftySymbols = loadExcel(NIFTY_XLSX);

  // Merge — json takes priority for naming, then excel sheets
  for (const s of [...jsonSymbols, ...stocksSymbols, ...niftySymbols]) {
    if (!seen.has(s.symbol)) {
      seen.set(s.symbol, s);
    }
  }

  const all = Array.from(seen.values());

  // Indices first, then sorted alphabetically
  const isIndex = (sym) =>
    sym.symbol.includes("INDEX") || sym.symbol.includes("SENSEX");

  const indices = all.filter(isIndex).sort((a, b) => a.name.localeCompare(b.name));
  const equities = all.filter((s) => !isIndex(s)).sort((a, b) => a.name.localeCompare(b.name));

  return [...indices, ...equities];
}

function getSymbols(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _cachedSymbols && now - _cacheTime < CACHE_TTL_MS) {
    return _cachedSymbols;
  }
  _cachedSymbols = buildSymbolList();
  _cacheTime = now;
  console.log(`[Symbols] Loaded ${_cachedSymbols.length} symbols`);
  return _cachedSymbols;
}

// ── Routes ───────────────────────────────────────────────────────

/** GET /api/symbols — full list */
router.get("/", (req, res) => {
  try {
    const symbols = getSymbols();
    res.json(symbols);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/symbols/search?q=NIFTY — filtered search */
router.get("/search", (req, res) => {
  const q = (req.query.q || "").toLowerCase().trim();
  if (!q) return res.json([]);
  try {
    const symbols = getSymbols();
    const results = symbols
      .filter((s) => {
        const colonIdx = s.symbol.indexOf(":");
        const ticker = (colonIdx >= 0 ? s.symbol.slice(colonIdx + 1) : s.symbol).toLowerCase();
        return s.name.toLowerCase().startsWith(q) || ticker.startsWith(q);
      })
      .slice(0, 20);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/symbols/refresh — force reload from disk */
router.post("/refresh", (req, res) => {
  try {
    const symbols = getSymbols(true);
    res.json({ count: symbols.length, message: "Symbol list refreshed" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eager load at startup
getSymbols();

module.exports = router;
