/**
 * pending_signals_reset.js
 * Clears pending_signals.json at 9:14 IST every market day (Mon-Fri)
 * Run once: node pending_signals_reset.js
 * Keeps running as a background scheduler.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const PENDING_FILE = path.join(__dirname, "data", "telegram_signals.json");
const RESET_HOUR = 16;
const RESET_MIN = 27;

function isWeekday() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return d.getDay() >= 1 && d.getDay() <= 5;
}

function resetPending() {
  if (!isWeekday()) { console.log("Weekend — skipping reset"); return; }
  const store = { date: null, signals: [] };
  try {
    const dir = path.dirname(PENDING_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PENDING_FILE, JSON.stringify(store, null, 2), "utf8");
    console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] pending_signals.json RESET ✅`);
  } catch (e) {
    console.error("Reset failed:", e.message);
  }
}

function msUntilNext(hh, mm) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const target = new Date(now);
  target.setHours(hh, mm, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target - now;
}

function scheduleNext() {
  const ms = msUntilNext(RESET_HOUR, RESET_MIN);
  const mins = (ms / 60000).toFixed(1);
  console.log(`⏰ Next reset at ${RESET_HOUR}:${String(RESET_MIN).padStart(2, "0")} IST  (in ${mins} min)`);
  setTimeout(() => { resetPending(); scheduleNext(); }, ms);
}

console.log("📋 pending_signals reset scheduler started");
scheduleNext();
process.stdin.resume();
