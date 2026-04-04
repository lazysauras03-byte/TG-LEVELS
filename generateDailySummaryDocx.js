"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");

let moment;
try { moment = require("moment"); }
catch (_) { moment = require(path.join(require("child_process").execSync("npm root -g").toString().trim(), "moment")); }

let docxLib;
try { docxLib = require("docx"); }
catch (_) { docxLib = require(path.join(require("child_process").execSync("npm root -g").toString().trim(), "docx")); }

const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, PageBreak, ImageRun, ExternalHyperlink } = docxLib;

const BASE_DIR = __dirname;
const CFG = {
  telegramSignalsFile: process.env.TELEGRAM_SIGNALS_FILE || path.join(BASE_DIR, "data", "telegram_signals.json"),
  pendingFile: process.env.PENDING_SIGNALS_FILE || path.join(BASE_DIR, "data", "pending_signals.json"),
  signalsFile: process.env.SIGNALS_FILE || path.join(BASE_DIR, "data", "signals.json"),
  backtestFile: process.env.BACKTEST_RESULTS_FILE || path.join(BASE_DIR, "backtest_results.xlsx"),
  neostoxFile: process.env.NEOSTOX_EXPORT_FILE || "C:\\Users\\PIS\\Desktop\\Project\\3C Break\\Trade History\\NeoStox Export\\NeoStox_Trade_History.xls",
  neostoxDir: process.env.NEOSTOX_EXPORT_DIR || "C:\\Users\\PIS\\Desktop\\Project\\3C Break\\Trade History\\NeoStox Export",
  screenshotsDir: process.env.SCREENSHOTS_DIR || "C:\\Users\\PIS\\Desktop\\Project\\3C Break\\Trade History\\Screenshots",
  outputDir: process.env.SUMMARY_DIR || "C:\\Users\\PIS\\Desktop\\Project\\3C Break\\Trade History\\Daily Summaries",
  balance: process.env.BALANCE || "10975128.40",
  currentBalance: process.env.CURRENT_BALANCE || "10330231.59",
  telegramToken: process.env.TELEGRAM_TOKEN || "8671371710:AAFXdzpLwRWQ1TNgN8g1PV4Sm8CZ4oMiIbc",
  telegramChat: process.env.TELEGRAM_CHAT_ID || "8559767849",
};

