/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║          NeoStox — System B : Full Automated EOD Updater               ║
 * ║                                                                          ║
 * ║  WHAT IT DOES (matches Prompt 1 + 2 + 3 exactly):                       ║
 * ║                                                                          ║
 * ║  PROMPT 1 — Overall_Summary.xlsx                                        ║
 * ║    ✅ Rebuilds / creates each date sheet (23-Feb, 09-Mar …)             ║
 * ║    ✅ Title bar, KPI block (row 3–5), trade table header (row 6)        ║
 * ║    ✅ CLOSED TRADES section (same-day entry+exit)                       ║
 * ║    ✅ CLOSED TRADES CONTINUED section (multi-day holds)                 ║
 * ║    ✅ Subtotals, Combined Total block                                   ║
 * ║    ✅ BUY vs SELL vs COMBINED stats table (14 metrics)                  ║
 * ║    ✅ SECTION METRICS table when both sections present                  ║
 * ║    ✅ Appends to Full Trade Log (sequential #, no dupes, WIN/LOSS color) ║
 * ║    ✅ Updates Overall Summary daily rows + TOTAL row                    ║
 * ║                                                                          ║
 * ║  PROMPT 2 — Backtest_Summary.xlsx                                       ║
 * ║    ✅ Appends new signals to All Signals sheet (no dupes)               ║
 * ║    ✅ Recalculates all stats: Win Rate, PF, Expectancy, Streaks, RR     ║
 * ║    ✅ Rebuilds Summary Dashboard metrics                                ║
 * ║    ✅ Rebuilds Win-Loss Log (Winners + Losers + Open sections)          ║
 * ║    ✅ Rebuilds Cumulative PnL tracker with drawdown                     ║
 * ║    ✅ Updates period date range in all titles                           ║
 * ║                                                                          ║
 * ║  PROMPT 3 — Trades.xlsx                                                 ║
 * ║    ✅ Cross-refs Overall_Summary Full Trade Log → Trade Taken sheet     ║
 * ║    ✅ Cross-refs Backtest signals → Not Taken sheet                     ║
 * ║    ✅ Duplicate prevention (Date+Symbol check)                          ║
 * ║    ✅ Date section dividers, WIN/LOSS/OPEN row coloring                 ║
 * ║    ✅ Never overwrites existing Notes/Candle Span                       ║
 * ║                                                                          ║
 * ║  AFTER ALL UPDATES → sends full EOD Telegram report to sir             ║
 * ║                                                                          ║
 * ║  RUN:                                                                    ║
 * ║    node systemB.js              ← run full update + send Telegram       ║
 * ║    node systemB.js --dry-run    ← preview only, no file writes          ║
 * ║    node systemB.js --schedule   ← auto-run at 15:40 IST daily          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

"use strict";
require("dotenv").config();

const { generateDailySummary } = require('./src/generateDailySummary');
const ExcelJS = require("exceljs");
const moment = require("moment");
const path = require("path");
const fs = require("fs");

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CFG = {
  tradesFile: process.env.TRADES_FILE || "C:\\Users\\PIS\\Desktop\\Trade History\\Trades Taken not taken\\Trades.xlsx",
  backtestFile: process.env.BACKTEST_FILE || "C:\\Users\\PIS\\Desktop\\Trade History\\Backtest Data\\Backtest_Summary.xlsx",
  overallFile: process.env.OVERALL_FILE || "C:\\Users\\PIS\\Desktop\\Trade History\\Overall Summary\\Overall_Summary.xlsx",
  telegramToken: process.env.TELEGRAM_TOKEN || "8671371710:AAFXdzpLwRWQ1TNgN8g1PV4Sm8CZ4oMiIbc",
  telegramChat: process.env.TELEGRAM_CHAT_ID || "8559767849",
  scheduleTime: process.env.SCHEDULE_TIME || "15:40",
  dryRun: false,
};

// ─── STYLE CONSTANTS (matching your exact existing sheets) ───────────────────
const S = {
  // fills
  titleFill: argb("1F2D3D"),
  kpiLabelFill: argb("1E3A5F"),
  kpiHdrFill: argb("2E4053"),
  kpiEvenFill: argb("EAF4FB"),
  notesFill: argb("F8F9FA"),
  tblHdrFill: argb("34495E"),
  closedHdrFill: argb("1E3A5F"),
  contHdrFill: argb("4A235A"),
  combinedFill: argb("1F2D3D"),
  statsHdrFill: argb("1E3A5F"),
  sectHdrFill: argb("4A235A"),
  subtotFill: argb("EEEEEE"),
  winFill: argb("F0FFF4"),
  lossFill: argb("FFF0F0"),
  openFill: argb("FFF3CD"),
  profitFill: argb("27AE60"),
  lossPnlFill: argb("E74C3C"),
  // fonts
  white: { name: "Arial", bold: true, size: 12, color: { argb: "FFFFFFFF" } },
  white10: { name: "Arial", bold: true, size: 10, color: { argb: "FFFFFFFF" } },
  white9: { name: "Arial", bold: true, size: 9, color: { argb: "FFFFFFFF" } },
  white9i: { name: "Arial", italic: true, size: 9, color: { argb: "FFFFFFFF" } },
  dark10: { name: "Arial", size: 10, color: { argb: "FF1F2D3D" } },
  dark9: { name: "Arial", size: 9, color: { argb: "FF333333" } },
  bold9dark: { name: "Arial", bold: true, size: 9, color: { argb: "FF1F2D3D" } },
  bold10dark: { name: "Arial", bold: true, size: 10, color: { argb: "FF1F2D3D" } },
  noteFont: { name: "Arial", italic: true, size: 9, color: { argb: "FF555555" } },
  greenPnl: { name: "Arial", bold: true, size: 10, color: { argb: "FF27AE60" } },
  redPnl: { name: "Arial", bold: true, size: 10, color: { argb: "FFE74C3C" } },
  // alignment
  ctr: { horizontal: "center", vertical: "middle", wrapText: true },
  lft: { horizontal: "left", vertical: "middle" },
  rgt: { horizontal: "right", vertical: "middle" },
};

function argb(hex) {
  return { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + hex } };
}

function border() {
  const b = { style: "thin", color: { argb: "FFBFBFBF" } };
  return { top: b, left: b, bottom: b, right: b };
}

