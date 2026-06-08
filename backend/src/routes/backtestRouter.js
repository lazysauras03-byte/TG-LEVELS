/**
 * backtestRouter.js
 * Mounted at: /api/backtest
 *
 * POST /api/backtest/trigger   — start scan { resolution? }
 * POST /api/backtest/stop      — abort running scan
 * GET  /api/backtest/status    — runner state + progress
 * GET  /api/backtest/results   — all hits so far
 */

"use strict";

const express = require("express");
const router = express.Router();
const { backtestRunner } = require("../services/backtestRunner");

router.post("/trigger", async (req, res) => {
  try {
    const resolution = req.body?.resolution;
    const lookbackDays = req.body?.lookbackDays ? parseInt(req.body.lookbackDays) : null;
    const out = await backtestRunner.triggerNow(resolution, lookbackDays);
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/stop", (req, res) => {
  backtestRunner.stop();
  res.json({ status: "stop_requested", running: backtestRunner.getStatus().running });
});

router.get("/status", (req, res) => {
  res.json(backtestRunner.getStatus());
});

router.get("/results", (req, res) => {
  const results = backtestRunner.getResults();
  res.json({ results, count: results.length, chainIndex: backtestRunner.getChainIndex() });
});

// Returns the full list of MW numbers scanned (even if 0 hits) — used by frontend dropdown
router.get("/chain-index", (req, res) => {
  res.json({ chainIndex: backtestRunner.getChainIndex() });
});

module.exports = router;