const CLR = {
  darkBg: "1F2D3D", bullBg: "1E8449", bearBg: "922B21", liveBg: "154360", allLiveBg: "1A5276",
  bullLight: "E2EFDA", bearLight: "FCE4D6", liveLight: "D6EAF8", allLiveL: "D1ECF1",
  statsAlt: "EAF4FB", white: "FFFFFF", textDark: "1F2D3D", textGrey: "555555",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseNum(v) { if (v == null) return 0; const n = parseFloat(String(v).replace(/[₹,\s]/g, "").replace("Rs.", "").trim()); return isNaN(n) ? 0 : n; }
function fmtRs(n) { if (!n && n !== 0) return "Rs. 0.00"; const abs = Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (n >= 0 ? "+" : "-") + "Rs. " + abs; }
function fmtPts(n) { if (!n && n !== 0) return "0.00"; const abs = Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (n >= 0 ? "+" : "-") + abs; }
function pct(n, dec = 1) { return (n == null || isNaN(n)) ? "0.0%" : n.toFixed(dec) + "%"; }
function todayIST() { return moment().utcOffset("+05:30").format("YYYY-MM-DD"); }
function mkBorder(c = "DDDDDD") { const b = { style: BorderStyle.SINGLE, size: 4, color: c }; return { top: b, bottom: b, left: b, right: b }; }
function TR(text, opts = {}) { return new TextRun({ text: String(text ?? ""), font: "Arial", size: opts.size || 20, bold: opts.bold || false, color: opts.color || CLR.textDark, ...opts }); }
function Para(children, opts = {}) { if (!Array.isArray(children)) children = [children]; return new Paragraph({ alignment: opts.align || AlignmentType.LEFT, spacing: opts.spacing || { before: 0, after: 60 }, children, ...opts }); }

// ── Parse Nifty bias FROM the raw HTML message field ─────────────────────────
function parseNiftyBiasFromRaw(rawHtml) {
  if (!rawHtml) return { bias: "", emoji: "⚠️", alignLabel: "" };
  const stripped = rawHtml
    .replace(/<[^>]+>/g, "")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
  const biasLine = stripped.match(/Nifty Bias\s*[:\s]+(.+)/i);
  if (!biasLine) return { bias: "", emoji: "⚠️", alignLabel: "" };
  const biasText = biasLine[1].trim();
  let bias = "", emoji = "⚠️", alignLabel = "";
  if (/LONG/i.test(biasText)) { bias = "LONG"; emoji = "🟢"; }
  else if (/SHORT/i.test(biasText)) { bias = "SHORT"; emoji = "🔴"; }
  else if (/CHOPPY/i.test(biasText)) { bias = "CHOPPY"; emoji = "⚠️"; }
  if (/Aligned/i.test(biasText)) alignLabel = "Aligned ✅";
  else if (/Counter\s*Trend/i.test(biasText)) alignLabel = "Counter Trend ⚠️";
  else if (/Choppy/i.test(biasText)) alignLabel = "Choppy ⚠️";
  return { bias, emoji, alignLabel };
}

// ── Parse detailed signal fields FROM the raw HTML message field ──────────────
function parseDetailedFieldsFromRaw(rawHtml) {
  if (!rawHtml) return {};
  const stripped = rawHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
  const result = {};

  // Crossover time + relative age
  const crossM = stripped.match(/Crossover\s*[:\s]+([\d\-]+ [\d:]+)\s*\(([^)]+)\)/i);
  if (crossM) { result.crossoverTimeFormatted = `${crossM[1]} (${crossM[2]})`; result.crossoverTime = crossM[1]; }
  else { const crossM2 = stripped.match(/Crossover\s*[:\s]+([\d\-]+ [\d:]+)/i); if (crossM2) { result.crossoverTime = crossM2[1]; result.crossoverTimeFormatted = crossM2[1]; } }

  // Pullback time
  const pbM = stripped.match(/Pullback\s*[:\s]+([\d\-]+ [\d:]+)/i);
  if (pbM) result.pullbackTime = pbM[1];

  // Pullback Low + EMA9(Low)
  const pbLowM = stripped.match(/Low\s+₹([\d\.]+)\s*[≤<]=?\s*EMA9\(Low\)\s*₹([\d\.]+)/i);
  if (pbLowM) { result.pullbackLow = pbLowM[1]; result.pullbackEma9Low = pbLowM[2]; }

  // Pullback High (bullish)
  const pbHighM = stripped.match(/High\s+₹([\d\.]+)\s*\(breakout level\)/i);
  if (pbHighM) result.pullbackHigh = pbHighM[1];

  // Bearish: High ≥ EMA9(High) + Low (breakdown level)
  const pbHighBearM = stripped.match(/High\s+₹([\d\.]+)\s*[≥>]=?\s*EMA9\(High\)\s*₹([\d\.]+)/i);
  if (pbHighBearM) { result.pullbackHigh = pbHighBearM[1]; result.pullbackEma9High = pbHighBearM[2]; }
  const pbLowBreakM = stripped.match(/Low\s+₹([\d\.]+)\s*\(breakdown level\)/i);
  if (pbLowBreakM) result.pullbackLow = pbLowBreakM[1];

  // Confirm time + offset
  const cfM = stripped.match(/Confirm\s*[:\s]+([\d\-]+ [\d:]+)\s*\(\+(\d+)\s*candle\)/i);
  if (cfM) { result.confirmTime = cfM[1]; result.confirmOffset = cfM[2]; }
  else { const cfM2 = stripped.match(/Confirm\s*[:\s]+([\d\-]+ [\d:]+)/i); if (cfM2) result.confirmTime = cfM2[1]; }

  // ✅ FIX: [^(]* handles the ✅ emoji between price and "(body breakout)"
  const cfBullM = stripped.match(/Close\s+₹([\d\.]+)\s*[>]\s*Pullback High\s+₹([\d\.]+)[^(]*\(body breakout\)/i);
  if (cfBullM) { result.confirmClose = cfBullM[1]; result.confirmVsPb = cfBullM[2]; result.confirmType = "breakout"; }

  // ✅ FIX: [^(]* handles the ✅ emoji between price and "(body breakdown)"
  const cfBearM = stripped.match(/Close\s+₹([\d\.]+)\s*[<]\s*Pullback Low\s+₹([\d\.]+)[^(]*\(body breakdown\)/i);
  if (cfBearM) { result.confirmClose = cfBearM[1]; result.confirmVsPb = cfBearM[2]; result.confirmType = "breakdown"; }

  // Entry, SL, Risk
  const entryM = stripped.match(/Entry\s*[:\s]+₹([\d\.]+)/i);
  if (entryM) result.entry = entryM[1];
  const slM = stripped.match(/Stop Loss\s*[:\s]+₹([\d\.]+)/i);
  if (slM) result.sl = slM[1];
  const riskM = stripped.match(/Risk\s*[:\s]+₹([\d\.]+)/i);
  if (riskM) result.risk = riskM[1];

  return result;
}

// ── Parse raw Telegram signal message ────────────────────────────────────────
function parseTelegramMessage(raw) {
  if (typeof raw !== "string") return null;
  const isBull = /bullish/i.test(raw), isBear = /bearish/i.test(raw);
  if (!isBull && !isBear) return null;
  let symbol = "";
  const m1 = raw.match(/NSE:([A-Z0-9]+)(?:-EQ)?/i);
  if (m1) symbol = m1[1];
  else { const m2 = raw.match(/(?:SIGNAL\s*[—\-]+\s*(?:NSE:)?|---\s*)([A-Z0-9]+)/i); if (m2) symbol = m2[1]; }
  const attemptMatch = raw.match(/Attempt\s*#(\d+)/i);
  const niftyParsed = parseNiftyBiasFromRaw(raw);
  let niftyBias = niftyParsed.bias, niftyEmoji = niftyParsed.emoji, niftyAlignLabel = niftyParsed.alignLabel;
  if (!niftyBias) {
    const nbMatch = raw.match(/Nifty\s*Bias\s*[:\s]+([^\n]+)/i);
    if (nbMatch) {
      const nb = nbMatch[1];
      if (/long/i.test(nb)) { niftyBias = "LONG"; niftyEmoji = "🟢"; }
      else if (/short/i.test(nb)) { niftyBias = "SHORT"; niftyEmoji = "🔴"; }
      else { niftyBias = "CHOPPY"; niftyEmoji = "⚠️"; }
      if (/aligned/i.test(nb)) niftyAlignLabel = "Aligned ✅";
      else if (/counter/i.test(nb)) niftyAlignLabel = "Counter Trend ⚠️";
      else if (/choppy/i.test(nb)) niftyAlignLabel = "Choppy ⚠️";
    }
  }
  const spanMatch = raw.match(/Candle\s*Span\s*:\s*([\d\/]+)/i);
  const crossMatch = raw.match(/Crossover\s*:\s*([\d\-]+ [\d:]+)/i);
  let pullbackTime = "", confirmTime = "";
  const pbExplicit = raw.match(/Pullback\s*:\s*([\d\-]+ [\d:]+)/i);
  const cfExplicit = raw.match(/Confirm\s*:\s*([\d\-]+ [\d:]+)/i);
  if (pbExplicit) pullbackTime = pbExplicit[1];
  if (cfExplicit) confirmTime = cfExplicit[1];
  const entryM = raw.match(/Entry\s*:\s*₹([\d\.]+)/i);
  const slM = raw.match(/Stop\s*Loss\s*:\s*₹([\d\.]+)/i);
  const t1M = raw.match(/T1\s*[→\->]+\s*₹([\d\.]+)/i);
  const t2M = raw.match(/T2\s*[→\->]+\s*₹([\d\.]+)/i);
  const riskM = raw.match(/Risk\s*:\s*₹([\d\.]+)/i);
  const detM = raw.match(/Detected\s*:\s*([\d\-]+)/i);
  return {
    symbol, direction: isBull ? "BULLISH_CROSSOVER" : "BEARISH_CROSSOVER",
    attemptNumber: attemptMatch ? parseInt(attemptMatch[1]) : 1,
    niftyBias, niftyEmoji, niftyAlignLabel,
    candleSpan: spanMatch ? spanMatch[1] : null,
    crossoverTime: crossMatch ? crossMatch[1] : "",
    pullbackTime, confirmTime,
    entry: entryM ? parseFloat(entryM[1]) : null,
    sl: slM ? parseFloat(slM[1]) : null,
    t1: t1M ? parseFloat(t1M[1]) : null,
    t2: t2M ? parseFloat(t2M[1]) : null,
    risk: riskM ? parseFloat(riskM[1]) : null,
    date: detM ? detM[1] : todayIST(),
    raw,
  };
}

// ── Read signals from all sources ────────────────────────────────────────────
function readAllSignals(dateStr) {
  const sources = [CFG.telegramSignalsFile, CFG.pendingFile, CFG.signalsFile];
  for (const filePath of sources) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const rawText = fs.readFileSync(filePath, "utf8").trim();
      if (!rawText) continue;
      const parsed = JSON.parse(rawText);
      const arr = Array.isArray(parsed) ? parsed : (parsed.signals || []);
      if (!arr.length) continue;
      const sigs = arr.map(item => {
        if (typeof item === "string") return parseTelegramMessage(item);
        if (item.symbol && item.direction) {
          if (item.raw) {
            const niftyParsed = parseNiftyBiasFromRaw(item.raw);
            if (niftyParsed.bias) {
              item.niftyBias = niftyParsed.bias;
              item.niftyEmoji = niftyParsed.emoji;
              item.niftyAlignLabel = niftyParsed.alignLabel;
            }
          }
          return item;
        }
        if (item.raw) return parseTelegramMessage(item.raw);
        return item;
      }).filter(Boolean);
      if (!sigs.length) continue;
      const filtered = dateStr ? sigs.filter(s => String(s.date || s.signalTime || s.confirmTime || s.savedAt || "").startsWith(dateStr)) : sigs;
      const result = filtered.length ? filtered : (filePath === CFG.telegramSignalsFile ? sigs : []);
      if (result.length) { console.log(`  Signals from: ${path.basename(filePath)} → ${result.length}`); return result; }
    } catch (e) { console.warn(`  ⚠️  ${path.basename(filePath)}: ${e.message}`); }
  }
  return [];
}

// ══════════════════════════════════════════════════════════════════════════════
// ✅ FIXED appendSignalToFile
// ══════════════════════════════════════════════════════════════════════════════
//
// ROOT CAUSE OF BUG:
//   The server runs every 15 minutes. sentPatterns (in-memory) prevents
//   duplicate TELEGRAM sends within the same session. But if the process
//   restarts (or runs across sessions), sentPatterns resets.
//
//   When BSE was first detected at 11:45 (Nifty=LONG), telegram was sent
//   and the signal was saved to JSON with the correct LONG bias in `raw`.
//
//   But when the server re-ran at 16:19 (Nifty=CHOPPY), BSE pattern was
//   still valid. Since the process had restarted (sentPatterns empty),
//   it sent AGAIN to Telegram AND called appendSignalToFile AGAIN,
//   which OVERWROTE/DUPLICATED the entry with a new `raw` containing CHOPPY.
//   The JSON now has the 16:19 CHOPPY version, losing the original LONG.
//
// FIX:
//   1. appendSignalToFile now accepts an optional `patternId` parameter.
//   2. Before appending, it checks if a signal with the same patternId
//      already exists in the file. If yes → SKIP (never overwrite).
//   3. If no patternId is passed, fall back to checking symbol+date+direction
//      (for backwards compatibility).
//   4. This means the FIRST send (correct bias, correct context) always wins.
//
// CALL SITE CHANGE in index.js:
//   Pass patternId when calling appendSignalToFile:
//
//   appendSignalToFile({
//     patternId,           // ← ADD THIS LINE
//     raw: telegramMessage,
//     symbol: symClean,
//     direction: pattern.crossoverType,
//     crossoverTime: pattern.crossover.timestamp,
//     pullbackTime: pattern.pullbackCandle.timestamp,
//     confirmTime: pattern.confirmationCandle.timestamp,
//     niftyBias: niftyBias.bias,
//     niftyEmoji: niftyBias.emoji,
//     niftyAlignLabel: ...,
//     entry: pattern.entryPrice,
//     sl: pattern.stopLoss,
//     date: moment().format("YYYY-MM-DD"),
//   });
//
// ══════════════════════════════════════════════════════════════════════════════
function appendSignalToFile(sigObj) {
  const filePath = CFG.telegramSignalsFile;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Load existing signals
  let existing = [];
  try {
    if (fs.existsSync(filePath)) {
      const r = fs.readFileSync(filePath, "utf8").trim();
      if (r) existing = JSON.parse(r);
    }
  } catch (_) { }
  if (!Array.isArray(existing)) existing = [];

  // ── DEDUP CHECK ───────────────────────────────────────────────────────────
  // Priority 1: patternId match (exact same crossover+confirm candle pair)
  if (sigObj.patternId) {
    const alreadyExists = existing.some(e => e.patternId === sigObj.patternId);
    if (alreadyExists) {
      console.log(`  📋 appendSignalToFile: SKIPPED — patternId already saved: ${sigObj.patternId}`);
      return; // ← First save wins. Never overwrite with a stale re-detection.
    }
  } else {
    // Fallback dedup: same symbol + date + direction + confirmTime
    // This covers signals saved before patternId was added
    const confirmKey = `${sigObj.symbol}|${sigObj.date}|${sigObj.direction}|${sigObj.confirmTime || ""}`;
    const alreadyExists = existing.some(e => {
      const eKey = `${e.symbol}|${e.date}|${e.direction}|${e.confirmTime || ""}`;
      return eKey === confirmKey && confirmKey !== "|||";
    });
    if (alreadyExists) {
      console.log(`  📋 appendSignalToFile: SKIPPED — signal already saved (${sigObj.symbol} ${sigObj.date} ${sigObj.direction})`);
      return;
    }
  }

  // ── APPEND ────────────────────────────────────────────────────────────────
  existing.push({ ...sigObj, savedAt: new Date().toISOString() });
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
  console.log(`  💾 appendSignalToFile: SAVED — ${sigObj.symbol} (${sigObj.direction}) patternId=${sigObj.patternId || "none"}`);
}

// ── NeoStox XLS parser ────────────────────────────────────────────────────────
function parseNeoStoxFile(filePath, targetDate) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  let html; try { html = fs.readFileSync(filePath, "utf8"); } catch (e) { return null; }
  function parseTable(html) {
    const rows = []; let curRow = null, curCell = [], inCell = false, inHidden = false, hDepth = 0;
    const tagRe = /<(\/?)(\w+)([^>]*)>/gi; let last = 0, m;
    while ((m = tagRe.exec(html)) !== null) {
      if (inCell && !inHidden) { const txt = html.slice(last, m.index).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#\d+;/g, "").trim(); if (txt) curCell.push(txt); }
      last = tagRe.lastIndex;
      const isClose = m[1] === "/", tag = m[2].toLowerCase(), attrs = m[3] || "";
      if (!isClose) { if (tag === "tr") curRow = []; else if (tag === "td" || tag === "th") { curCell = []; inCell = true; } else if (tag === "span" && attrs.includes("hidden")) { inHidden = true; hDepth = 1; } else if (tag === "span" && inHidden) hDepth++; }
      else { if (tag === "td" || tag === "th") { if (curRow) curRow.push(curCell.join(" ").trim()); curCell = []; inCell = false; } else if (tag === "tr") { if (curRow?.length) rows.push(curRow); curRow = null; } else if (tag === "span" && inHidden) { if (--hDepth <= 0) inHidden = false; } }
    } return rows;
  }
  const rows = parseTable(html);
  const hi = rows.findIndex(r => r.includes("Date") && r.includes("Net P/L")); if (hi === -1) return null;
  const hdr = rows[hi]; const ci = {}; hdr.forEach((h, i) => { ci[h.trim()] = i; });
  const C = { inst: ci["Instrument"] ?? 1, ord: ci["Ord Type"] ?? 3, qty: ci["Quantity"] ?? 7, entry: ci["Entry Price"] ?? 10, exit: ci["Exit Price"] ?? 11, brok: ci["Brokerage"] ?? 12, tax: ci["Total Tax"] ?? 18, netPL: ci["Net P/L"] ?? 19 };
  function cleanSym(inst) { return (inst || "").split(/\s+/)[0].toUpperCase().trim(); }
  function cleanPrice(s) { const str = String(s || "").replace(/[₹,]/g, "").replace("Rs.", "").trim(); if (!str || str === "-") return null; const n = parseFloat(str); return isNaN(n) ? null : n; }
  const hiddenDates = []; const hiddenRe = /<span[^>]+class="hidden1"[^>]*>([^<]+)<\/span>/gi; let hm;
  while ((hm = hiddenRe.exec(html)) !== null) { const dm = hm[1].match(/(\w{3})\s+(\w{3})\s+(\d{1,2})\s+(\d{4})/); if (dm) { const mo = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" }; hiddenDates.push(dm[4] + "-" + (mo[dm[2]] || "00") + "-" + dm[3].padStart(2, "0")); } else hiddenDates.push(null); }
  const dataRows = rows.slice(hi + 1).filter(r => r && r.length >= 10); let hIdx = 0;
  const allEntries = [], allExits = [];
  for (const row of dataRows) {
    const sym = cleanSym(row[C.inst]); if (!sym) continue;
    const side = String(row[C.ord] || "").toUpperCase().includes("BUY") ? "BUY" : "SELL";
    const netPL = cleanPrice(row[C.netPL]), entry = cleanPrice(row[C.entry]), exit = cleanPrice(row[C.exit]);
    const brok = cleanPrice(row[C.brok]) || 0, tax = cleanPrice(row[C.tax]) || 0, qty = parseNum(row[C.qty]);
    const rowDate = hiddenDates[hIdx++];
    if (netPL !== null) { let pts = null; if (entry != null && exit != null) pts = side === "SELL" ? (entry - exit) * qty : (exit - entry) * qty; allExits.push({ sym, side, entry, exit, qty, brok, tax, netPL, isWin: netPL > 0, pts, rowDate }); }
    else if (entry !== null) { allEntries.push({ sym, side, entry, qty, brok, tax, rowDate }); }
  }
  const todayStr = targetDate || todayIST();
  const todayEntries = allEntries.filter(e => e.rowDate === todayStr);
  const prevEntries = allEntries.filter(e => e.rowDate && e.rowDate < todayStr);
  const todayExits = allExits.filter(e => e.rowDate === todayStr);
  const todayEntrySyms = new Set(todayEntries.map(e => e.sym));
  const prevEntrySyms = new Set(prevEntries.map(e => e.sym));
  const todayCompleted = todayExits.filter(e => todayEntrySyms.has(e.sym));
  const prevCompleted = todayExits.filter(e => prevEntrySyms.has(e.sym) && !todayEntrySyms.has(e.sym));
  const exitedToday = new Set(todayExits.map(e => e.sym));
  const openToday = todayEntries.filter(e => !exitedToday.has(e.sym));
  const allWins = allExits.filter(t => t.isWin);
  const allNetTotal = allExits.reduce((s, t) => s + t.netPL, 0);
  const allBrok = allExits.reduce((s, t) => s + t.brok, 0);
  const allTax = allExits.reduce((s, t) => s + t.tax, 0);
  const allExitedSyms = new Set(allExits.map(e => e.sym));
  const allOpenEntries = allEntries.filter(e => !allExitedSyms.has(e.sym));
  let realizedPL = null;
  const rlMatch = html.match(/color:\s*red">Rs\.\s*([-\d,\.]+)<\/td>\s*<td[^>]*color:\s*red">Rs\.\s*([-\d,\.]+)/);
  if (rlMatch) realizedPL = cleanPrice(rlMatch[2]);
  if (realizedPL == null) realizedPL = allExits.reduce((s, t) => s + (t.pts || 0), 0);
  const todayWins = todayCompleted.filter(t => t.isWin);
  const todayNet = todayCompleted.reduce((s, t) => s + t.netPL, 0);
  const todayBrok = todayCompleted.reduce((s, t) => s + t.brok, 0);
  const todayTax = todayCompleted.reduce((s, t) => s + t.tax, 0);
  const todayRealPL = todayCompleted.reduce((s, t) => s + (t.pts || 0), 0);
  const prevWins = prevCompleted.filter(t => t.isWin);
  const prevNet = prevCompleted.reduce((s, t) => s + t.netPL, 0);
  const prevBrok = prevCompleted.reduce((s, t) => s + t.brok, 0);
  const prevTax = prevCompleted.reduce((s, t) => s + t.tax, 0);
  const prevRealPL = prevCompleted.reduce((s, t) => s + (t.pts || 0), 0);
  const takenSymbols = new Set([...todayEntries.map(e => e.sym), ...todayExits.map(e => e.sym), ...prevEntries.map(e => e.sym)]);
  return {
    todayEntries, prevEntries, todayCompleted, prevCompleted, openToday, takenSymbols,
    todaySummary: { taken: todayEntries.length, completed: todayCompleted.length, wins: todayWins.length, losses: todayCompleted.length - todayWins.length, open: openToday.length, winRate: todayCompleted.length ? (todayWins.length / todayCompleted.length * 100) : 0, netPL: todayNet, realizedPL: todayRealPL, brok: todayBrok, tax: todayTax },
    prevSummary: { completed: prevCompleted.length, wins: prevWins.length, losses: prevCompleted.length - prevWins.length, open: allOpenEntries.filter(e => e.rowDate && e.rowDate < todayStr).length, netPL: prevNet, realizedPL: prevRealPL, brok: prevBrok, tax: prevTax },
    allTimeSummary: { total: allExits.length, open: allOpenEntries.length, wins: allWins.length, losses: allExits.length - allWins.length, winRate: allExits.length ? (allWins.length / allExits.length * 100) : 0, netPL: allNetTotal, realizedPL, brok: allBrok, tax: allTax },
    completed: allExits, open: allOpenEntries, realizedPL,
    summary: { total: allExits.length, open: allOpenEntries.length, wins: allWins.length, losses: allExits.length - allWins.length, winRate: allExits.length ? (allWins.length / allExits.length * 100) : 0, netPL: allNetTotal, realizedPL, brok: allBrok, tax: allTax },
  };
}

function readAllNeoStoxTrades(exportDir, todayFile, targetDate) {
  const allCompleted = [], allOpen = []; let allBrok = 0, allTax = 0, allRealizedPL = 0;
  function processFile(fpath) { const data = parseNeoStoxFile(fpath, targetDate); if (!data) return; allCompleted.push(...data.completed); allOpen.push(...data.open); allBrok += data.allTimeSummary.brok; allTax += data.allTimeSummary.tax; allRealizedPL += (data.realizedPL || 0); }
  if (todayFile && fs.existsSync(todayFile)) processFile(todayFile);
  if (exportDir && fs.existsSync(exportDir)) { try { fs.readdirSync(exportDir).filter(f => (f.endsWith(".xls") || f.endsWith(".html")) && f !== path.basename(todayFile || "")).forEach(f => processFile(path.join(exportDir, f))); } catch (_) { } }
  const seen = new Set();
  const uniq = allCompleted.filter(t => { const k = `${t.sym}|${t.entry}|${t.exit}|${t.netPL}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const wins = uniq.filter(t => t.isWin), netTotal = uniq.reduce((s, t) => s + t.netPL, 0);
  const openMap = new Map(); allOpen.forEach(t => { if (!openMap.has(t.sym)) openMap.set(t.sym, t); });
  return { summary: { total: uniq.length, open: openMap.size, wins: wins.length, losses: uniq.length - wins.length, winRate: uniq.length ? (wins.length / uniq.length * 100) : 0, netPL: netTotal, realizedPL: allRealizedPL, brok: allBrok, tax: allTax } };
}

async function readBacktestResults(dateStr) {
  let ExcelJS;
  try { ExcelJS = require("exceljs"); }
  catch (_) {
    try { ExcelJS = require(path.join(require("child_process").execSync("npm root -g").toString().trim(), "exceljs")); }
    catch (e) { return { today: [], allTime: [] }; }
  }
  if (!fs.existsSync(CFG.backtestFile)) return { today: [], allTime: [] };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(CFG.backtestFile);
  const ws = wb.worksheets.find(s =>
    s.name.toLowerCase().includes("backtest") || s.name.toLowerCase().includes("result")
  ) || wb.worksheets[0];
  if (!ws) return { today: [], allTime: [] };
  const colMap = {};
  ws.getRow(1).eachCell((cell, ci) => { colMap[String(cell.value || "").toLowerCase().trim()] = ci; });
  const get = (row, name) => { const c = colMap[name.toLowerCase().trim()]; return c ? row.getCell(c).value : null; };
  const allRows = [], todayRows = [];
  ws.eachRow((row, rn) => {
    if (rn === 1) return;
    const pid = String(get(row, "Pattern ID") || "").trim();
    if (!pid) return;
    if (pid.toUpperCase().startsWith("SUMMARY")) return;
    const sym = String(get(row, "Symbol") || "").trim();
    if (!sym) return;
    const sigTime = String(get(row, "Signal Candle Time") || "").trim();
    const rr = String(get(row, "Result") || "OPEN").trim().toUpperCase();
    let result = "OPEN";
    if (rr.includes("TARGET")) result = "TARGET HIT";
    else if (rr.includes("SL")) result = "SL HIT";
    const pnl = parseNum(get(row, "PnL (pts)"));
    const rowObj = { patternId: pid, symbol: sym.replace(/^NSE:/i, "").replace(/-EQ$/i, ""), direction: String(get(row, "Crossover Type") || "").toUpperCase(), sigTime, result, pnl };
    allRows.push(rowObj);
    if (dateStr && sigTime.startsWith(dateStr)) todayRows.push(rowObj);
  });
  return { today: todayRows, allTime: allRows };
}

function calcStats(rows) {
  const res = rows.filter(r => r.result === "TARGET HIT" || r.result === "SL HIT");
  const open = rows.filter(r => r.result === "OPEN");
  const win = res.filter(r => r.result === "TARGET HIT");
  return {
    total: rows.length, resolved: res.length, open: open.length,
    winners: win.length, losers: res.length - win.length,
    winRate: res.length ? (win.length / res.length * 100) : 0,
    netPnl: res.reduce((s, r) => s + r.pnl, 0),
  };
}

function findScreenshot(symbol) {
  const sym = String(symbol || "").replace(/^NSE:/i, "").replace(/-EQ$/i, "").toUpperCase().trim();
  const dirs = [
    "C:\\Users\\PIS\\Desktop\\Project\\3C Break\\Trade History\\Screenshots",
    CFG.screenshotsDir,
    path.join(path.dirname(CFG.neostoxFile || "C:\\"), "Screenshots"),
  ].filter(Boolean);
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      const exact = files.find(f => /\.(png|jpg|jpeg)$/i.test(f) && path.basename(f, path.extname(f)).toUpperCase().trim() === sym);
      if (exact) return path.join(dir, exact);
      const partial = files.find(f => { if (!/\.(png|jpg|jpeg)$/i.test(f)) return false; const base = path.basename(f, path.extname(f)).toUpperCase().trim(); return base.includes(sym) || sym.includes(base); });
      if (partial) return path.join(dir, partial);
    } catch (e) { console.warn(`  ⚠️  Error reading dir ${dir}: ${e.message}`); }
  }
  return null;
}

function buildTVLink(symbol) {
  const sym = String(symbol || "").replace(/^NSE:/i, "").replace(/-EQ$/i, "").toUpperCase().trim();
  return `https://www.tradingview.com/chart/?symbol=NSE%3A${sym}&interval=15`;
}

function Tbl(rows, w1, w2, altFill = CLR.statsAlt) {
  return new Table({
    width: { size: w1 + w2, type: WidthType.DXA }, columnWidths: [w1, w2],
    rows: rows.map(([label, val], i) => {
      const fill = i % 2 === 0 ? altFill : CLR.white;
      const mk = (text, w, bold) => new TableCell({
        borders: mkBorder(), shading: { fill, type: ShadingType.CLEAR },
        margins: { top: 70, bottom: 70, left: 120, right: 120 },
        width: { size: w, type: WidthType.DXA },
        children: [Para([TR(text, { bold, size: 19 })], { spacing: { before: 0, after: 0 } })],
      });
      return new TableRow({ children: [mk(label, w1, true), mk(val, w2, false)] });
    }),
  });
}

function buildCompactCard(sig) {
  const el = [];
  const isBull = String(sig.direction || "").toUpperCase().includes("BULL");
  const symClean = String(sig.symbol || "").replace(/^NSE:/i, "").replace(/-EQ$/i, "");
  const displayName = sig.displayName || sig.companyName || symClean;
  const hFill = isBull ? CLR.bullBg : CLR.bearBg;
  const prefix = isBull ? "🟢" : "🔴";
  const dirLabel = isBull ? "BULLISH SIGNAL" : "BEARISH SIGNAL";
  const tvUrl = buildTVLink(symClean);

  el.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 160, after: 0 },
    shading: { fill: hFill, type: ShadingType.CLEAR },
    children: [
      new ExternalHyperlink({
        link: tvUrl,
        children: [new TextRun({ text: `${prefix} ${dirLabel} --- ${displayName}`, font: "Arial", size: 21, bold: true, color: CLR.white, style: "Hyperlink" })],
      }),
    ],
  }));

  el.push(Para([TR("")], { spacing: { before: 0, after: 80 } }));

  // Always parse bias from raw — raw contains the ORIGINAL sent message (correct bias)
  let niftyBias = sig.niftyBias || "";
  let niftyEmoji = sig.niftyEmoji || "⚠️";
  let niftyAlignLabel = sig.niftyAlignLabel || "";
  if (sig.raw) {
    const parsed = parseNiftyBiasFromRaw(sig.raw);
    if (parsed.bias) { niftyBias = parsed.bias; niftyEmoji = parsed.emoji; niftyAlignLabel = parsed.alignLabel; }
  }

  const detail = sig.raw ? parseDetailedFieldsFromRaw(sig.raw) : {};
  const crossoverDisplay = detail.crossoverTimeFormatted || sig.crossoverTime || "";
  const pullbackDisplay = detail.pullbackTime || sig.pullbackTime || "";
  const confirmDisplay = detail.confirmTime || sig.confirmTime || "";
  const confirmOffset = detail.confirmOffset ? ` (+${detail.confirmOffset} candle)` : "";

  const nbDisplay = niftyBias
    ? `${niftyEmoji} ${niftyBias} — ${niftyAlignLabel || niftyEmoji}`
    : `${niftyEmoji} —`;

  el.push(Para(
    [TR("Nifty Bias", { bold: true, size: 20, color: CLR.textDark }),
    TR(" :  ", { size: 20, color: CLR.textGrey }),
    TR(nbDisplay, { size: 20, color: CLR.textGrey })],
    { spacing: { before: 0, after: 40 } }
  ));

  el.push(Para(
    [TR("Crossover", { bold: true, size: 20, color: CLR.textDark }),
    TR("   :  ", { size: 20, color: CLR.textGrey }),
    TR(crossoverDisplay, { size: 20, color: CLR.textGrey })],
    { spacing: { before: 0, after: 60 } }
  ));

  el.push(Para(
    [TR("Pullback", { bold: true, size: 20, color: CLR.textDark }),
    TR("    :  ", { size: 20, color: CLR.textGrey }),
    TR(pullbackDisplay, { size: 20, color: CLR.textGrey })],
    { spacing: { before: 0, after: 20 } }
  ));

  if (isBull) {
    if (detail.pullbackLow && detail.pullbackEma9Low) {
      el.push(Para([TR(`   Low  ₹${detail.pullbackLow} ≤ EMA9(Low) ₹${detail.pullbackEma9Low}`, { size: 19, color: CLR.textGrey })], { spacing: { before: 0, after: 10 } }));
    }
    if (detail.pullbackHigh) {
      el.push(Para([TR(`   High ₹${detail.pullbackHigh} (breakout level)`, { size: 19, color: CLR.textGrey })], { spacing: { before: 0, after: 60 } }));
    }
  } else {
    if (detail.pullbackHigh && detail.pullbackEma9High) {
      el.push(Para([TR(`   High ₹${detail.pullbackHigh} ≥ EMA9(High) ₹${detail.pullbackEma9High}`, { size: 19, color: CLR.textGrey })], { spacing: { before: 0, after: 10 } }));
    }
    if (detail.pullbackLow) {
      el.push(Para([TR(`   Low  ₹${detail.pullbackLow} (breakdown level)`, { size: 19, color: CLR.textGrey })], { spacing: { before: 0, after: 60 } }));
    }
  }

  el.push(Para(
    [TR("Confirm", { bold: true, size: 20, color: CLR.textDark }),
    TR("     :  ", { size: 20, color: CLR.textGrey }),
    TR(`${confirmDisplay}${confirmOffset}`, { size: 20, color: CLR.textGrey })],
    { spacing: { before: 0, after: 20 } }
  ));

  if (detail.confirmClose && detail.confirmVsPb) {
    const compSymbol = isBull ? ">" : "<";
    const levelLabel = isBull ? "Pullback High" : "Pullback Low";
    const actionLabel = isBull ? "(body breakout)" : "(body breakdown)";
    el.push(Para(
      [TR(`   Close ₹${detail.confirmClose} ${compSymbol} ${levelLabel} ₹${detail.confirmVsPb}  ${actionLabel}`, { size: 19, color: CLR.textGrey })],
      { spacing: { before: 0, after: 80 } }
    ));
  }

  // ✅ FIX: Full content width image (650px = 99% of A4 content area)
  const imgPath = findScreenshot(symClean);
  if (imgPath) {
    try {
      const imgData = fs.readFileSync(imgPath);
      const ext = path.extname(imgPath).toLowerCase().replace(".", "");
      const imgType = ext === "jpg" || ext === "jpeg" ? "jpeg" : "png";
      el.push(Para(
        [new ImageRun({ data: imgData, transformation: { width: 650, height: 366 }, type: imgType })],
        { spacing: { before: 40, after: 280 } }
      ));
    } catch (e) {
      console.warn(`  ⚠️  Could not load image for ${symClean}: ${e.message}`);
    }
  } else {
    el.push(Para([TR("")], { spacing: { before: 0, after: 200 } }));
  }

  return el;
}

function buildCoverPage(dateDisp, signals, bearish, bullish) {
  const el = [];
  el.push(Para([TR("Date: " + dateDisp, { bold: true, size: 24 })], { spacing: { before: 0, after: 240 } }));
  el.push(Para([TR("📊 Final Count:", { bold: true, size: 22 })], { spacing: { before: 0, after: 80 } }));
  el.push(new Table({
    width: { size: 7200, type: WidthType.DXA }, columnWidths: [5600, 1600],
    rows: [
      new TableRow({ children: [new TableCell({ borders: mkBorder(), shading: { fill: CLR.bullLight, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 160, right: 120 }, width: { size: 5600, type: WidthType.DXA }, children: [Para([TR("🟢 Bullish", { bold: true, size: 20 })], { spacing: { before: 0, after: 0 } })] }), new TableCell({ borders: mkBorder(), shading: { fill: CLR.bullLight, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, width: { size: 1600, type: WidthType.DXA }, children: [Para([TR(String(bullish.length), { bold: true, size: 20 })], { align: AlignmentType.CENTER, spacing: { before: 0, after: 0 } })] })] }),
      new TableRow({ children: [new TableCell({ borders: mkBorder(), shading: { fill: CLR.bearLight, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 160, right: 120 }, width: { size: 5600, type: WidthType.DXA }, children: [Para([TR("🔴 Bearish", { bold: true, size: 20 })], { spacing: { before: 0, after: 0 } })] }), new TableCell({ borders: mkBorder(), shading: { fill: CLR.bearLight, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, width: { size: 1600, type: WidthType.DXA }, children: [Para([TR(String(bearish.length), { bold: true, size: 20 })], { align: AlignmentType.CENTER, spacing: { before: 0, after: 0 } })] })] }),
      new TableRow({ children: [new TableCell({ borders: mkBorder(), shading: { fill: CLR.statsAlt, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 160, right: 120 }, width: { size: 5600, type: WidthType.DXA }, children: [Para([TR("Total", { bold: true, size: 20 })], { spacing: { before: 0, after: 0 } })] }), new TableCell({ borders: mkBorder(), shading: { fill: CLR.statsAlt, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, width: { size: 1600, type: WidthType.DXA }, children: [Para([TR(String(signals.length), { bold: true, size: 20 })], { align: AlignmentType.CENTER, spacing: { before: 0, after: 0 } })] })] }),
    ],
  }));
  el.push(Para([TR("")], { spacing: { before: 240, after: 0 } }));
  if (bullish.length) {
    el.push(Para([TR(`🟢 BULLISH TRADES --- ${bullish.length}`, { bold: true, size: 22, color: CLR.white })], { shading: { fill: CLR.bullBg, type: ShadingType.CLEAR }, spacing: { before: 120, after: 0 } }));
    el.push(new Table({ width: { size: 7200, type: WidthType.DXA }, columnWidths: [800, 6400], rows: bullish.map((sig, i) => { const sym = String(sig.symbol || "").replace(/^NSE:/i, "").replace(/-EQ$/i, ""); const name = sig.displayName || sig.companyName || sym; const fill = i % 2 === 0 ? CLR.bullLight : CLR.white; return new TableRow({ children: [new TableCell({ borders: mkBorder(), shading: { fill, type: ShadingType.CLEAR }, margins: { top: 60, bottom: 60, left: 80, right: 60 }, width: { size: 800, type: WidthType.DXA }, children: [Para([TR(String(i + 1), { size: 19 })], { align: AlignmentType.CENTER, spacing: { before: 0, after: 0 } })] }), new TableCell({ borders: mkBorder(), shading: { fill, type: ShadingType.CLEAR }, margins: { top: 60, bottom: 60, left: 120, right: 80 }, width: { size: 6400, type: WidthType.DXA }, children: [Para([TR(name, { size: 19 })], { spacing: { before: 0, after: 0 } })] })] }); }) }));
  }
  if (bearish.length) {
    el.push(Para([TR(`🔴 BEARISH TRADES --- ${bearish.length}`, { bold: true, size: 22, color: CLR.white })], { shading: { fill: CLR.bearBg, type: ShadingType.CLEAR }, spacing: { before: 120, after: 0 } }));
    el.push(new Table({ width: { size: 7200, type: WidthType.DXA }, columnWidths: [800, 6400], rows: bearish.map((sig, i) => { const sym = String(sig.symbol || "").replace(/^NSE:/i, "").replace(/-EQ$/i, ""); const name = sig.displayName || sig.companyName || sym; const fill = i % 2 === 0 ? CLR.bearLight : CLR.white; return new TableRow({ children: [new TableCell({ borders: mkBorder(), shading: { fill, type: ShadingType.CLEAR }, margins: { top: 60, bottom: 60, left: 80, right: 60 }, width: { size: 800, type: WidthType.DXA }, children: [Para([TR(String(i + 1), { size: 19 })], { align: AlignmentType.CENTER, spacing: { before: 0, after: 0 } })] }), new TableCell({ borders: mkBorder(), shading: { fill, type: ShadingType.CLEAR }, margins: { top: 60, bottom: 60, left: 120, right: 80 }, width: { size: 6400, type: WidthType.DXA }, children: [Para([TR(name, { size: 19 })], { spacing: { before: 0, after: 0 } })] })] }); }) }));
    el.push(Para([TR("")], { spacing: { before: 240, after: 0 } }));
  }
  if (!signals.length) el.push(Para([TR("No signals generated today.", { color: "888888" })], { spacing: { before: 400, after: 0 } }));
  el.push(new Paragraph({ children: [new PageBreak()] }));
  return el;
}

function sectionHdr(text, fill) {
  return Para([TR(text, { bold: true, size: 22, color: CLR.white })],
    { shading: { fill, type: ShadingType.CLEAR }, spacing: { before: 200, after: 140 } });
}

function buildStatsPage(dateShort, todayS, prevS, allTimeS, btToday, btAll, totalSignals, takenTrades, notTakenCount, takenSigs, notTakenSigs) {
  const el = [];
  el.push(Para([TR("📊  TRADING SUMMARY", { bold: true, size: 26, color: CLR.white })],
    { shading: { fill: CLR.darkBg, type: ShadingType.CLEAR }, align: AlignmentType.CENTER, spacing: { before: 0, after: 200 } }));
  const SH = (text, color) => Para([TR(`━━  ${text}  ━━━━━━━━━━━━━━━━━━━━`, { bold: true, size: 22, color })], { spacing: { before: 200, after: 80 } });
  el.push(SH(`ALL TRADES  (${dateShort})`, CLR.darkBg));
  el.push(Tbl([
    ["Total Signals", String(totalSignals)],
    ["Taken Trades", String(takenTrades).padStart(2, "0")],
    ["Not Taken", String(notTakenCount).padStart(2, "0")],
    ["Balance", `Rs. ${Number(CFG.balance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`],
    ["Current Balance", `Rs. ${Number(CFG.currentBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`],
  ], 3600, 3000));
  el.push(Para([TR("")]));
  el.push(SH(`TODAY'S LIVE TRADING  (${dateShort})`, CLR.liveBg));
  el.push(Tbl([
    ["Total", String(todayS.completed)],
    ["Completed", String(todayS.completed).padStart(2, "0")],
    ["Wins ✅", String(todayS.wins)],
    ["Losses ❌", String(todayS.losses)],
    ["Open ⏳", String(todayS.open)],
    ["Win Rate", pct(todayS.winRate)],
    ["Net P/L", `${fmtRs(todayS.netPL)}  ,  ${fmtPts(todayS.realizedPL)} pts`],
    ["Brokerage", `Rs. ${Math.abs(todayS.brok).toFixed(2)}`],
    ["Taxes & Fees", `Rs. ${Math.abs(todayS.tax).toFixed(2)}`],
  ], 3600, 3800, CLR.liveLight));
  el.push(Para([TR("")]));
  el.push(SH("ALL-TIME LIVE TRADING", CLR.allLiveBg));
  el.push(Tbl([
    ["Completed", String(allTimeS.total)],
    ["Wins ✅", String(allTimeS.wins)],
    ["Losses ❌", String(allTimeS.losses)],
    ["Open ⏳", String(allTimeS.open)],
    ["Win Rate", pct(allTimeS.winRate)],
    ["Net P/L", `${fmtRs(allTimeS.netPL)}  ,  ${fmtPts(allTimeS.realizedPL)} pts`],
    ["Brokerage", `Rs. ${Math.abs(allTimeS.brok).toFixed(2)}`],
    ["Taxes & Fees", `Rs. ${Math.abs(allTimeS.tax).toFixed(2)}`],
  ], 3600, 3000, CLR.allLiveL));
  el.push(Para([TR("")]));
  el.push(SH(`TODAY'S BACKTEST  (${dateShort})`, "1A5276"));
  el.push(Tbl([
    ["Signals Today", String(btToday.total)],
    ["Resolved", String(btToday.resolved)],
    ["TARGET HIT ✅", String(btToday.winners)],
    ["SL HIT ❌", String(btToday.losers)],
    ["Open ⏳", String(btToday.open)],
    ["Win Rate", pct(btToday.winRate)],
    ["Total PnL", `${fmtPts(btToday.netPnl)} pts`],
  ], 3600, 3000));
  el.push(Para([TR("")]));
  el.push(SH("ALL-TIME BACKTEST SUMMARY", CLR.liveBg));
  el.push(Tbl([
    ["Total Signals", String(btAll.total)],
    ["TARGET HIT ✅", String(btAll.winners)],
    ["SL HIT ❌", String(btAll.losers)],
    ["Open ⏳", String(btAll.open)],
    ["Win Rate", pct(btAll.winRate)],
    ["Total PnL", `${fmtPts(btAll.netPnl)} pts`],
  ], 3600, 3000));
  const takenArr = takenSigs || [];
  const notTakenArr = notTakenSigs || [];
  el.push(Para([TR("")], { spacing: { before: 240, after: 0 } }));
  el.push(Para([TR("🤖  TRADE BEHAVIOUR ANALYSIS", { bold: true, size: 22, color: CLR.white })],
    { shading: { fill: "2C3E50", type: ShadingType.CLEAR }, spacing: { before: 0, after: 120 } }));
  if (takenArr.length > 0) {
    el.push(Para([TR("✅ Trades Taken — What signals fired:", { bold: true, size: 20 })], { spacing: { before: 80, after: 40 } }));
    takenArr.forEach((sig, i) => {
      const sym = String(sig.symbol || "").replace(/^NSE:/i, "").replace(/-EQ$/i, "");
      const dir = String(sig.direction || "").toUpperCase().includes("BULL") ? "Bullish" : "Bearish";
      let nb = sig.niftyAlignLabel || "";
      if (sig.raw && !nb) { const p = parseNiftyBiasFromRaw(sig.raw); nb = p.alignLabel || ""; }
      const aligned = /aligned/i.test(nb) ? "aligned with Nifty bias" : /counter/i.test(nb) ? "counter-trend to Nifty" : "Nifty choppy";
      el.push(Para([
        TR(`${i + 1}. `, { bold: true, size: 19 }),
        TR(`${sym}`, { bold: true, size: 19, color: dir === "Bullish" ? "1E8449" : "922B21" }),
        TR(` — ${dir} crossover, ${aligned}.` + (sig.entry ? ` Entry ₹${sig.entry}` : "") + (sig.sl ? `, SL ₹${sig.sl}` : "") + ".", { size: 19, color: CLR.textGrey }),
      ], { spacing: { before: 0, after: 30 } }));
    });
  }
  if (notTakenArr.length > 0) {
    el.push(Para([TR(`⛔ Trades Not Taken (${notTakenArr.length} signals skipped):`, { bold: true, size: 20 })], { spacing: { before: 140, after: 40 } }));
    const counterTrend = notTakenArr.filter(s => { const nb = s.niftyAlignLabel || (s.raw ? parseNiftyBiasFromRaw(s.raw).alignLabel : ""); return /counter/i.test(nb); });
    const choppy = notTakenArr.filter(s => { const nb = s.niftyAlignLabel || (s.raw ? parseNiftyBiasFromRaw(s.raw).alignLabel : ""); return /choppy/i.test(nb); });
    const aligned = notTakenArr.filter(s => { const nb = s.niftyAlignLabel || (s.raw ? parseNiftyBiasFromRaw(s.raw).alignLabel : ""); return /aligned/i.test(nb); });
    const noReason = notTakenArr.filter(s => { const nb = s.niftyAlignLabel || (s.raw ? parseNiftyBiasFromRaw(s.raw).alignLabel : ""); return !nb; });
    const addGroup = (label, grp, color) => {
      if (!grp.length) return;
      el.push(Para([
        TR(`${label} (${grp.length}): `, { bold: true, size: 19, color }),
        TR(grp.map(s => String(s.symbol || "").replace(/^NSE:/i, "").replace(/-EQ$/i, "")).join(", "), { size: 19, color: CLR.textGrey }),
      ], { spacing: { before: 20, after: 20 } }));
    };
    addGroup("Counter-trend to Nifty bias — skipped", counterTrend, "E67E22");
    addGroup("Nifty choppy — skipped", choppy, "7D6608");
    addGroup("Aligned but not entered", aligned, "1A5276");
    addGroup("Reason unrecorded", noReason, "888888");
    const pctNT = totalSignals > 0 ? ((notTakenArr.length / totalSignals) * 100).toFixed(0) : 0;
    el.push(Para([TR(
      `📝 ${pctNT}% of today's signals were not acted on. ` +
      (counterTrend.length > 0 ? `${counterTrend.length} were counter-trend — correct discipline to avoid. ` : "") +
      (choppy.length > 0 ? `${choppy.length} fired during choppy Nifty conditions — high noise, wise to skip. ` : "") +
      (aligned.length > 0 ? `${aligned.length} aligned signals were not taken — review if entry was missed or risk was too high.` : ""),
      { size: 19, color: CLR.textGrey, italic: true }
    )], { spacing: { before: 100, after: 60 } }));
  }
  return el;
}

function buildDocx(dateStr, signals, liveData, liveAll, todayBT, allBT) {
  const mom = moment(dateStr, "YYYY-MM-DD");
  const bearish = signals.filter(s => !String(s.direction || "").toUpperCase().includes("BULL"));
  const bullish = signals.filter(s => String(s.direction || "").toUpperCase().includes("BULL"));
  const takenSyms = liveData?.takenSymbols || new Set();
  const takenSignals = signals.filter(s => takenSyms.has(String(s.symbol || "").replace(/^NSE:/i, "").replace(/-EQ$/i, "").toUpperCase()));
  const notTakenSignals = signals.filter(s => !takenSyms.has(String(s.symbol || "").replace(/^NSE:/i, "").replace(/-EQ$/i, "").toUpperCase()));
  const todayS = liveData?.todaySummary || { taken: 0, completed: 0, wins: 0, losses: 0, open: 0, winRate: 0, netPL: 0, realizedPL: 0, brok: 0, tax: 0 };
  const prevS = liveData?.prevSummary || { completed: 0, wins: 0, losses: 0, open: 0, netPL: 0, realizedPL: 0, brok: 0, tax: 0 };
  const allTimeS = liveAll?.summary || { total: 0, open: 0, wins: 0, losses: 0, winRate: 0, netPL: 0, realizedPL: 0, brok: 0, tax: 0 };
  const btTodayStats = calcStats(todayBT);
  const btAllStats = calcStats(allBT);
  const totalSignals = btTodayStats.total || signals.length;
  const takenTrades = todayS.taken;
  const notTakenCount = Math.max(0, totalSignals - takenTrades);
  const children = [
    ...buildCoverPage(mom.format("DD/MM/YY"), signals, bearish, bullish),
    sectionHdr("Trade Taken", "1F3864"),
    ...(takenSignals.length ? takenSignals.flatMap(s => buildCompactCard(s)) : [Para([TR("No trades taken today.", { color: "888888" })], { spacing: { before: 200, after: 200 } })]),
    new Paragraph({ children: [new PageBreak()] }),
    sectionHdr("Trade Not Taken", "4A235A"),
    ...(notTakenSignals.length ? notTakenSignals.flatMap(s => buildCompactCard(s)) : [Para([TR("All signals were taken today.", { color: "888888" })], { spacing: { before: 200, after: 200 } })]),
    new Paragraph({ children: [new PageBreak()] }),
    ...buildStatsPage(mom.format("DD-MMM"), todayS, prevS, allTimeS, btTodayStats, btAllStats, totalSignals, takenTrades, notTakenCount, takenSignals, notTakenSignals),
  ];
  return new Document({
    styles: { default: { document: { run: { font: "Arial", size: 20, color: CLR.textDark } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1008, right: 1008, bottom: 1008, left: 1008 } } }, children }],
  });
}

async function sendEODTelegram(dateStr, signals, liveData, liveAll, todayBT, allBT) {
  const dateLabel = moment(dateStr, "YYYY-MM-DD").format("DD-MMM");
  const dateFull = moment(dateStr, "YYYY-MM-DD").format("ddd DD MMM YYYY");
  const todayS = liveData.todaySummary;
  const allTimeS = liveAll.summary;
  const btToday = calcStats(todayBT);
  const btAll = calcStats(allBT);
  const totalSignals = btToday.total || signals.length;
  const takenTrades = todayS.taken;
  const notTakenCount = Math.max(0, totalSignals - takenTrades);
  const netPLStr = `${fmtRs(todayS.netPL)} , ${fmtPts(todayS.realizedPL)} pts`;
  const allNetPLStr = `${fmtRs(allTimeS.netPL)} , ${fmtPts(allTimeS.realizedPL)} pts`;
  const L = 22, R = 22;
  function row(leftLabel, leftVal, rightLabel, rightVal) { return `${leftLabel}: ${leftVal}`.padEnd(L) + `${rightLabel}: ${rightVal}`; }
  const btHeader = `${"🔬 " + dateLabel + " BACKTEST"}`.padEnd(L) + `📊 ALL-TIME BACKTEST`;
  const btDivider = "─".repeat(L + R);
  const btRows = [
    row("Signals Today", String(btToday.total), "Total Signals", String(btAll.total)),
    row("Resolved", String(btToday.resolved), "Resolved", String(btAll.resolved)),
    row("TARGET HIT ✅", String(btToday.winners), "TARGET HIT ✅", String(btAll.winners)),
    row("SL HIT ❌", String(btToday.losers), "SL HIT ❌", String(btAll.losers)),
    row("Open ⏳", String(btToday.open), "Open ⏳", String(btAll.open)),
    row("Win Rate", pct(btToday.winRate), "Win Rate", pct(btAll.winRate)),
    row("Total PnL", fmtPts(btToday.netPnl) + " pts", "Total PnL", fmtPts(btAll.netPnl) + " pts"),
  ];
  const sep = "━━━━━━━━━━━━━━━━━━━━━━━━━━";
  const lines = [
    `🟡 *Report*`, `📅 *${dateFull}*`, sep, `📋  *${dateLabel} TRADES*`, sep,
    `Total Signals : *${totalSignals}*`, `Taken Trades  : ${String(takenTrades).padStart(2, "0")}`,
    `Not Taken     : ${notTakenCount}`,
    `Balance       : Rs. ${Number(CFG.balance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
    `Current Bal.  : Rs. ${Number(CFG.currentBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
    ``, sep, `📈 *${dateLabel} LIVE TRADING*`, sep,
    `Total         : ${todayS.completed}`, `Completed     : ${String(todayS.completed).padStart(2, "0")}`,
    `Wins ✅       : ${todayS.wins}`, `Losses ❌     : ${todayS.losses}`, `Open ⏳       : ${todayS.open}`,
    `Win Rate      : ${pct(todayS.winRate)}`, `Net P/L       : ${netPLStr}`,
    `Brokerage     : Rs. ${Math.abs(todayS.brok).toFixed(2)}`, `Taxes & Fees  : Rs. ${Math.abs(todayS.tax).toFixed(2)}`,
    ``, sep, `📊 *ALL-TIME LIVE TRADING*`, sep,
    `Completed     : *${allTimeS.total}*`, `Wins ✅       : ${allTimeS.wins}`, `Losses ❌     : ${allTimeS.losses}`,
    `Open ⏳       : ${allTimeS.open}`, `Win Rate      : ${pct(allTimeS.winRate)}`, `Net P/L       : ${allNetPLStr}`,
    `Brokerage     : Rs. ${Math.abs(allTimeS.brok).toFixed(2)}`, `Taxes & Fees  : Rs. ${Math.abs(allTimeS.tax).toFixed(2)}`,
    ``, "```", btHeader, btDivider, ...btRows, "```", ``, `3C Candle Break Strategy`,
  ];
  const message = lines.join("\n");
  if (!CFG.telegramToken || !CFG.telegramChat) { console.log("\n[TELEGRAM PREVIEW]\n" + message); return message; }
  try {
    let Bot; try { Bot = require("node-telegram-bot-api"); } catch (_) { Bot = require(path.join(require("child_process").execSync("npm root -g").toString().trim(), "node-telegram-bot-api")); }
    const bot = new Bot(CFG.telegramToken, { polling: false });
    await bot.sendMessage(CFG.telegramChat, message, { parse_mode: "Markdown" });
    console.log("  [TG] EOD sent ✅");
  } catch (err) { console.warn("  ⚠️  Telegram failed:", err.message); console.log("\n[MESSAGE]\n" + message); }
  return message;
}

async function generateDocxAndTelegram(opts = {}) {
  const dateStr = opts.dateStr || todayIST();
  const outDir = opts.outputDir || CFG.outputDir;
  console.log(`\n📋 [3C Summary] ${dateStr}`);
  const signals = opts.signals || readAllSignals(dateStr);
  console.log(`  Signals: ${signals.length} (${signals.filter(s => String(s.direction || "").includes("BULL")).length} bullish)`);
  const { today: btToday, allTime: btAll } = await readBacktestResults(dateStr);
  console.log(`  Backtest: today=${btToday.length} allTime=${btAll.length}`);
  const neostoxFile = opts.neostoxFile || CFG.neostoxFile;
  const neostoxDir = opts.neostoxDir || CFG.neostoxDir;
  const empty = {
    takenSymbols: new Set(),
    todaySummary: { taken: 0, completed: 0, wins: 0, losses: 0, open: 0, winRate: 0, netPL: 0, realizedPL: 0, brok: 0, tax: 0 },
    prevSummary: { completed: 0, wins: 0, losses: 0, open: 0, netPL: 0, realizedPL: 0, brok: 0, tax: 0 },
    allTimeSummary: { total: 0, open: 0, wins: 0, losses: 0, winRate: 0, netPL: 0, realizedPL: 0, brok: 0, tax: 0 },
    completed: [], open: [], realizedPL: 0,
    summary: { total: 0, open: 0, wins: 0, losses: 0, winRate: 0, netPL: 0, realizedPL: 0, brok: 0, tax: 0 },
  };
  const liveData = parseNeoStoxFile(neostoxFile, dateStr) || empty;
  const liveAll = readAllNeoStoxTrades(neostoxDir, neostoxFile, dateStr);
  console.log(`  Live: taken=${liveData.todaySummary.taken} completed=${liveData.todaySummary.completed}`);
  let docxPath = null;
  if (!opts.telegramOnly) {
    const doc = buildDocx(dateStr, signals, liveData, liveAll, btToday, btAll);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    docxPath = path.join(outDir, `${moment(dateStr, "YYYY-MM-DD").format("DD-MMM")}_3C_signal_summary.docx`);
    fs.writeFileSync(docxPath, await Packer.toBuffer(doc));
    console.log(`  💾 Word doc: ${docxPath}`);
  }
  if (!opts.docOnly) await sendEODTelegram(dateStr, signals, liveData, liveAll, btToday, btAll);
  return { docxPath };
}

module.exports = {
  generateDocxAndTelegram,
  sendEODTelegram,
  readBacktestResults,
  parseNeoStoxFile,
  calcStats,
  readAllSignals,
  appendSignalToFile,
  parseTelegramMessage,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const dateArg = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a))
    || (args.find(a => a.startsWith("--date=")) || "").split("=")[1]
    || null;
  generateDocxAndTelegram({
    dateStr: dateArg || todayIST(),
    telegramOnly: args.includes("--telegram-only"),
    docOnly: args.includes("--doc-only"),
  })
    .then(({ docxPath }) => { if (docxPath) console.log(`\n✅ Done: ${docxPath}`); process.exit(0); })
    .catch(err => { console.error("❌", err.message, "\n", err.stack); process.exit(1); });
}