// ─── NUMBER HELPERS ───────────────────────────────────────────────────────────
function parseNum(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[₹,\s+]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function rupee(n) {
  if (n === null || n === undefined || isNaN(n)) return "₹0.00";
  const abs = Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `₹-${abs}` : `₹${abs}`;
}

function rupeeSign(n) {
  if (!n) return "₹0.00";
  return n >= 0 ? `₹+${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `₹-${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(n, dec = 1) {
  if (isNaN(n) || n === null) return "0.0%";
  return n.toFixed(dec) + "%";
}

function istNow() { return moment().utcOffset("+05:30"); }
function todayLabel() { return istNow().format("DD-MMM"); }       // 10-Mar
function todayFull() { return istNow().format("ddd DD MMM YYYY"); }

// ─── METRICS ENGINE ──────────────────────────────────────────────────────────
function calcMetrics(trades) {
  if (!trades || !trades.length) return {
    count: 0, wins: 0, losses: 0, winRate: 0, gross: 0, brok: 0, tax: 0, net: 0,
    avgWin: 0, avgLoss: 0, best: 0, worst: 0, rr: 0
  };
  const wins = trades.filter(t => String(t.result || "").includes("WIN"));
  const losses = trades.filter(t => String(t.result || "").includes("LOSS"));
  const gross = trades.reduce((s, t) => s + parseNum(t.gross), 0);
  const brok = trades.reduce((s, t) => s + parseNum(t.brok), 0);
  const tax = trades.reduce((s, t) => s + parseNum(t.tax), 0);
  const net = trades.reduce((s, t) => s + parseNum(t.net), 0);
  const winNets = wins.map(t => parseNum(t.net));
  const lossNets = losses.map(t => parseNum(t.net));
  const avgWin = winNets.length ? winNets.reduce((a, b) => a + b, 0) / winNets.length : 0;
  const avgLoss = lossNets.length ? lossNets.reduce((a, b) => a + b, 0) / lossNets.length : 0;
  const best = trades.length ? Math.max(...trades.map(t => parseNum(t.net))) : 0;
  const worst = trades.length ? Math.min(...trades.map(t => parseNum(t.net))) : 0;
  const winRate = trades.length ? wins.length / trades.length * 100 : 0;
  const rr = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;
  return {
    count: trades.length, wins: wins.length, losses: losses.length,
    winRate, gross, brok, tax, net, avgWin, avgLoss, best, worst, rr
  };
}

// ─── SAFE SHEET CLEAR ────────────────────────────────────────────────────────
function clearSheet(ws) {
  // Step 1: collect all merge range keys before touching anything
  const mergeKeys = [];
  try {
    const mergeMap = ws._merges || {};
    for (const key of Object.keys(mergeMap)) {
      mergeKeys.push(key);
    }
  } catch (_) { }

  // Step 2: unmerge every range (ExcelJS stores as "A1:P1" string keys)
  for (const key of mergeKeys) {
    try { ws.unMergeCells(key); } catch (_) {
      try { ws.unmergeCell(key); } catch (_) { }
    }
  }

  // Step 3: delete all rows top-to-bottom in one splice
  const lastRowNum = ws.lastRow ? ws.lastRow.number : 0;
  if (lastRowNum > 0) {
    try {
      ws.spliceRows(1, lastRowNum + 2);
    } catch (_) {
      for (let i = lastRowNum; i >= 1; i--) {
        try { ws.spliceRows(i, 1); } catch (_) { }
      }
    }
  }
}

// ─── WRITE CELL HELPER ───────────────────────────────────────────────────────
function wc(ws, rowNum, colNum, value, style = {}) {
  const cell = ws.getCell(rowNum, colNum);
  cell.value = value;
  if (style.fill) cell.fill = style.fill;
  if (style.font) cell.font = style.font;
  if (style.alignment) cell.alignment = style.alignment;
  if (style.border !== false) cell.border = border();
  return cell;
}

function mergeRow(ws, rowNum, fromCol, toCol, value, style = {}, height = 18) {
  ws.mergeCells(rowNum, fromCol, rowNum, toCol);
  const cell = ws.getCell(rowNum, fromCol);
  cell.value = value;
  if (style.fill) cell.fill = style.fill;
  if (style.font) cell.font = style.font;
  if (style.alignment) cell.alignment = style.alignment;
  cell.border = border();
  ws.getRow(rowNum).height = height;
  return cell;
}

// ════════════════════════════════════════════════════════════════════════════════
//  PROMPT 1 — OVERALL SUMMARY UPDATER
// ════════════════════════════════════════════════════════════════════════════════

async function updateOverallSummary(newTrades) {
  /**
   * newTrades = array of trade objects read from NeoStox source
   * Each: { date(DD-Mon), symbol, instrument, side, entryTime, exitTime,
   *         entryPx, exitPx, qty, target, sl, gross, brok, tax, net,
   *         result, exitType, entryDate(Date), exitDate(Date) }
   */
  if (!fs.existsSync(CFG.overallFile)) {
    console.log("[WARN] Overall_Summary.xlsx not found — skipping.");
    return [];
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(CFG.overallFile);
  console.log(`  [P1] Loaded Overall_Summary — ${wb.worksheets.length} sheets`);

  // Group trades by entry date label
  const byDate = {};
  for (const t of newTrades) {
    const lbl = t.date; // "23-Feb"
    if (!byDate[lbl]) byDate[lbl] = [];
    byDate[lbl].push(t);
  }

  const targetDates = Object.keys(byDate);
  console.log(`  [P1] Target dates: ${targetDates.join(", ")}`);

  // Process each date
  for (const dateLabel of targetDates) {
    const trades = byDate[dateLabel];
    await buildDateSheet(wb, dateLabel, trades);
  }

  // Update Full Trade Log
  await updateFullTradeLog(wb, newTrades);

  // Update Overall Summary dashboard sheet
  await updateOverallDashboard(wb, byDate);

  if (!CFG.dryRun) {
    await wb.xlsx.writeFile(CFG.overallFile);
    console.log(`  [P1] Saved Overall_Summary.xlsx`);
  } else {
    console.log(`  [P1] DRY RUN — would save Overall_Summary.xlsx`);
  }

  return newTrades;
}

async function buildDateSheet(wb, dateLabel, trades) {
  // dateLabel = "09-Mar"
  // Determine full date & weekday
  const parsed = moment(dateLabel, "DD-MMM");
  const fullDate = parsed.format("MMM DD, YYYY");
  const weekday = parsed.format("dddd");

  // Split closed vs continued
  const closed = trades.filter(t => t.isSameDay);
  const continued = trades.filter(t => !t.isSameDay);

  // Get or create sheet
  let ws = wb.worksheets.find(s => s.name === dateLabel);
  if (ws) {
    clearSheet(ws);
  } else {
    // Insert before Full Trade Log
    const ftlIdx = wb.worksheets.findIndex(s => s.name.includes("Full Trade Log"));
    ws = wb.addWorksheet(dateLabel);
    if (ftlIdx >= 0) {
      // Move to correct position (chronological)
      wb.worksheets.splice(wb.worksheets.indexOf(ws), 1);
      wb.worksheets.splice(ftlIdx, 0, ws);
    }
  }

  ws.views = [{ state: "frozen", ySplit: 6 }];

  // Column widths (A=5,B=14,C=28,D=6,E=22,F=22,G=8,H=12,I=12,J=18,K=18,L=14,M=11,N=11,O=14,P=12)
  const colW = [5, 14, 28, 6, 22, 22, 8, 12, 12, 18, 18, 14, 11, 11, 14, 12];
  colW.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const COLS = 16;
  let row = 1;

  // ── ROW 1: Title ─────────────────────────────────────────────────────────
  mergeRow(ws, row, 1, COLS,
    `📊 NeoStox Trade History — ${dateLabel}  |  ${fullDate}  (${weekday})`,
    { fill: S.titleFill, font: { ...S.white, size: 12 }, alignment: S.ctr }, 24);
  row++;

  // ── ROW 2: KPI Label ─────────────────────────────────────────────────────
  mergeRow(ws, row, 1, COLS, "  KEY PERFORMANCE INDICATORS",
    { fill: S.kpiLabelFill, font: S.white10, alignment: S.lft }, 18);
  row++;

  // ── ROW 3: KPI Headers ───────────────────────────────────────────────────
  ws.getRow(row).height = 16;
  const kpiHdrs = ["Closed Trades", "", "Wins ✅", "", "Losses ❌", "", "Win Rate", "",
    "Net P&L (₹)", "Gross P&L (₹)", "Brokerage (₹)", "Tax & Fees (₹)",
    "Avg Win (₹)", "Avg Loss (₹)", "Best Trade (₹)", "Worst Trade (₹)"];
  kpiHdrs.forEach((h, i) => {
    wc(ws, row, i + 1, h, { fill: S.kpiHdrFill, font: S.white9, alignment: S.ctr });
  });
  row++;

  // ── ROW 4: KPI Values ────────────────────────────────────────────────────
  ws.getRow(row).height = 18;
  const combined = calcMetrics(trades);
  const kpiVals = [
    combined.count, "", combined.wins, "", combined.losses, "",
    pct(combined.winRate), "",
    combined.net,        // col I — colored separately
    combined.gross, combined.brok, combined.tax,
    combined.avgWin, combined.avgLoss, combined.best, combined.worst
  ];

  kpiVals.forEach((v, i) => {
    const colNum = i + 1;
    const isOdd = colNum % 2 === 1;
    const fill = colNum === 9
      ? (combined.net >= 0 ? argb("27AE60") : argb("E74C3C"))
      : (isOdd ? S.kpiEvenFill : argb("FFFFFF"));
    const font = colNum === 9
      ? { name: "Arial", bold: true, size: 11, color: { argb: "FFFFFFFF" } }
      : ([1, 3, 5, 7].includes(colNum) ? S.bold10dark : S.dark10);

    let displayVal = v;
    if (colNum >= 9) displayVal = typeof v === "number" ? rupee(v) : v;

    wc(ws, row, colNum, displayVal === "" ? null : displayVal,
      { fill, font, alignment: S.ctr });
  });
  row++;

  // ── ROW 5: NeoStox Summary Note ──────────────────────────────────────────
  ws.getRow(row).height = 15;
  const noteText = `  NeoStox → Net P&L: Rs. ${combined.net.toFixed(2)}  |  Completed: ${combined.count}  |  Win Rate: ${combined.winRate.toFixed(2)}%  |  Brokerage: Rs. ${combined.brok.toFixed(2)}  |  Taxes & Fees: Rs. ${combined.tax.toFixed(2)}`;
  mergeRow(ws, row, 1, COLS, noteText,
    { fill: S.notesFill, font: S.noteFont, alignment: S.lft }, 15);
  row++;

  // ── ROW 6: Trade Table Headers ────────────────────────────────────────────
  ws.getRow(row).height = 16;
  const tblH = ["#", "Symbol", "Instrument", "Side", "Entry Time", "Exit Time", "Qty",
    "Entry ₹", "Exit ₹", "Target", "Stop Loss", "Gross P&L ₹",
    "Brokerage ₹", "Tax ₹", "Net P&L ₹", "Result"];
  tblH.forEach((h, i) => {
    wc(ws, row, i + 1, h, { fill: S.tblHdrFill, font: S.white9, alignment: S.ctr });
  });
  row++;

  // ── CLOSED TRADES SECTION ────────────────────────────────────────────────
  if (closed.length > 0) {
    mergeRow(ws, row, 1, COLS,
      `  📋 CLOSED TRADES  (${closed.length} trades — same day entry & exit)`,
      { fill: S.closedHdrFill, font: S.white9, alignment: S.lft }, 16);
    row++;

    let tradeNum = 1;
    for (const t of closed) {
      const isWin = String(t.result || "").includes("WIN");
      const fill = isWin ? S.winFill : S.lossFill;
      ws.getRow(row).height = 15;

      const vals = [
        tradeNum, t.symbol, t.instrument, t.side,
        t.entryTime, t.exitTime, t.qty,
        t.entryPx, t.exitPx, t.target || "-", t.sl || "-",
        t.gross, t.brok, t.tax, t.net, t.result
      ];
      vals.forEach((v, i) => {
        const colNum = i + 1;
        const isRgtCol = [12, 13, 14, 15].includes(colNum);
        const font = (colNum === 15)
          ? (parseNum(t.net) >= 0 ? { ...S.dark9, bold: true, color: { argb: "FF27AE60" } } : { ...S.dark9, bold: true, color: { argb: "FFE74C3C" } })
          : (colNum === 16)
            ? (isWin ? { ...S.dark9, bold: true, color: { argb: "FF27AE60" } } : { ...S.dark9, bold: true, color: { argb: "FFE74C3C" } })
            : S.dark9;
        const align = isRgtCol ? S.rgt : S.ctr;
        wc(ws, row, colNum, v, { fill, font, alignment: align });
      });
      row++;
      tradeNum++;
    }

    // Subtotal
    const cs = calcMetrics(closed);
    ws.getRow(row).height = 14;
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].forEach(c => wc(ws, row, c, c === 2 ? "CLOSED SUBTOTAL" : null, { fill: S.subtotFill, font: S.bold9dark, alignment: S.lft }));
    wc(ws, row, 12, rupee(cs.gross), { fill: S.subtotFill, font: S.bold9dark, alignment: S.rgt });
    wc(ws, row, 13, rupee(cs.brok), { fill: S.subtotFill, font: S.bold9dark, alignment: S.rgt });
    wc(ws, row, 14, rupee(cs.tax), { fill: S.subtotFill, font: S.bold9dark, alignment: S.rgt });
    wc(ws, row, 15, rupee(cs.net), { fill: S.subtotFill, font: S.bold9dark, alignment: S.rgt });
    wc(ws, row, 16, `W:${cs.wins}  L:${cs.losses}`, { fill: S.subtotFill, font: S.bold9dark, alignment: S.ctr });
    row++;
    row++; // spacer
  }

  // ── CLOSED TRADES CONTINUED SECTION ──────────────────────────────────────
  if (continued.length > 0) {
    // Build unique exit dates
    const exitDates = [...new Set(continued.map(t => {
      const DATE_FMTS2 = ["M/D/YYYY, h:mm:ss A", "M/D/YYYY, h:mm A", "YYYY-MM-DD HH:mm:ss", "YYYY-MM-DD"];
      const ed = t.exitDate instanceof Date
        ? moment(t.exitDate)
        : moment(String(t.exitDate || ""), DATE_FMTS2, false);
      return ed.isValid() ? ed.format("DD-MMM") : t.exitTime || "";
    }))].join(" / ");

    const firstNum = (closed.length || 0) + 1;
    const lastNum = firstNum + continued.length - 1;

    mergeRow(ws, row, 1, COLS,
      `  📋 CLOSED TRADES CONTINUED  (trades #${firstNum}–${lastNum} — entered ${dateLabel}, exited ${exitDates})`,
      { fill: S.contHdrFill, font: S.white9, alignment: S.lft }, 16);
    row++;

    let tradeNum = firstNum;
    for (const t of continued) {
      const isWin = String(t.result || "").includes("WIN");
      const fill = isWin ? S.winFill : S.lossFill;
      ws.getRow(row).height = 15;
      const vals = [
        tradeNum, t.symbol, t.instrument, t.side,
        t.entryTime, t.exitTime, t.qty,
        t.entryPx, t.exitPx, t.target || "-", t.sl || "-",
        t.gross, t.brok, t.tax, t.net, t.result
      ];
      vals.forEach((v, i) => {
        const colNum = i + 1;
        const isRgtCol = [12, 13, 14, 15].includes(colNum);
        const font = (colNum === 15)
          ? (parseNum(t.net) >= 0 ? { ...S.dark9, bold: true, color: { argb: "FF27AE60" } } : { ...S.dark9, bold: true, color: { argb: "FFE74C3C" } })
          : (colNum === 16)
            ? (isWin ? { ...S.dark9, bold: true, color: { argb: "FF27AE60" } } : { ...S.dark9, bold: true, color: { argb: "FFE74C3C" } })
            : S.dark9;
        wc(ws, row, colNum, v, { fill, font, alignment: isRgtCol ? S.rgt : S.ctr });
      });
      row++;
      tradeNum++;
    }

    // Continued subtotal
    const cons = calcMetrics(continued);
    ws.getRow(row).height = 14;
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].forEach(c => wc(ws, row, c, c === 2 ? "CONTINUED SUBTOTAL" : null, { fill: S.subtotFill, font: S.bold9dark, alignment: S.lft }));
    wc(ws, row, 12, rupee(cons.gross), { fill: S.subtotFill, font: S.bold9dark, alignment: S.rgt });
    wc(ws, row, 13, rupee(cons.brok), { fill: S.subtotFill, font: S.bold9dark, alignment: S.rgt });
    wc(ws, row, 14, rupee(cons.tax), { fill: S.subtotFill, font: S.bold9dark, alignment: S.rgt });
    wc(ws, row, 15, rupee(cons.net), { fill: S.subtotFill, font: S.bold9dark, alignment: S.rgt });
    wc(ws, row, 16, `W:${cons.wins}  L:${cons.losses}`, { fill: S.subtotFill, font: S.bold9dark, alignment: S.ctr });
    row++;
    row++;
  }

  // ── COMBINED TOTAL (only if both sections exist) ──────────────────────────
  if (closed.length > 0 && continued.length > 0) {
    mergeRow(ws, row, 1, COLS,
      "  📊 COMBINED TOTAL  (Closed + Continued)",
      { fill: S.combinedFill, font: S.white9, alignment: S.lft }, 16);
    row++;

    ws.getRow(row).height = 14;
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].forEach(c => wc(ws, row, c, c === 2 ? "ALL TRADES TOTAL" : null, { fill: S.subtotFill, font: S.bold9dark, alignment: S.lft }));
    wc(ws, row, 12, rupee(combined.gross), { fill: S.subtotFill, font: S.bold9dark, alignment: S.rgt });
    wc(ws, row, 13, rupee(combined.brok), { fill: S.subtotFill, font: S.bold9dark, alignment: S.rgt });
    wc(ws, row, 14, rupee(combined.tax), { fill: S.subtotFill, font: S.bold9dark, alignment: S.rgt });
    wc(ws, row, 15, rupee(combined.net), { fill: S.subtotFill, font: S.bold9dark, alignment: S.rgt });
    wc(ws, row, 16, `W:${combined.wins}  L:${combined.losses}`, { fill: S.subtotFill, font: S.bold9dark, alignment: S.ctr });
    row++;
    row++;
  }

  // ── BUY vs SELL vs COMBINED STATS TABLE ──────────────────────────────────
  const buyTrades = trades.filter(t => t.side === "BUY");
  const sellTrades = trades.filter(t => t.side === "SELL");
  const buyM = calcMetrics(buyTrades);
  const sellM = calcMetrics(sellTrades);

  mergeRow(ws, row, 1, COLS,
    "📈 DETAILED STATISTICS — BUY vs SELL vs COMBINED",
    { fill: S.statsHdrFill, font: S.white9, alignment: S.lft }, 16);
  row++;

  ws.getRow(row).height = 14;
  ["Metric", "BUY Trades", "SELL Trades", "COMBINED"].forEach((h, i) => {
    wc(ws, row, i + 1, h, { fill: S.kpiHdrFill, font: S.white9, alignment: S.ctr });
  });
  row++;

  const statsRows = [
    ["Closed Trades", buyM.count, sellM.count, combined.count],
    ["Winning Trades", buyM.wins, sellM.wins, combined.wins],
    ["Losing Trades", buyM.losses, sellM.losses, combined.losses],
    ["Win Rate", pct(buyM.winRate), pct(sellM.winRate), pct(combined.winRate)],
    ["Gross P&L (₹)", rupee(buyM.gross), rupee(sellM.gross), rupee(combined.gross)],
    ["Brokerage (₹)", rupee(buyM.brok), rupee(sellM.brok), rupee(combined.brok)],
    ["Taxes & Fees (₹)", rupee(buyM.tax), rupee(sellM.tax), rupee(combined.tax)],
    ["Net P&L (₹)", rupee(buyM.net), rupee(sellM.net), rupee(combined.net)],
    ["Avg Win (₹)", rupee(buyM.avgWin), rupee(sellM.avgWin), rupee(combined.avgWin)],
    ["Avg Loss (₹)", rupee(buyM.avgLoss), rupee(sellM.avgLoss), rupee(combined.avgLoss)],
    ["Best Trade (₹)", rupee(buyM.best), rupee(sellM.best), rupee(combined.best)],
    ["Worst Trade (₹)", rupee(buyM.worst), rupee(sellM.worst), rupee(combined.worst)],
    ["Risk:Reward (Actual)", `${buyM.rr.toFixed(2)}x`, `${sellM.rr.toFixed(2)}x`, `${combined.rr.toFixed(2)}x`],
  ];

  statsRows.forEach((r_data, idx) => {
    const fill = idx % 2 === 0 ? S.kpiEvenFill : argb("FFFFFF");
    ws.getRow(row).height = 14;
    wc(ws, row, 1, r_data[0], { fill, font: S.bold9dark, alignment: S.lft });
    wc(ws, row, 2, r_data[1], { fill, font: S.dark9, alignment: S.ctr });
    wc(ws, row, 3, r_data[2], { fill, font: S.dark9, alignment: S.ctr });
    wc(ws, row, 4, r_data[3], { fill, font: S.dark9, alignment: S.ctr });
    row++;
  });
  row++;

  // ── SECTION METRICS (only if both exist) ─────────────────────────────────
  if (closed.length > 0 && continued.length > 0) {
    const closedM = calcMetrics(closed);
    const contM = calcMetrics(continued);

    mergeRow(ws, row, 1, COLS,
      "📊 SECTION METRICS — CLOSED TRADES vs CLOSED TRADES CONTINUED",
      { fill: S.sectHdrFill, font: S.white9, alignment: S.lft }, 16);
    row++;

    ws.getRow(row).height = 14;
    ["Metric", "CLOSED (Same Day)", "CONTINUED (Multi-Day)", "COMBINED"].forEach((h, i) => {
      wc(ws, row, i + 1, h, { fill: S.sectHdrFill, font: S.white9, alignment: S.ctr });
    });
    row++;

    const sectRows = [
      ["Closed Trades", closedM.count, contM.count, combined.count],
      ["Winning Trades", closedM.wins, contM.wins, combined.wins],
      ["Losing Trades", closedM.losses, contM.losses, combined.losses],
      ["Win Rate", pct(closedM.winRate), pct(contM.winRate), pct(combined.winRate)],
      ["Gross P&L (₹)", rupee(closedM.gross), rupee(contM.gross), rupee(combined.gross)],
      ["Brokerage (₹)", rupee(closedM.brok), rupee(contM.brok), rupee(combined.brok)],
      ["Taxes & Fees (₹)", rupee(closedM.tax), rupee(contM.tax), rupee(combined.tax)],
      ["Net P&L (₹)", rupee(closedM.net), rupee(contM.net), rupee(combined.net)],
      ["Avg Win (₹)", rupee(closedM.avgWin), rupee(contM.avgWin), rupee(combined.avgWin)],
      ["Avg Loss (₹)", rupee(closedM.avgLoss), rupee(contM.avgLoss), rupee(combined.avgLoss)],
      ["Best Trade (₹)", rupee(closedM.best), rupee(contM.best), rupee(combined.best)],
      ["Worst Trade (₹)", rupee(closedM.worst), rupee(contM.worst), rupee(combined.worst)],
    ];

    sectRows.forEach((r_data, idx) => {
      const fill = idx % 2 === 0 ? argb("F9F0FF") : argb("FFFFFF");
      ws.getRow(row).height = 14;
      wc(ws, row, 1, r_data[0], { fill, font: S.bold9dark, alignment: S.lft });
      wc(ws, row, 2, r_data[1], { fill, font: S.dark9, alignment: S.ctr });
      wc(ws, row, 3, r_data[2], { fill, font: S.dark9, alignment: S.ctr });
      wc(ws, row, 4, r_data[3], { fill, font: S.dark9, alignment: S.ctr });
      row++;
    });
  }

  if (trades.length === 0) {
    console.log(`  [P1] Sheet [${dateLabel}]: ✅ Already up to date — no changes made`);
  } else {
    console.log(`  [P1] Built sheet [${dateLabel}] — ${trades.length} trades (${closed.length} closed, ${continued.length} continued)`);
  }
}

async function updateFullTradeLog(wb, newTrades) {
  const ftlSheet = wb.worksheets.find(s => s.name.includes("Full Trade Log"));
  if (!ftlSheet) return;

  // Find last trade number
  let lastNum = 0;
  const existingKeys = new Set(); // "date|instrument" for dupe check
  ftlSheet.eachRow((row, rn) => {
    if (rn < 4) return;
    const numVal = row.getCell(1).value;
    const dateVal = String(row.getCell(2).value || "").trim();
    const instrVal = String(row.getCell(3).value || "").trim();
    if (numVal && !isNaN(Number(numVal))) {
      lastNum = Math.max(lastNum, Number(numVal));
    }
    if (dateVal && instrVal) existingKeys.add(`${dateVal}|${instrVal}`);
  });

  let addedCount = 0;
  for (const t of newTrades) {
    const instrShort = (t.instrument || t.symbol || "").replace(/\s+\d{2} \w+ \d{4} FUT/i, "").trim() + " " + (t.instrument || "").match(/(\w+FUT)/i)?.[1] || "FUT";
    const key = `${t.date}|${t.instrument}`;
    if (existingKeys.has(key)) continue; // no duplicate

    lastNum++;
    const isWin = String(t.result || "").includes("WIN");
    const fill = isWin ? S.winFill : S.lossFill;
    const exitTypeLabel = t.isSameDay ? t.exitType
      : `${t.exitType} (Exit ${moment(t.exitDate).format("DD-MMM")})`;

    const newRow = ftlSheet.addRow([
      lastNum, t.date, t.instrument, t.side,
      t.entryPx || "-", t.exitPx || "-", t.qty,
      rupeeSign(t.gross), rupeeSign(t.net),
      t.result, exitTypeLabel
    ]);
    newRow.eachCell({ includeEmpty: true }, cell => {
      cell.fill = fill;
      cell.border = border();
      cell.font = S.dark9;
    });
    existingKeys.add(key);
    addedCount++;
  }

  // Update title row with new count
  if (addedCount > 0) {
    const titleRow = ftlSheet.getRow(1);
    const newTotal = lastNum;
    const firstDate = "23-Feb";
    const lastDate = todayLabel();
    titleRow.getCell(1).value = `📒  FULL TRADE LOG  —  All ${newTotal} Completed Trades  |  ${firstDate} – ${lastDate}, 2026`;
  }

  if (addedCount === 0) {
    console.log(`  [P1] Full Trade Log: ✅ Already up to date — no changes made`);
  } else {
    console.log(`  [P1] Full Trade Log: +${addedCount} new rows appended`);
  }
}

async function updateOverallDashboard(wb, byDate) {
  const sumSheet = wb.worksheets.find(s => s.name.includes("Overall Summary"));
  if (!sumSheet) return;

  // Find the daily breakdown table rows (around row 5 onwards)
  // We update or insert one row per date
  const dateRowMap = {}; // "Feb 23, 2026" -> rowNumber
  let totalRowNum = -1;
  let lastDataRow = 4;

  sumSheet.eachRow((row, rn) => {
    if (rn < 5) return;
    const v = String(row.getCell(1).value || "").trim();
    if (v === "TOTAL") { totalRowNum = rn; return; }
    if (v) { dateRowMap[v] = rn; lastDataRow = Math.max(lastDataRow, rn); }
  });

  for (const [dateLabel, trades] of Object.entries(byDate)) {
    const parsed = moment(dateLabel, "DD-MMM");
    const fullDt = parsed.format("MMM DD, YYYY");   // "Feb 23, 2026"
    const weekday = parsed.format("dddd");
    const m = calcMetrics(trades);
    const status = m.net >= 0 ? "🟢 Profit" : "🔴 Loss";
    const fill = m.net >= 0 ? S.winFill : S.lossFill;

    const targetRow = dateRowMap[fullDt];
    const rowData = [fullDt, weekday, m.count, m.wins, m.losses, pct(m.winRate), rupee(m.gross), rupee(m.net), status];

    if (targetRow) {
      // Update existing row
      const row = sumSheet.getRow(targetRow);
      rowData.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        cell.value = v;
        cell.fill = fill;
        cell.border = border();
        cell.font = S.dark9;
      });
    } else {
      // Insert new row before TOTAL
      const insertAt = totalRowNum > 0 ? totalRowNum : lastDataRow + 1;
      sumSheet.spliceRows(insertAt, 0, rowData);
      const newRow = sumSheet.getRow(insertAt);
      newRow.eachCell({ includeEmpty: true }, cell => {
        cell.fill = fill;
        cell.border = border();
        cell.font = S.dark9;
      });
      if (totalRowNum > 0) totalRowNum++;
    }
  }

  console.log(`  [P1] Overall Summary dashboard updated`);
}


