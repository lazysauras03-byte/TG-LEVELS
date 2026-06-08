/**
 * symbolsRouter.js
 * ─────────────────────────────────────────────────────────────────
 * Provides REST endpoints that merge symbols from:
 *   1. frontend/src/symbols.json  — curated indices + NSE equities
 *   2. frontend/src/stocks.xlsx   — 203 NSE equities (EQ sheet)
 *   3. frontend/src/NIFTY.xlsx    — Nifty-specific list
 *   4. frontend/src/mcx.json      — MCX commodity futures (~20)
 *
 * Every returned entry includes a `type` field:
 *   "index" | "equity" | "commodity" | "etf"
 *
 * GET /api/symbols
 *   ?exchange=NSE|BSE|MCX   (optional filter)
 *   Returns: [{ symbol, name, type }, ...]
 *   Indices first, then sorted alphabetically.
 *   No param → returns everything (backward compatible).
 *
 * GET /api/symbols/search?q=GOLD[&exchange=MCX]
 *   Returns up to 20 filtered results.
 *
 * POST /api/symbols/refresh
 *   Force reload from disk.
 * ─────────────────────────────────────────────────────────────────
 */

"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");

const router = express.Router();

const FRONTEND_SRC = path.resolve(__dirname, "../../../frontend/src");
const SYMBOLS_JSON = path.join(FRONTEND_SRC, "symbols.json");
const MCX_JSON = path.join(FRONTEND_SRC, "mcx.json");
const STOCKS_XLSX = path.join(FRONTEND_SRC, "stocks.xlsx");
const NIFTY_XLSX = path.join(FRONTEND_SRC, "NIFTY.xlsx");

let _cachedSymbols = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Type inference ──────────────────────────────────────────────────────────
function inferType(sym, existingType) {
  if (existingType) return existingType;
  const s = sym.toUpperCase();
  if (s.startsWith("MCX:")) return "commodity";
  if (s.includes("INDEX") || s.includes("SENSEX")) return "index";
  if (s.endsWith("-ETF") || s.endsWith("-EF")) return "etf";
  return "equity";
}

// ── Loaders ─────────────────────────────────────────────────────────────────
function loadExcel(filePath) {
  try {
    const XLSX = require("xlsx");
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    return rows
      .filter((r) => r.symbol && r.Name)
      .map((r) => ({
        symbol: String(r.symbol).trim(),
        name: String(r.Name).trim(),
        type: inferType(String(r.symbol).trim(), null),
      }));
  } catch (err) {
    console.warn(`[Symbols] Could not read ${path.basename(filePath)}: ${err.message}`);
    return [];
  }
}

function loadJson(filePath) {
  try {
    const arr = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return arr
      .filter((s) => s.symbol && s.name)
      .map((s) => ({
        symbol: String(s.symbol).trim(),
        name: String(s.name).trim(),
        type: inferType(String(s.symbol).trim(), s.type || null),
      }));
  } catch (err) {
    console.warn(`[Symbols] Could not read ${path.basename(filePath)}: ${err.message}`);
    return [];
  }
}

// ── Build merged list ────────────────────────────────────────────────────────
function buildSymbolList() {
  const seen = new Map(); // symbol → entry

  const sources = [
    ...loadJson(SYMBOLS_JSON),
    ...loadJson(MCX_JSON),
    ...loadExcel(STOCKS_XLSX),
    ...loadExcel(NIFTY_XLSX),
  ];

  for (const s of sources) {
    if (!seen.has(s.symbol)) seen.set(s.symbol, s);
  }

  const all = Array.from(seen.values());

  // Indices first, then alphabetically by name
  const indices = all.filter(s => s.type === "index")
    .sort((a, b) => a.name.localeCompare(b.name));
  const rest = all.filter(s => s.type !== "index")
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...indices, ...rest];
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

// ── Helpers ──────────────────────────────────────────────────────────────────
function exchangeOf(sym) {
  const idx = sym.symbol.indexOf(":");
  return idx >= 0 ? sym.symbol.slice(0, idx).toUpperCase() : "NSE";
}

// ── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/symbols[?exchange=NSE|MCX|BSE] */
router.get("/", (req, res) => {
  try {
    let symbols = getSymbols();
    const exch = (req.query.exchange || "").toUpperCase();
    if (exch) symbols = symbols.filter(s => exchangeOf(s) === exch);
    res.json(symbols);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/symbols/search?q=GOLD[&exchange=MCX] */
router.get("/search", (req, res) => {
  const q = (req.query.q || "").toLowerCase().trim();
  const exch = (req.query.exchange || "").toUpperCase();
  if (!q) return res.json([]);
  try {
    let symbols = getSymbols();
    if (exch) symbols = symbols.filter(s => exchangeOf(s) === exch);
    const results = symbols
      .filter((s) => {
        const colonIdx = s.symbol.indexOf(":");
        const ticker = (colonIdx >= 0 ? s.symbol.slice(colonIdx + 1) : s.symbol).toLowerCase();
        return s.name.toLowerCase().startsWith(q) || ticker.startsWith(q) || ticker.includes(q);
      })
      .slice(0, 20);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/symbols/refresh */
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