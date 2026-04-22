
// loadStocks.js  — added TEST_SYMBOLS support
const XLSX = require("xlsx");
const path = require("path");
const logger = require("./utils/logger");

function loadStocks(filePath = "./stocks.xlsx", column = "symbol") {

    // ── TEST MODE: override with env var ──────────────────────────────────
    // Set in .env:  TEST_SYMBOLS=NSE:TORNTPHARM-EQ,NSE:TITAN-EQ
    // Or hardcode below for quick runs (comment out when done)
    if (process.env.TEST_SYMBOLS) {
        const overrides = process.env.TEST_SYMBOLS
            .split(",")
            .map(s => s.trim().toUpperCase())
            .filter(s => s.includes(":") && s.length > 4);
        if (overrides.length) {
            logger.info(`🧪 TEST MODE — symbols: ${overrides.join(", ")}`);
            return overrides;
        }
    }

    // ── Normal Excel load ─────────────────────────────────────────────────
    const absPath = path.resolve(filePath);
    let workbook;
    try {
        workbook = XLSX.readFile(absPath);
    } catch (err) {
        logger.error(`❌ Cannot read Excel at ${absPath}: ${err.message}`);
        process.exit(1);
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (!rows.length) { logger.error("❌ Excel is empty."); process.exit(1); }

    const key = Object.keys(rows[0]).find(
        k => k.trim().toLowerCase() === column.toLowerCase()
    );
    if (!key) {
        logger.error(`❌ Column "${column}" not found. Available: ${Object.keys(rows[0]).join(", ")}`);
        process.exit(1);
    }

    const valid = rows
        .map(r => String(r[key] || "").trim().toUpperCase())
        .filter(s => s && s.includes(":") && s.length > 4);

    const invalid = rows
        .map(r => String(r[key] || "").trim())
        .filter(s => s && !s.includes(":"));
    if (invalid.length) logger.warn(`⚠️  Skipped ${invalid.length} invalid rows.`);

    logger.info(`✅ Loaded ${valid.length} symbols from ${path.basename(absPath)}`);
    return valid;
}

function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
}

module.exports = { loadStocks, chunkArray };