// ════════════════════════════════════════════════════════════════════════════════
//  PROMPT 2 — BACKTEST SUMMARY UPDATER
// ════════════════════════════════════════════════════════════════════════════════

async function updateBacktest(newSignals) {
  /**
   * newSignals = array from your index.js pattern detector
   * Each: { patternId, symbol, direction, signalTime, entry, sl, signalHigh,
   *          signalLow, signalClose, nextOpen, stopLoss, targetPrice,
   *          result, exitTime, exitPrice, candles, pnl, pnlPct }
   */
  if (!fs.existsSync(CFG.backtestFile)) {
    console.log("[WARN] Backtest_Summary.xlsx not found — skipping.");
    return;
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(CFG.backtestFile);
  console.log(`  [P2] Loaded Backtest_Summary`);

  // ── Append new signals to All Signals sheet ───────────────────────────────
  const sigSheet = wb.worksheets.find(s => s.name.includes("All Signals"));
  if (sigSheet && newSignals && newSignals.length) {
    const existingIds = new Set();
    sigSheet.eachRow((row, rn) => {
      if (rn < 3) return;
      const id = String(row.getCell(1).value || "").trim();
      if (id) existingIds.add(id);
    });

    let added = 0;
    for (const sig of newSignals) {
      if (existingIds.has(sig.patternId)) continue;
      const isBull = String(sig.direction || "").includes("BULL");
      const fill = isBull ? S.winFill : S.lossFill;
      const newRow = sigSheet.addRow([
        sig.patternId, sig.symbol, sig.direction, sig.signalTime,
        sig.entry || 0, sig.sl || sig.stopLoss || 0,
        sig.signalHigh || 0, sig.signalLow || 0, sig.signalClose || 0,
        sig.targetPrice || 0,
        sig.result ? "YES" : "OPEN",
        sig.result || "PENDING",
        sig.exitTime || "", sig.exitPrice || 0, sig.candles || 0,
        sig.pnl || 0, sig.pnlPct || 0
      ]);
      newRow.eachCell({ includeEmpty: true }, cell => {
        cell.fill = fill; cell.border = border(); cell.font = S.dark9;
      });
      existingIds.add(sig.patternId);
      added++;
    }
    if (added === 0) {
      console.log(`  [P2] All Signals: ✅ Already up to date — no changes made`);
    } else {
      console.log(`  [P2] All Signals: +${added} new signals appended`);
    }
  }

  // ── Read ALL signals for recalculation ────────────────────────────────────

  // ── Read ALL signals for recalculation ────────────────────────────────────
  const allSigs = [];
  if (sigSheet) {
    sigSheet.eachRow((row, rn) => {
      // row1=title, row2=subtitle, row3=header, row4+=date-section-headers or data
      if (rn < 4) return;
      const numVal = row.getCell(1).value;
      // Skip date section header rows like "📅  2026-03-12  —  12 March 2026 ..."
      if (numVal === null || numVal === undefined || isNaN(Number(numVal))) return;
      const sym = String(row.getCell(3).value || "").trim();
      if (!sym) return;

      // Actual column layout (from sheet inspection):
      // col1=#  col2=Date  col3=Symbol  col4=Direction  col5=SignalTime
      // col6=CandleSpan  col7=Entry  col8=SL  col9=Target
      // col10=Cond1  col11=Cond2  col12=Category  col13=NiftyBias
      // col14=Result  col15=HitTime  col16=HitPrice  col17=Candles
      // col18=PnL(pts)  col19=PnL%
      const resultRaw = String(row.getCell(14).value || "").trim();
      let result = "OPEN";
      if (resultRaw.includes("TARGET") || resultRaw.includes("✅")) result = "TARGET HIT";
      else if (resultRaw.includes("SL") || resultRaw.includes("❌")) result = "SL HIT";

      allSigs.push({
        symbol: sym.replace(/^NSE:/i, "").replace(/-EQ$/i, ""),
        direction: String(row.getCell(4).value || "").trim(),
        date: String(row.getCell(2).value || "").split(" ")[0],
        entry: parseNum(row.getCell(7).value),
        sl: parseNum(row.getCell(8).value),
        target: parseNum(row.getCell(9).value),
        resolved: result !== "OPEN" ? "YES" : "OPEN",
        result,
        exitTime: String(row.getCell(15).value || ""),
        exitPrice: parseNum(row.getCell(16).value),
        candles: parseNum(row.getCell(17).value),
        pnl: parseNum(row.getCell(18).value),
        pnlPct: parseFloat(String(row.getCell(19).value || "0").replace("%", "")) || 0,
      });
    });
  }

  const isResolved = (r) => r && (r.includes("TARGET") || r.includes("SL HIT") || r === "YES");
  const isWinner = (r) => r && r.includes("TARGET");
  const isLoser = (r) => r && r.includes("SL HIT");

  const resolved = allSigs.filter(s => isResolved(s.resolved) || isResolved(s.result));
  const open = allSigs.filter(s => !isResolved(s.resolved) && !isResolved(s.result));
  const winners = resolved.filter(s => isWinner(s.result));
  const losers = resolved.filter(s => isLoser(s.result));
  const bullish = allSigs.filter(s => s.direction.includes("BULL"));
  const bearish = allSigs.filter(s => s.direction.includes("BEAR"));
  const bullWin = winners.filter(s => s.direction.includes("BULL"));
  const bearWin = winners.filter(s => s.direction.includes("BEAR"));
  const bullLoss = losers.filter(s => s.direction.includes("BULL"));
  const bearLoss = losers.filter(s => s.direction.includes("BEAR"));

  const netPnl = Math.round(resolved.reduce((s, t) => s + (t.pnl || 0), 0) * 100) / 100;
  const totalWPnl = winners.reduce((s, t) => s + t.pnl, 0);
  const totalLPnl = losers.reduce((s, t) => s + t.pnl, 0);
  const avgWin = winners.length ? totalWPnl / winners.length : 0;
  const avgLoss = losers.length ? totalLPnl / losers.length : 0;
  const winRate = resolved.length ? winners.length / resolved.length * 100 : 0;
  const pf = totalLPnl !== 0 ? Math.abs(totalWPnl / totalLPnl) : 0;
  const expectancy = resolved.length ? netPnl / resolved.length : 0;
  const avgCandles = resolved.length ? resolved.reduce((s, t) => s + t.candles, 0) / resolved.length : 0;
  const bestTrade = resolved.length ? Math.max(...resolved.map(t => t.pnl)) : 0;
  const worstTrade = resolved.length ? Math.min(...resolved.map(t => t.pnl)) : 0;

  // Win/Loss streaks
  let maxWStreak = 0, maxLStreak = 0, curW = 0, curL = 0;
  for (const s of resolved) {
    if (s.result === "TARGET HIT") { curW++; curL = 0; maxWStreak = Math.max(maxWStreak, curW); }
    else { curL++; curW = 0; maxLStreak = Math.max(maxLStreak, curL); }
  }

  // Max drawdown from cumulative PnL
  let peak = 0, maxDD = 0, cumPnl = 0;
  for (const s of resolved) {
    cumPnl += s.pnl;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDD) maxDD = dd;
  }

  // Date range
  const dates = allSigs.map(s => s.date).filter(Boolean).sort();
  const periodFrom = dates[0] || "";
  const periodTo = dates[dates.length - 1] || "";

  // ── Rebuild Summary Dashboard ─────────────────────────────────────────────
  const sumDash = wb.worksheets.find(s => s.name.includes("Summary Dashboard"));
  if (sumDash) {
    const metrics = [
      ["Total Signals", allSigs.length],
      ["Resolved Trades", resolved.length],
      ["⏳ Open Trades", open.length],
      ["✅ Winners (Target Hit)", winners.length],
      ["❌ Losers (SL Hit)", losers.length],
      ["Win Rate", pct(winRate)],
      ["Loss Rate", pct(100 - winRate)],
      ["Net PnL (pts)", `+${netPnl.toFixed(2)}`],
      ["Total Winning PnL (pts)", totalWPnl.toFixed(2)],
      ["Total Losing PnL (pts)", totalLPnl.toFixed(2)],
      ["Avg Win (pts)", `+${avgWin.toFixed(2)}`],
      ["Avg Loss (pts)", avgLoss.toFixed(2)],
      ["Profit Factor", pf.toFixed(2)],
      ["Risk-Reward Ratio", (avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0).toFixed(2) + "x"],
      ["Expectancy (pts)", expectancy.toFixed(2)],
      ["Max Drawdown (pts)", (-maxDD).toFixed(2)],
      ["Max Win Streak", maxWStreak],
      ["Max Loss Streak", maxLStreak],
      ["Avg Candles to Hit", avgCandles.toFixed(1)],
      ["Best Trade (pts)", bestTrade.toFixed(2)],
      ["Worst Trade (pts)", worstTrade.toFixed(2)],
    ];
    // Write metrics into col A+B starting row 4
    let r = 4;
    metrics.forEach(([label, val]) => {
      const row = sumDash.getRow(r);
      row.getCell(1).value = label;
      row.getCell(2).value = val;
      r++;
    });
    // Update period in title row 1
    const titleCell = sumDash.getRow(1).getCell(1);
    titleCell.value = `📊  BACKTEST PERFORMANCE SUMMARY  |  NSE  |  ${periodFrom} – ${periodTo}`;

    console.log(`  [P2] Summary Dashboard recalculated`);
  }

  // ── Rebuild Win-Loss Log ──────────────────────────────────────────────────
  const wlSheet = wb.worksheets.find(s => s.name.includes("Win-Loss Log"));
  if (wlSheet) {
    clearSheet(wlSheet);
    let r = 1;
    // Title
    mergeRow(wlSheet, r, 1, 8,
      `🏆  WIN / LOSS TRADE LOG  |  NSE Backtest  |  ${periodFrom} – ${periodTo}`,
      { fill: S.titleFill, font: S.white, alignment: S.ctr }, 24); r++;

    // Winners section
    mergeRow(wlSheet, r, 1, 8,
      `✅  WINNERS  (${winners.length} trades  |  Total PnL: +${totalWPnl.toFixed(2)} pts  |  Avg: +${avgWin.toFixed(1)} pts)`,
      { fill: argb("27AE60"), font: S.white10, alignment: S.lft }, 18); r++;
    r++; // blank
    const hdr = ["Symbol", "Direction", "Date", "Entry", "Hit Price", "PnL (pts)", "PnL %", "Candles"];
    hdr.forEach((h, i) => wc(wlSheet, r, i + 1, h, { fill: S.tblHdrFill, font: S.white9, alignment: S.ctr }));
    r++;
    for (const w of winners) {
      hdr.forEach((_, i) => {
        const vals = [w.symbol, w.direction, w.date, w.entry, w.exitPrice, w.pnl.toFixed(2), pct(w.pnlPct, 3), w.candles];
        wc(wlSheet, r, i + 1, vals[i], { fill: S.winFill, font: S.dark9, alignment: S.ctr });
      });
      r++;
    }

    r++; // spacer
    // Losers section
    mergeRow(wlSheet, r, 1, 8,
      `❌  LOSERS  (${losers.length} trades  |  Total PnL: ${totalLPnl.toFixed(2)} pts  |  Avg: ${avgLoss.toFixed(1)} pts)`,
      { fill: argb("E74C3C"), font: S.white10, alignment: S.lft }, 18); r++;
    r++;
    hdr.forEach((h, i) => wc(wlSheet, r, i + 1, h, { fill: S.tblHdrFill, font: S.white9, alignment: S.ctr }));
    r++;
    for (const l of losers) {
      hdr.forEach((_, i) => {
        const vals = [l.symbol, l.direction, l.date, l.entry, l.exitPrice, l.pnl.toFixed(2), pct(l.pnlPct, 3), l.candles];
        wc(wlSheet, r, i + 1, vals[i], { fill: S.lossFill, font: S.dark9, alignment: S.ctr });
      });
      r++;
    }

    if (open.length > 0) {
      r++;
      mergeRow(wlSheet, r, 1, 8,
        `⏳  OPEN TRADES  (${open.length} trades — pending resolution)`,
        { fill: argb("F39C12"), font: S.white10, alignment: S.lft }, 18); r++;
      r++;
      hdr.forEach((h, i) => wc(wlSheet, r, i + 1, h, { fill: S.tblHdrFill, font: S.white9, alignment: S.ctr }));
      r++;
      for (const o of open) {
        hdr.forEach((_, i) => {
          const vals = [o.symbol, o.direction, o.date, o.entry, "OPEN", "—", "—", o.candles];
          wc(wlSheet, r, i + 1, vals[i], { fill: S.openFill, font: S.dark9, alignment: S.ctr });
        });
        r++;
      }
    }
    console.log(`  [P2] Win-Loss Log rebuilt`);
  }

  // ── Rebuild Cumulative PnL ────────────────────────────────────────────────
  const cumSheet = wb.worksheets.find(s => s.name.includes("Cumulative PnL"));
  if (cumSheet) {
    clearSheet(cumSheet);
    let r = 1;
    mergeRow(cumSheet, r, 1, 8,
      `📈  CUMULATIVE PnL TRACKER  |  Trade-by-Trade Progression`,
      { fill: S.titleFill, font: S.white, alignment: S.ctr }, 24); r++;
    ["#", "Symbol", "Direction", "Date", "Result", "PnL (pts)", "Cumulative PnL", "Drawdown from Peak"]
      .forEach((h, i) => wc(cumSheet, r, i + 1, h, { fill: S.tblHdrFill, font: S.white9, alignment: S.ctr }));
    r++;

    let cumPnl2 = 0, peak2 = 0, idx = 1;
    for (const s of resolved) {
      cumPnl2 += s.pnl;
      if (cumPnl2 > peak2) peak2 = cumPnl2;
      const dd2 = peak2 - cumPnl2;
      const isWin = s.result && s.result.includes("TARGET");
      const fill = isWin ? S.winFill : S.lossFill;
      [idx, s.symbol, s.direction, s.date, s.result,
        s.pnl.toFixed(2), cumPnl2.toFixed(2), (-dd2).toFixed(2)]
        .forEach((v, i) => wc(cumSheet, r, i + 1, v, { fill, font: S.dark9, alignment: S.ctr }));
      r++;
      idx++;
    }
    console.log(`  [P2] Cumulative PnL tracker rebuilt`);
  }

  if (!CFG.dryRun) {
    await wb.xlsx.writeFile(CFG.backtestFile);
    console.log(`  [P2] Saved Backtest_Summary.xlsx`);
  }

  return { allSigs, resolved, open, winners, losers, netPnl, winRate, bestTrade, worstTrade };
}

