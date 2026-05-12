/**
 * symbolsRouter.js
 * ─────────────────────────────────────────────────────────────────
 * Provides a REST endpoint for the symbol search dropdown.
 *
 * Source of truth: frontend/src/symbols.json
 *   - 206 symbols (indices + NSE equities)
 *   - NSE:NIFTY50-INDEX is always the first entry
 *   - Maintained as a plain JSON file — no xlsx dependency needed
 *
 * GET  /api/symbols           → full list
 * GET  /api/symbols/search?q= → filtered search (max 20 results)
 * POST /api/symbols/refresh   → force reload from disk
 *
 * The list is cached in memory for 1 hour and reloaded on refresh.
 * ─────────────────────────────────────────────────────────────────
 */

"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");

const router = express.Router();

const SYMBOLS_JSON = path.resolve(__dirname, "../../frontend/src/symbols.json");

let _cachedSymbols = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function loadSymbols() {
  try {
    const raw = fs.readFileSync(SYMBOLS_JSON, "utf8");
    const arr = JSON.parse(raw);
    const filtered = arr
      .filter((s) => s && s.symbol && s.name)
      .map((s) => ({
        symbol: String(s.symbol).trim(),
        name: String(s.name).trim(),
      }));

    // Ensure NIFTY50 is always the first result regardless of file order
    const nifty50 = filtered.filter((s) => s.symbol === "NSE:NIFTY50-INDEX");
    const otherIndex = filtered.filter(
      (s) => s.symbol !== "NSE:NIFTY50-INDEX" &&
        (s.symbol.includes("INDEX") || s.symbol.includes("SENSEX"))
    );
    const equities = filtered.filter(
      (s) => !s.symbol.includes("INDEX") && !s.symbol.includes("SENSEX")
    );

    return [...nifty50, ...otherIndex, ...equities];
  } catch (err) {
    console.warn(`[Symbols] Could not read symbols.json: ${err.message}`);
    // Fallback: at minimum return NIFTY50 so the app isn't broken
    return [{ symbol: "NSE:NIFTY50-INDEX", name: "NIFTY 50" }];
  }
}

function getSymbols(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _cachedSymbols && now - _cacheTime < CACHE_TTL_MS) {
    return _cachedSymbols;
  }
  _cachedSymbols = loadSymbols();
  _cacheTime = now;
  console.log(`[Symbols] Loaded ${_cachedSymbols.length} symbols`);
  return _cachedSymbols;
}

// ── Routes ───────────────────────────────────────────────────────

/** GET /api/symbols — full list */
router.get("/", (req, res) => {
  try {
    res.json(getSymbols());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/symbols/search?q=NIFTY
 * Searches both the display name and the ticker portion of the symbol.
 * NIFTY50 always appears first in results when query matches it.
 * Returns max 20 results.
 */
router.get("/search", (req, res) => {
  const q = (req.query.q || "").toLowerCase().trim();
  if (!q) return res.json([]);
  try {
    const symbols = getSymbols();
    const results = symbols
      .filter((s) => {
        const colonIdx = s.symbol.indexOf(":");
        const ticker = (colonIdx >= 0 ? s.symbol.slice(colonIdx + 1) : s.symbol).toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          ticker.startsWith(q) ||
          ticker.includes(q)
        );
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