/**
 * futuresUtils.js
 *
 * NOTE: This file was not found wired into any route/service in the
 * uploaded project — it appears to be a standalone helper used elsewhere.
 * Provided here as a corrected drop-in replacement for wherever it's
 * actually required from.
 *
 * FIX (vs. original): NSE monthly/quarterly/half-yearly F&O contract expiry
 * moved from the LAST THURSDAY of the month to the LAST TUESDAY of the
 * month, per NSE circular Ref. No. 111/2025 (June 25, 2025), effective for
 * contracts expiring on/after September 1, 2025. An earlier proposal to
 * move expiry to Monday (announced March 2025) was deferred and never went
 * live — Tuesday is the rule that has actually been in effect since
 * September 2025. The original `getLastThursday()` was still hunting for
 * day-of-week 4 (Thursday); it now hunts for day-of-week 2 (Tuesday) and
 * has been renamed to getLastTuesday() (with a backward-compatible alias)
 * so nothing importing the old name breaks.
 *
 * Practical symptom this was causing: for ~2 extra days every month (the
 * old "Wed/Thu after the real Tuesday expiry"), isRolled stayed false even
 * though NSE had already retired that contract, so this code kept building
 * a symbol for an expired contract — which Fyers correctly rejected as
 * "Invalid symbol provided".
 *
 * Known limitation carried over from the original (not fixed here, flagging
 * for awareness): if the computed last-Tuesday falls on an exchange
 * holiday, NSE shifts expiry to the previous trading day. This module does
 * not currently account for holidays — only the day-of-week rule.
 */

const moment = require("moment");

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Day-of-week constant for the current NSE F&O expiry day (Tuesday = 2).
// Centralized here so a future exchange rule-change only needs one edit.
const EXPIRY_DOW = 2; // Tuesday

function getLastTuesday(year, month) {
  const d = moment({ year, month }).endOf("month").startOf("day");
  while (d.day() !== EXPIRY_DOW) d.subtract(1, "day");
  return d;
}
// Backward-compatible alias — keeps any existing `getLastThursday(...)` call
// sites working without a rename, while actually computing the Tuesday.
const getLastThursday = getLastTuesday;

function getActiveFuturesMonth() {
  const now = moment();
  let year = now.year();
  let month = now.month();

  const curExpiry = getLastTuesday(year, month);
  const curExpiryClose = curExpiry.clone().hour(15).minute(30);

  if (now.isAfter(curExpiryClose)) {
    const next = moment({ year, month }).add(1, "month");
    year = next.year();
    month = next.month();
  }

  const expiry = getLastTuesday(year, month);

  return {
    year,
    month,
    expiry,
    expiryStr: expiry.format("YYYY-MM-DD"),
    isRolled: now.isAfter(curExpiryClose),
  };
}

function buildFuturesSymbol(ticker, cm) {
  const mon = MONTHS_SHORT[cm.month];
  const yy = String(cm.year).slice(2);
  return `NSE:${ticker}${yy}${mon}FUT`;
}

function equityToFutures(equitySymbol, contractMonth = null) {
  const cm = contractMonth || getActiveFuturesMonth();

  let ticker = String(equitySymbol)
    .replace(/^NSE:/i, "")
    .replace(/^BSE:/i, "")
    .replace(/^MCX:/i, "")
    .replace(/-EQ$/i, "")
    .replace(/-INDEX$/i, "")
    .trim();

  if (ticker === "NIFTY50") ticker = "NIFTY";
  if (ticker === "BANKNIFTY") ticker = "BANKNIFTY";

  return buildFuturesSymbol(ticker, cm);
}

function getFuturesSymbol(equitySymbol) {
  return equityToFutures(equitySymbol, getActiveFuturesMonth());
}

// ─── Chart link (Fyers) ───────────────────────────────────────────────────────
function getFyersChartLink(futuresSymbol) {
  return `https://chart.fyers.in/#symbol=${encodeURIComponent(futuresSymbol)}&interval=15`;
}

// Alias — keeps any old import of getFuturesTradingViewLink working too
const getFuturesTradingViewLink = getFyersChartLink;

function getFuturesTVSymbol(futuresSymbol) {
  return futuresSymbol;
}

function loadSymbolsWithFutures(inputExcel, columnName = "symbol") {
  const XLSX = require("xlsx");

  const workbook = XLSX.readFile(inputExcel);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  if (!rows.length) throw new Error("Excel file is empty");
  if (!(columnName in rows[0])) throw new Error(`Column '${columnName}' not found`);

  const cm = getActiveFuturesMonth();
  console.log(`📅 Active Futures Contract: expires ${cm.expiryStr}${cm.isRolled ? " [ROLLED]" : ""}`);

  const pairs = rows
    .map((row) => String(row[columnName]).trim())
    .filter((s) => s.length > 3 && /^NSE:/i.test(s))
    .map((eq) => {
      const equitySymbol = eq.toUpperCase().endsWith("-EQ") ? eq : `${eq}-EQ`;
      const futuresSymbol = equityToFutures(equitySymbol, cm);
      return { equitySymbol, futuresSymbol };
    });

  if (pairs.length > 0) {
    console.log(`✅ Loaded ${pairs.length} symbols`);
    console.log(`   Equity  [0]: ${pairs[0].equitySymbol}`);
    console.log(`   Futures [0]: ${pairs[0].futuresSymbol}`);
  }

  return {
    equitySymbols: pairs.map((p) => p.equitySymbol),
    futuresSymbols: pairs.map((p) => p.futuresSymbol),
    pairs,
    contractMonth: cm,
  };
}

function logContractInfo() {
  const cm = getActiveFuturesMonth();
  const daysToExpiry = cm.expiry.diff(moment(), "days");
  const example = buildFuturesSymbol("RELIANCE", cm);

  console.log("═".repeat(60));
  console.log("📅 FUTURES CONTRACT INFO");
  console.log("═".repeat(60));
  console.log(`   Expiry Date   : ${cm.expiryStr} (${daysToExpiry} day(s) away)`);
  console.log(`   Status        : ${cm.isRolled ? "⚠️  ROLLED (post-expiry)" : "✅ Current"}`);
  console.log(`   Symbol format : NSE:{TICKER}{YY}{Mon}FUT`);
  console.log(`   Example       : NSE:RELIANCE-EQ  →  ${example}`);
  console.log("═".repeat(60));
}

module.exports = {
  getActiveFuturesMonth,
  equityToFutures,
  getFuturesSymbol,
  getFyersChartLink,
  getFuturesTradingViewLink,   // ← alias, same function — fixes the crash
  getFuturesTVSymbol,
  loadSymbolsWithFutures,
  getLastThursday,             // ← alias kept for backward compatibility — now actually returns last Tuesday
  getLastTuesday,
  buildFuturesSymbol,
  logContractInfo,
};