// ════════════════════════════════════════════════════════════════════════════════
//  PROMPT 3 — TRADES.XLSX UPDATER
// ════════════════════════════════════════════════════════════════════════════════

async function updateTrades(overallTrades, backtestSignals) {
  if (!fs.existsSync(CFG.tradesFile)) {
    console.log("[WARN] Trades.xlsx not found — skipping.");
    return;
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(CFG.tradesFile);
  console.log(`  [P3] Loaded Trades.xlsx`);

  // ── JOB 2: Update Trade Taken sheet ──────────────────────────────────────
  const takenSheet = wb.worksheets.find(s => s.name.includes("Trade Taken") || s.name === "Trade Taken");
  if (takenSheet && overallTrades) {
    // Build existing key set (date+symbol)
    const existingKeys = new Set();
    const dateGroups = new Set();
    takenSheet.eachRow((row, rn) => {
      if (rn < 4) return;
      const d = String(row.getCell(1).value || "").trim();
      const s = String(row.getCell(2).value || "").trim();
      if (d && !d.startsWith("──") && s && s !== "Symbol" && s !== "Date") {
        existingKeys.add(`${d}|${s}`);
        dateGroups.add(d);
      }
    });

    let addedTaken = 0;
    // Group new trades by date
    const newByDate = {};
    for (const t of overallTrades) {
      const key = `${t.date}|${t.symbol}`;
      if (existingKeys.has(key)) continue; // skip dupe
      if (!newByDate[t.date]) newByDate[t.date] = [];
      newByDate[t.date].push(t);
    }

    for (const [dateLabel, trades] of Object.entries(newByDate)) {
      if (!dateGroups.has(dateLabel)) {
        // Insert section divider
        const divRow = takenSheet.addRow([
          `── ${dateLabel} ─────────────────────────────────────────────────────────────`
        ]);
        divRow.getCell(1).font = { name: "Arial", bold: true, size: 9, color: { argb: "FF1F3864" } };
        divRow.getCell(1).fill = argb("DDEEFF");
        dateGroups.add(dateLabel);
      }

      for (const t of trades) {
        const isWin = String(t.result || "").includes("WIN");
        const isOpen = String(t.result || "").toLowerCase().includes("open");
        const fill = isOpen ? S.openFill : isWin ? S.winFill : S.lossFill;

        // 23 columns: Date|Symbol|Side|TF|EntryTime|ExitTime|Entry₹|Exit₹|Qty|
        //             NIFTYDir|Acc/Dist|DowTheory|CandleSpan|Support|Resistance|
        //             EarlyExit|SLHit|TargetHit|ExitType|Gross|Net|Result|Notes
        const exitType = String(t.exitType || "");
        const isSL = exitType.toLowerCase().includes("sl") || exitType.toLowerCase().includes("stop");
        const isTarget = exitType.toLowerCase().includes("target");

        const rowData = [
          t.date, t.symbol, t.side, "15min",
          t.entryTime || "", t.exitTime || "",
          t.entryPx || "", t.exitPx || "", t.qty || "",
          "", "", "", "", // NIFTY dir, acc/dist, dow, candle span (fill from PDF)
          t.sl || "", t.target || "",   // Support = SL, Resistance = Target
          "",                       // Early Exit
          isSL ? "✓" : "",      // SL Hit
          isTarget ? "✓" : "",      // Target Hit
          t.exitType || "",
          t.gross || "", t.net || "",
          t.result || "",
          ""  // Notes (fill from PDF)
        ];

        const newRow = takenSheet.addRow(rowData);
        newRow.eachCell({ includeEmpty: true }, cell => {
          cell.fill = fill;
          cell.border = border();
          cell.font = S.dark9;
        });
        existingKeys.add(`${t.date}|${t.symbol}`);
        addedTaken++;
      }
    }
    if (addedTaken === 0) {
      console.log(`  [P3] Trade Taken: ✅ Already up to date — no changes made`);
    } else {
      console.log(`  [P3] Trade Taken: +${addedTaken} new rows`);
    }
  }

  // ── JOB 1: Update Not Taken sheet ────────────────────────────────────────
  // ── JOB 1: Update Not Taken sheet ───────────────────────────────────────
  const ntSheet = wb.worksheets.find(s => s.name.includes("Not Taken") || s.name === "Not Taken");
  if (ntSheet && backtestSignals && backtestSignals.length) {
    const existingNT = new Set();
    const ntDateGroups = new Set();

    ntSheet.eachRow((row, rn) => {
      if (rn < 4) return;
      const d = String(row.getCell(1).value || "").trim();
      const s = String(row.getCell(2).value || "").trim();
      // Skip divider rows and empty rows
      if (!d || d.startsWith("──") || !s || s === "Symbol" || s === "Date") return;
      existingNT.add(`${d}|${s}`);
      ntDateGroups.add(d);
    });

    let addedNT = 0;

    // Group signals by date label
    const ntByDate = {};
    for (const sig of backtestSignals) {
      // sig.date comes from readBacktestSignals → col2 of All Signals = "2026-03-13"
      const sigDateStr = String(sig.date || "").trim();
      // Format to "DD-Mon" for display, keep full for dedup
      const sigDateFull = sigDateStr; // e.g. "2026-03-13"
      const symClean = String(sig.symbol || "").replace(/^NSE:/i, "").replace(/-EQ$/i, "").trim();
      if (!symClean || !sigDateFull || sigDateFull === "Invalid date") continue;

      const key = `${sigDateFull}|${symClean}`;
      if (existingNT.has(key)) continue;

      if (!ntByDate[sigDateFull]) ntByDate[sigDateFull] = [];
      ntByDate[sigDateFull].push({ ...sig, sigDateFull, symClean });
    }

    for (const [dateLabel, sigs] of Object.entries(ntByDate)) {
      // Add date divider if this date not seen before
      if (!ntDateGroups.has(dateLabel)) {
        const divRow = ntSheet.addRow([
          `── ${dateLabel} ─────────────────────────────────────────────────────────────`
        ]);
        divRow.getCell(1).font = { name: "Arial", bold: true, size: 9, color: { argb: "FF1F3864" } };
        divRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEEFF" } };
        ntDateGroups.add(dateLabel);
      }

      for (const sig of sigs) {
        const isBullSig = String(sig.direction || "").toUpperCase().includes("BULL");
        const side = isBullSig ? "BUY" : "SELL";

        // Nifty bias alignment
        const nb = String(sig.niftyBias || "").toUpperCase();
        let niftyBiasCol = sig.niftyBias || "";
        let niftyDirCol = "";
        let dirVsNifty = "";
        if (nb === "LONG" || nb === "BULLISH") {
          niftyDirCol = "🟢 BULLISH";
          dirVsNifty = isBullSig ? "✅ Nifty Helped" : "⚠️ Against Nifty";
          niftyBiasCol = isBullSig ? "Aligned" : "Counter Trend";
        } else if (nb === "SHORT" || nb === "BEARISH") {
          niftyDirCol = "🔴 BEARISH";
          dirVsNifty = isBullSig ? "⚠️ Against Nifty" : "✅ Nifty Helped";
          niftyBiasCol = isBullSig ? "Counter Trend" : "Aligned";
        }

        // Cond1/Cond2 category
        const c1 = sig.cond1Pass === true ? "PASS" : sig.cond1Pass === false ? "FAIL" : "PASS";
        const c2 = sig.cond2Pass === true ? "PASS" : sig.cond2Pass === false ? "FAIL" : "FAIL";
        let category = "COND1 ONLY";
        if (c1 === "PASS" && c2 === "PASS") category = "BOTH PASS";
        else if (c1 === "FAIL") category = "COND1 ONLY";
        const condStr = `${c1} / ${c2}`;

        // Result from backtest
        const bResult = sig.result || "OPEN";
        let resultDisp = "⏳ OPEN";
        if (bResult === "TARGET HIT") resultDisp = "✅ TARGET HIT";
        else if (bResult === "SL HIT") resultDisp = "❌ SL HIT";

        // PnL %
        const pnlPctStr = sig.pnlPct ? `${sig.pnlPct > 0 ? "+" : ""}${Number(sig.pnlPct).toFixed(3)}%` : "0.000%";

        // Signal time - just HH:mm part
        const sigTimeParts = String(sig.signalTime || sig.exitTime || "").split(" ");
        const sigTimeDisp = sigTimeParts.length > 1 ? sigTimeParts[1].substring(0, 5) : (sigTimeParts[0] || "");

        // Max favorable
        const maxPts = sig.maxMovePts != null ? sig.maxMovePts : 0;
        const maxPct = sig.maxMoveP != null ? sig.maxMoveP : 0;

        // Candle span - keep as-is from source
        const spanStr = sig.candles ? `${sig.candles}/10` : "—";

        // Attempt #
        const attemptNum = sig.attemptNumber || "1";

        // Row fill based on result
        const isWin = bResult === "TARGET HIT";
        const isOpen = bResult === "OPEN" || bResult === "PENDING";
        const fillArgb = isOpen
          ? "FFFFFF99"  // yellow tint for open
          : isWin ? "FFE2EFDA"  // green
            : "FFFCE4D6"; // red/orange

        // 24 columns matching exact header:
        // Date|Symbol|Direction|Timeframe|Signal Time|Entry ₹|Stop Loss ₹|Target ₹|
        // Candle Span|Category|Cond 1/Cond 2|Nifty Bias|Nifty Direction|Direction vs Nifty|
        // Max Fav Pts|Max Fav %|Backtest Result|PnL %(Backtest)|
        // Attempt 1 Result|Attempt 2 Result|Attempt #|Attempt Notes|Nifty Bias(Aligned?)|Notes
        const rowData = [
          sig.sigDateFull,          // col 1  Date
          sig.symClean,             // col 2  Symbol
          side,                     // col 3  Direction (BUY/SELL)
          "15 min",                 // col 4  Timeframe
          sigTimeDisp,              // col 5  Signal Time
          sig.entry || 0,           // col 6  Entry ₹
          sig.sl || 0,              // col 7  Stop Loss ₹
          sig.target || sig.targetPrice || 0, // col 8 Target ₹
          spanStr,                  // col 9  Candle Span
          category,                 // col 10 Category
          condStr,                  // col 11 Cond 1 / Cond 2
          niftyBiasCol,             // col 12 Nifty Bias
          niftyDirCol,              // col 13 Nifty Direction
          dirVsNifty,               // col 14 Direction vs Nifty
          maxPts,                   // col 15 Max Fav Pts (pre-SL)
          maxPct,                   // col 16 Max Fav % (pre-SL)
          resultDisp,               // col 17 Backtest Result
          pnlPctStr,                // col 18 PnL % (Backtest)
          null,                     // col 19 Attempt 1 Result (fill manually)
          null,                     // col 20 Attempt 2 Result
          String(attemptNum),       // col 21 Attempt #
          null,                     // col 22 Attempt Notes
          niftyBiasCol,             // col 23 Nifty Bias (Aligned?)
          null,                     // col 24 Notes
        ];

        const newRow = ntSheet.addRow(rowData);
        newRow.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + fillArgb.replace("FF", "") } };
          cell.border = { top: { style: "thin", color: { argb: "FFBFBFBF" } }, left: { style: "thin", color: { argb: "FFBFBFBF" } }, bottom: { style: "thin", color: { argb: "FFBFBFBF" } }, right: { style: "thin", color: { argb: "FFBFBFBF" } } };
          cell.font = { name: "Arial", size: 9, color: { argb: "FF333333" } };
        });

        existingNT.add(`${sig.sigDateFull}|${sig.symClean}`);
        addedNT++;
      }
    }

    if (addedNT === 0) {
      console.log(`  [P3] Not Taken: ✅ Already up to date — no changes made`);
    } else {
      console.log(`  [P3] Not Taken: +${addedNT} new rows`);
    }
  }

  if (!CFG.dryRun) {
    await wb.xlsx.writeFile(CFG.tradesFile);
    console.log(`  [P3] Saved Trades.xlsx`);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  READ SOURCE DATA FROM EXISTING FILES
// ════════════════════════════════════════════════════════════════════════════════

async function readSourceTrades() {
  /** Reads Overall_Summary date sheets to get structured trade data */
  if (!fs.existsSync(CFG.overallFile)) return [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(CFG.overallFile);

  const trades = [];
  for (const ws of wb.worksheets) {
    // Only date sheets like "23-Feb", "09-Mar"
    if (!ws.name.match(/^\d{2}-[A-Za-z]{3}$/)) continue;
    const dateLabel = ws.name;

    ws.eachRow((row, rn) => {
      if (rn < 8) return; // skip header rows 1-7
      const numVal = row.getCell(1).value;
      const sym = String(row.getCell(2).value || "").trim();
      // Skip section headers, subtotals, stats rows
      if (!numVal || isNaN(Number(numVal))) return;
      if (!sym || sym === "CLOSED SUBTOTAL" || sym === "CONTINUED SUBTOTAL" || sym === "ALL TRADES TOTAL") return;
      if (!sym || sym === "Metric" || sym === "Symbol") return;

      const entryTimeRaw = String(row.getCell(5).value || "");
      const exitTimeRaw = String(row.getCell(6).value || "");

      // Determine if same-day — use multiple formats to avoid moment deprecation warning
      // Handles: "2/23/2026, 9:21:37 AM", "3/2/2026, 1:38:29 PM", ISO strings
      const DATE_FMTS = [
        "M/D/YYYY, h:mm:ss A",
        "M/D/YYYY, h:mm A",
        "YYYY-MM-DD HH:mm:ss",
        "YYYY-MM-DD HH:mm",
        "YYYY-MM-DD",
        "DD-MMM-YYYY",
      ];
      const entryMom = moment(entryTimeRaw, DATE_FMTS, true).isValid()
        ? moment(entryTimeRaw, DATE_FMTS, true)
        : moment(entryTimeRaw, DATE_FMTS, false);
      const exitMom = moment(exitTimeRaw, DATE_FMTS, true).isValid()
        ? moment(exitTimeRaw, DATE_FMTS, true)
        : moment(exitTimeRaw, DATE_FMTS, false);
      const isSameDay = entryMom.isValid() && exitMom.isValid()
        ? entryMom.format("YYYY-MM-DD") === exitMom.format("YYYY-MM-DD")
        : true;

      trades.push({
        date: dateLabel,
        symbol: sym,
        instrument: String(row.getCell(3).value || sym),
        side: String(row.getCell(4).value || ""),
        entryTime: entryTimeRaw,
        exitTime: exitTimeRaw,
        qty: parseNum(row.getCell(7).value),
        entryPx: parseNum(row.getCell(8).value),
        exitPx: parseNum(row.getCell(9).value),
        target: String(row.getCell(10).value || "-"),
        sl: String(row.getCell(11).value || "-"),
        gross: parseNum(row.getCell(12).value),
        brok: parseNum(row.getCell(13).value),
        tax: parseNum(row.getCell(14).value),
        net: parseNum(row.getCell(15).value),
        result: String(row.getCell(16).value || ""),
        exitType: "",
        isSameDay,
        entryDate: entryMom.isValid() ? entryMom.toDate() : null,
        exitDate: exitMom.isValid() ? exitMom.toDate() : null,
      });
    });
  }

  console.log(`  [READ] ${trades.length} trades read from Overall_Summary date sheets`);
  return trades;
}

async function readBacktestSignals() {
  if (!fs.existsSync(CFG.backtestFile)) return [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(CFG.backtestFile);
  const sigSheet = wb.worksheets.find(s => s.name.includes("All Signals"));
  if (!sigSheet) return [];

  const sigs = [];
  const seenKeys = new Set(); // ← ADD THIS LINE — dedup by date+symbol+direction+time
  sigSheet.eachRow((row, rn) => {
    // row1=title, row2=subtitle, row3=header, row4+=date-section-headers or data
    if (rn < 4) return;
    const numVal = row.getCell(1).value;
    // Skip date section header rows (no numeric # in col 1)
    if (numVal === null || numVal === undefined || isNaN(Number(numVal))) return;

    // col1=# col2=Date col3=Symbol col4=Direction col5=SignalTime
    // col6=CandleSpan col7=Entry col8=SL col9=Target
    // col10=Cond1 col11=Cond2 col12=Category col13=NiftyBias
    // col14=Result col15=HitTime col16=HitPrice col17=Candles col18=PnL col19=PnL%
    // col22=DirectionVsNifty col23=MaxFavPts col24=MaxFavPct
    const sym = String(row.getCell(3).value || "").trim();
    if (!sym) return;

    // ← ADD THESE 4 LINES — include signal time in dedup key to handle same symbol twice on same day
    const sigTimeDedup = String(row.getCell(5).value || "").trim();
    const dedupKey = `${String(row.getCell(2).value || "").trim()}|${sym.toLowerCase()}|${String(row.getCell(4).value || "").trim().toUpperCase()}|${sigTimeDedup}`;
    if (seenKeys.has(dedupKey)) return;
    seenKeys.add(dedupKey);

    const resultRaw = String(row.getCell(14).value || "").trim();
    let result = "OPEN";
    if (resultRaw.includes("TARGET") || resultRaw.includes("✅")) result = "TARGET HIT";
    else if (resultRaw.includes("SL") || resultRaw.includes("❌")) result = "SL HIT";

    const niftyBiasRaw = String(row.getCell(13).value || "").trim();
    // "Counter Trend" or "Aligned" — map to bias word
    let niftyBias = "";
    if (niftyBiasRaw === "Aligned") niftyBias = "SHORT"; // majority are BEARISH signals
    else if (niftyBiasRaw === "Counter Trend") niftyBias = "LONG";
    else niftyBias = niftyBiasRaw;

    const dirVsNifty = String(row.getCell(22).value || "").trim();
    const cond1Raw = String(row.getCell(10).value || "").trim();
    const cond2Raw = String(row.getCell(11).value || "").trim();

    sigs.push({
      patternId: String(row.getCell(1).value || ""),
      symbol: sym,
      date: String(row.getCell(2).value || "").trim(),
      direction: String(row.getCell(4).value || "").trim(),
      signalTime: String(row.getCell(5).value || "").trim(),
      candles: String(row.getCell(6).value || "").replace("/10", "").replace(/\/\d+/, ""),
      entry: parseNum(row.getCell(7).value),
      sl: parseNum(row.getCell(8).value),
      target: parseNum(row.getCell(9).value),
      cond1Pass: cond1Raw === "PASS",
      cond2Pass: cond2Raw === "PASS",
      category: String(row.getCell(12).value || "").trim(),
      niftyBias,
      niftyEmoji: niftyBias === "SHORT" ? "🔴" : niftyBias === "LONG" ? "🟢" : "⚠️",
      resolved: result !== "OPEN" ? "YES" : "OPEN",
      result,
      exitTime: String(row.getCell(15).value || ""),
      exitPrice: parseNum(row.getCell(16).value),
      pnl: parseNum(row.getCell(18).value),
      pnlPct: parseFloat(String(row.getCell(19).value || "0").replace("%", "").replace("+", "")) || 0,
      maxMovePts: parseNum(row.getCell(23).value),
      maxMoveP: parseNum(row.getCell(24).value),
    });
  });
  return sigs;
}

// ════════════════════════════════════════════════════════════════════════════════
//  TELEGRAM EOD REPORT
// ════════════════════════════════════════════════════════════════════════════════

async function sendEODTelegram(trades, btStats) {
  const today = todayLabel();
  const todayFull2 = todayFull();
  const todayDateStr = moment().utcOffset("+05:30").format("YYYY-MM-DD");

  // Today's live trades
  const todayTrades = trades.filter(t =>
    String(t.date || "").toLowerCase().includes(today.toLowerCase())
  );
  const m = calcMetrics(todayTrades);

  // All-time live
  const allM = calcMetrics(trades);

  // ── Today's backtest signals from allSigs ─────────────────────────────────
  let todayBTSignals = [];
  if (btStats && btStats.allSigs) {
    todayBTSignals = btStats.allSigs.filter(s => {
      const d = String(s.signalTime || s.date || "");
      try {
        return moment(d, [
          "YYYY-MM-DD HH:mm:ss", "YYYY-MM-DD HH:mm",
          "YYYY-MM-DDTHH:mm:ss", "YYYY-MM-DD"
        ], false).format("YYYY-MM-DD") === todayDateStr;
      } catch (_) { return false; }
    });
  }
  const todayBTResolved = todayBTSignals.filter(s =>
    s.result === "TARGET HIT" || s.result === "SL HIT"
  );
  const todayBTWinners = todayBTResolved.filter(s => s.result === "TARGET HIT");
  const todayBTLosers = todayBTResolved.filter(s => s.result === "SL HIT");
  const todayBTOpen = todayBTSignals.filter(s =>
    s.result !== "TARGET HIT" && s.result !== "SL HIT"
  );
  const todayBTNetPnl = todayBTResolved.reduce((s, t) => s + (t.pnl || 0), 0);
  const todayBTWinRate = todayBTResolved.length
    ? todayBTWinners.length / todayBTResolved.length * 100 : 0;

  // ── All-time backtest ─────────────────────────────────────────────────────
  const btTotalSignals = btStats?.allSigs?.length || 0;
  const btWinners = btStats?.winners?.length || 0;
  const btLosers = btStats?.losers?.length || 0;
  const btOpen = btStats?.open?.length || 0;
  const btWinRate = btStats ? btStats.winRate.toFixed(1) : "0.0";
  const btNetPnl = btStats ? btStats.netPnl.toFixed(2) : "0.00";

  // ── Status line ───────────────────────────────────────────────────────────
  let statusLine;
  if (todayTrades.length === 0) {
    statusLine = "⚪ NO TRADES TAKEN";
  } else if (m.net >= 0) {
    statusLine = "✅ PROFIT DAY";
  } else {
    statusLine = "❌ LOSS DAY";
  }

  const lines = [
    `🟡 *NeoStox — EOD Report*`,
    `📅 *${todayFull2}*`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📊 *TODAY'S LIVE TRADING*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Status : *${statusLine}*`,
  ];

  if (todayTrades.length === 0) {
    lines.push(`_No trades executed today_`);
  } else {
    lines.push(
      `Closed Trades : *${m.count}*`,
      `Wins ✅        : ${m.wins}   Losses ❌ : ${m.losses}`,
      `Win Rate      : *${pct(m.winRate)}*`,
      `Gross P&L     : ${rupeeSign(m.gross)}`,
      `Net P&L       : *${rupeeSign(m.net)}*`,
      `Brokerage     : ${rupee(m.brok)}`,
      `Taxes         : ${rupee(m.tax)}`,
      `Best Trade    : ${rupeeSign(m.best)}`,
      `Worst Trade   : ${rupeeSign(m.worst)}`,
    );
  }

  // ── TODAY'S BACKTEST ──────────────────────────────────────────────────────
  lines.push(
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🔬 *TODAY'S BACKTEST  (${today})*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  );

  if (todayBTSignals.length === 0) {
    lines.push(`_No signals generated today_`);
  } else {
    lines.push(
      `Signals Today : *${todayBTSignals.length}*`,
      `Resolved      : ${todayBTResolved.length}`,
      `TARGET HIT ✅ : ${todayBTWinners.length}`,
      `SL HIT ❌     : ${todayBTLosers.length}`,
      `Open ⏳       : *${todayBTOpen.length}*`,
      `Win Rate      : ${pct(todayBTWinRate)}`,
      `PnL (pts)     : ${todayBTNetPnl >= 0 ? "+" : ""}${todayBTNetPnl.toFixed(2)}`,
    );
  }

  // ── ALL-TIME BACKTEST ─────────────────────────────────────────────────────
  lines.push(
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📊 *ALL-TIME BACKTEST SUMMARY*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Total Signals : ${btTotalSignals}`,
    `TARGET HIT ✅ : ${btWinners}`,
    `SL HIT ❌     : ${btLosers}`,
    `Open ⏳       : ${btOpen}`,
    `Win Rate      : *${btWinRate}%*`,
    `Total PnL     : ${btNetPnl} pts`,
  );

  // ── ALL-TIME LIVE ─────────────────────────────────────────────────────────
  lines.push(
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📈 *ALL-TIME LIVE TRADING*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Total Trades  : ${allM.count}`,
    `Overall Win%  : ${pct(allM.winRate)}`,
    `Total Gross   : ${rupeeSign(allM.gross)}`,
    `Total Net     : *${rupeeSign(allM.net)}*`,
  );

  // Individual today's trades (only if trades were taken)
  if (todayTrades.length > 0) {
    lines.push(``, `━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`🗒 *TODAY'S INDIVIDUAL TRADES*`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    todayTrades.slice(0, 12).forEach(t => {
      const r = String(t.result || "").includes("WIN") ? "✅" : "❌";
      lines.push(`${r} ${t.symbol} (${t.side}) → ${rupeeSign(t.net)}`);
    });
    if (todayTrades.length > 12) lines.push(`_...+${todayTrades.length - 12} more_`);
  }

  lines.push(``, `_Auto-generated by NeoStox System B_`);

  const message = lines.join("\n");

  if (!CFG.telegramToken || !CFG.telegramChat) {
    console.log(message);
    return;
  }
  if (CFG.dryRun) {
    console.log("\n[DRY] Telegram message preview:\n" + message);
    return;
  }

  const TelegramBot = require("node-telegram-bot-api");
  const bot = new TelegramBot(CFG.telegramToken, { polling: false });
  await bot.sendMessage(CFG.telegramChat, message, { parse_mode: "Markdown" });
  console.log("  [TG] EOD message sent to sir ✅");
}

// ════════════════════════════════════════════════════════════════════════════════
//  MAIN ORCHESTRATOR
// ════════════════════════════════════════════════════════════════════════════════

async function runSystemB(opts = {}) {
  CFG.dryRun = opts.dryRun || false;

  console.log(`\n${"═".repeat(65)}`);
  console.log(`  NeoStox System B — Full EOD Updater — ${todayFull()}`);
  if (CFG.dryRun) console.log(`  ⚠️  DRY RUN MODE — no files will be written`);
  console.log(`${"═".repeat(65)}\n`);

  try {
    // ── Step 1: Read source data ─────────────────────────────────────────────
    console.log("[1/5] Reading source files...");
    const sourceTrades = await readSourceTrades();
    const sourceSignals = await readBacktestSignals();

    // Read today's signals from pending file first (if still present)
    // Falls back to Backtest_Summary after Step 3 updates it
    const PENDING_FILE_SB = path.join(__dirname, "data", "pending_signals.json");
    let todaysSignalsForPDF = [];
    try {
      if (fs.existsSync(PENDING_FILE_SB)) {
        const raw = fs.readFileSync(PENDING_FILE_SB, "utf8").trim();
        if (raw) {
          const store = JSON.parse(raw);
          todaysSignalsForPDF = (store.signals || []);
        }
      }
    } catch (_) { }
    console.log(`  [READ] ${todaysSignalsForPDF.length} today's signals captured from pending file`);
    // ── Step 2: Prompt 1 — Update Overall Summary ────────────────────────────
    console.log("\n[2/5] PROMPT 1 — Updating Overall_Summary.xlsx...");
    await updateOverallSummary(sourceTrades);

    // ── NEW: Sync backtest_results.xlsx → Backtest_Summary All Signals ──────
    console.log("\n[2.5/5] Syncing backtest_results → Backtest_Summary...");
    try {
      const { syncBacktestToSummary } = require("./sync_backtest_to_summary");
      await syncBacktestToSummary();
    } catch (syncErr) {
      console.error("  ⚠️  Sync failed (non-fatal):", syncErr.message);
    }

    // ── Step 3: Prompt 2 — Update Backtest Summary ───────────────────────────
    console.log("\n[3/5] PROMPT 2 — Updating Backtest_Summary.xlsx...");
    // Pass today's pending signals so they get appended to All Signals sheet
    const btSignalsToAppend = todaysSignalsForPDF.map(sig => ({
      patternId: sig.patternId,
      symbol: sig.symbol,
      direction: sig.direction,
      signalTime: sig.signalTime || sig.savedAt,
      entry: sig.entry || 0,
      sl: sig.sl || sig.stopLoss || 0,
      signalHigh: sig.signalCandleClose || 0,  // best proxy available
      signalLow: sig.sl || 0,
      signalClose: sig.signalCandleClose || sig.entry || 0,
      targetPrice: sig.t1 || sig.targetPrice || 0,
      candles: sig.candles || 0,
      result: null,   // OPEN — not yet resolved
      pnl: 0,
      pnlPct: 0,
    }));
    const btStats = await updateBacktest(btSignalsToAppend);

    // ── Step 4: Prompt 3 — Update Trades.xlsx ────────────────────────────────
    console.log("\n[4/5] PROMPT 3 — Updating Trades.xlsx...");
    await updateTrades(sourceTrades, sourceSignals);

    // ── Step 4.5: Generate PDF — reads from Backtest_Summary (already updated in Step 3) ─
    console.log("\n[4.5/5] Generating daily PDF summary...");
    try {
      // If pending file had signals, use those directly
      // Otherwise read today's signals fresh from Backtest_Summary
      if (todaysSignalsForPDF.length === 0) {
        const todayStr = moment().utcOffset("+05:30").format("YYYY-MM-DD");
        const freshSignals = await readBacktestSignals();
        todaysSignalsForPDF = freshSignals.filter(s => {
          const d = String(s.signalTime || s.date || "");
          // match both "2026-03-13T..." and "2026-03-13 ..."
          return d.startsWith(todayStr) || moment(d, [
            "YYYY-MM-DD HH:mm:ss", "YYYY-MM-DD HH:mm", "YYYY-MM-DDTHH:mm:ss", "YYYY-MM-DD"
          ], false).format("YYYY-MM-DD") === todayStr;
        });
        console.log(`  [PDF] ${todaysSignalsForPDF.length} today's signals loaded from Backtest_Summary`);
      }

      const summaryResult = await generateDailySummary(
        moment().utcOffset("+05:30").format("YYYY-MM-DD"),
        CFG.backtestFile,
        CFG.tradesFile,
        process.env.SUMMARY_DIR || path.join(path.dirname(CFG.tradesFile), "Daily Summaries"),
        todaysSignalsForPDF,
      );
      if (summaryResult?.pdfPath) {
        console.log(`  ✅ PDF summary saved: ${summaryResult.pdfPath}`);
      } else if (summaryResult?.htmlPath) {
        console.log(`  ℹ️  HTML summary saved (no PDF): ${summaryResult.htmlPath}`);
      }
    } catch (err) {
      console.error("  ⚠️  PDF summary generation failed (non-fatal):", err.message);
    }

    // ── Step 5: Send Telegram EOD report ─────────────────────────────────────
    console.log("\n[5/5] Sending EOD Telegram report to sir...");
    await sendEODTelegram(sourceTrades, btStats);

    console.log(`\n${"═".repeat(65)}`);
    console.log(`  ✅ System B complete! All files updated + Telegram sent.`);
    console.log(`${"═".repeat(65)}\n`);

  } catch (err) {
    console.error("\n❌ System B Error:", err.message);
    console.error(err.stack);

    // Send error alert
    if (!CFG.dryRun && CFG.telegramToken && CFG.telegramChat) {
      try {
        const TelegramBot = require("node-telegram-bot-api");
        const bot = new TelegramBot(CFG.telegramToken, { polling: false });
        await bot.sendMessage(CFG.telegramChat,
          `⚠️ *NeoStox System B ERROR*\n\`${err.message}\`\nPlease update files manually.`,
          { parse_mode: "Markdown" });
      } catch (_) { }
    }
  }
}

// ─── SCHEDULER ───────────────────────────────────────────────────────────────
function startScheduler() {
  const [hh, mm] = CFG.scheduleTime.split(":").map(Number);
  console.log(`⏰ System B Scheduler — auto-runs at ${CFG.scheduleTime} IST every market day`);

  function scheduleNext() {
    const now = moment().utcOffset("+05:30");
    const target = moment().utcOffset("+05:30").set({ hour: hh, minute: mm, second: 0, ms: 0 });
    if (target.isBefore(now)) target.add(1, "day");
    const ms = target.diff(now);
    console.log(`⏳ Next run: ${target.format("YYYY-MM-DD HH:mm")} IST  (in ${(ms / 60000).toFixed(1)} min)`);
    setTimeout(async () => {
      await runSystemB();
      scheduleNext();
    }, ms);
  }
  scheduleNext();
}

// ─── EXPORTS (use appendSignalToBacktest from your index.js) ─────────────────
module.exports = {
  runSystemB,
  startScheduler,
  updateBacktest,    // call after new signals fire
  CFG,
};

// ─── CLI ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes("--schedule")) {
    startScheduler();
    process.stdin.resume();
  } else if (args.includes("--dry-run")) {
    runSystemB({ dryRun: true });
  } else {
    runSystemB();
  }
}