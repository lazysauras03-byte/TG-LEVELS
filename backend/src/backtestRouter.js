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
const router  = express.Router();
const { backtestRunner } = require("./backtestRunner");

router.post("/trigger", async (req, res) => {
  try {
    const resolution = req.body?.resolution;
    const out = await backtestRunner.triggerNow(resolution);
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
  res.json({ results: backtestRunner.getResults(), count: backtestRunner.getResults().length });
});

module.exports = router;
