const ExcelJS = require("exceljs");
const moment = require("moment");
const path = require("path");
const fs = require("fs");

const REPORT_FILE = path.resolve("pattern_signals.xlsx");
const SHEET_NAME = "Signals";

const HEADERS = [
  { header: "Pattern ID", key: "patternId", width: 30 },
  { header: "Symbol", key: "symbol", width: 14 },
  { header: "Crossover Type", key: "crossoverType", width: 20 },
  { header: "Crossover Time", key: "crossoverTime", width: 22 },
  { header: "Crossover Price", key: "crossoverPrice", width: 18 },
  { header: "Pullback Time", key: "pullbackTime", width: 22 },
  { header: "Pullback Open", key: "pullbackOpen", width: 18 },
  { header: "Pullback Close", key: "pullbackClose", width: 18 },
  { header: "Pullback Low/High", key: "pullbackExtreme", width: 20 },
  { header: "Pullback EMA9", key: "pullbackEma9", width: 18 },
  { header: "Confirm Time", key: "confirmTime", width: 22 },
  { header: "Confirm Open", key: "confirmOpen", width: 18 },
  { header: "Confirm Close", key: "confirmClose", width: 18 },
  { header: "Confirm EMA9", key: "confirmEma9", width: 18 },
  { header: "Entry Price", key: "entryPrice", width: 18 },
  { header: "Stop Loss", key: "stopLoss", width: 18 },
  { header: "Target T1", key: "targetT1", width: 18 },
  { header: "Target T2", key: "targetT2", width: 18 },
  { header: "Candle Span", key: "candlesBetween", width: 14 },
  { header: "Run Type", key: "runType", width: 16 },
  { header: "Detected At", key: "detectedAt", width: 22 },
];

const HEADER_FONT = { name: "Arial", bold: true, size: 11, color: { argb: "FFFFFFFF" } };
const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
const HEADER_ALIGN = { horizontal: "center", vertical: "middle" };
const BORDER = { style: "thin", color: { argb: "FFBFBFBF" } };
const CELL_BORDER = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
const BULL_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };
const BEAR_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } };
const PRICE_FMT = '"₹"#,##0.00';
const DT_FMT = "YYYY-MM-DD HH:mm";

// Price columns by 1-based index (crossoverPrice=5, then pullback/confirm/entry/sl/t1/t2)
const PRICE_COLS = [5, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18];

// ─── Workbook helpers ────────────────────────────────────────────────────────

async function loadOrCreate() {
  const workbook = new ExcelJS.Workbook();
  const fileExists = fs.existsSync(REPORT_FILE);

  if (fileExists) {
    await workbook.xlsx.readFile(REPORT_FILE);
  }

  let ws = workbook.getWorksheet(SHEET_NAME);

  if (!ws) {
    ws = workbook.addWorksheet(SHEET_NAME, {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    ws.columns = HEADERS;

    const headerRow = ws.getRow(1);
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
      cell.font = HEADER_FONT;
      cell.fill = HEADER_FILL;
      cell.alignment = HEADER_ALIGN;
      cell.border = CELL_BORDER;
    });
    headerRow.commit();

    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: HEADERS.length },
    };
  } else {
    // Re-apply column key mappings — ExcelJS loses them after readFile()
    ws.columns = HEADERS.map((h, i) => ({
      key: h.key,
      width: ws.getColumn(i + 1).width || h.width,
    }));
  }

  return { workbook, ws };
}

function patternExists(ws, patternId) {
  let found = false;
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    if (row.getCell(1).value === patternId) found = true;
  });
  return found;
}

function styleDataRow(row, isBullish) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = isBullish ? BULL_FILL : BEAR_FILL;
    cell.border = CELL_BORDER;
    cell.font = { name: "Arial", size: 10 };
  });
}

// ─── Tiered exits (mirrors calcTieredExits in index.js) ─────────────────────

function calcTieredExits(entryPrice, sl, isBullish) {
  const risk = isBullish
    ? +(entryPrice - sl).toFixed(2)
    : +(sl - entryPrice).toFixed(2);
  const t1 = isBullish
    ? +(entryPrice + risk * 1).toFixed(2)
    : +(entryPrice - risk * 1).toFixed(2);
  const t2 = isBullish
    ? +(entryPrice + risk * 2).toFixed(2)
    : +(entryPrice - risk * 2).toFixed(2);
  return { t1, t2 };
}

// ─── Pattern ID (mirrors index.js) ──────────────────────────────────────────

function generatePatternId(symbol, pattern) {
  const crossoverTs = pattern.crossover.timestampUnix;
  const confirmTs = pattern.confirmationCandle.timestampUnix;
  const typePrefix = pattern.crossoverType === "BULLISH_CROSSOVER" ? "BULL" : "BEAR";
  return `${symbol}_${typePrefix}_${crossoverTs}_${confirmTs}`;
}

// ─── Main export ─────────────────────────────────────────────────────────────
// NOTE: bcvc parameter kept for backwards-compatible call signature but is unused.

async function writePatternToExcel(symbol, pattern, isFirstRun, SEND_FIRST_RUN_NOTIFICATIONS, _bcvc) {
  const shouldRecord = !isFirstRun || (isFirstRun && SEND_FIRST_RUN_NOTIFICATIONS);
  if (!shouldRecord) return;

  const patternId = generatePatternId(symbol, pattern);
  const isBullish = pattern.crossoverType === "BULLISH_CROSSOVER";

  const pb = pattern.pullbackCandle;
  const cf = pattern.confirmationCandle;

  // pullbackExtreme = low for bullish setup, high for bearish setup
  const pullbackExtreme = isBullish ? pb.low : pb.high;

  const { t1, t2 } = calcTieredExits(pattern.entryPrice, pattern.stopLoss, isBullish);

  const runType = isFirstRun
    ? (SEND_FIRST_RUN_NOTIFICATIONS ? "FIRST RUN (notified)" : "FIRST RUN (silent)")
    : "SCHEDULED";

  const { workbook, ws } = await loadOrCreate();

  if (patternExists(ws, patternId)) {
    console.log(`📊 Excel: Already recorded — ${patternId}`);
    return;
  }

  const row = ws.addRow({
    patternId,
    symbol,
    crossoverType: isBullish ? "BULLISH" : "BEARISH",
    crossoverTime: pattern.summary.crossoverTime,
    crossoverPrice: pattern.summary.crossoverPrice,
    pullbackTime: pb.timestamp,
    pullbackOpen: pb.open,
    pullbackClose: pb.close,
    pullbackExtreme,
    pullbackEma9: pb.ema9,
    confirmTime: cf.timestamp,
    confirmOpen: cf.open,
    confirmClose: cf.close,
    confirmEma9: cf.ema9,
    entryPrice: pattern.entryPrice,
    stopLoss: pattern.stopLoss,
    targetT1: t1,
    targetT2: t2,
    candlesBetween: pattern.candlesBetween,
    runType,
    detectedAt: moment().format(DT_FMT),
  });

  PRICE_COLS.forEach((col) => {
    const cell = row.getCell(col);
    if (cell.value != null) cell.numFmt = PRICE_FMT;
  });

  styleDataRow(row, isBullish);
  row.commit();

  await workbook.xlsx.writeFile(REPORT_FILE);
  console.log(`📊 Excel saved — ${patternId} | Entry: ₹${pattern.entryPrice} | SL: ₹${pattern.stopLoss} | T1: ₹${t1} | T2: ₹${t2}`);
}

module.exports = { writePatternToExcel };