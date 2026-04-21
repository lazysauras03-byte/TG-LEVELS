
const fs = require("fs");
const moment = require("moment");

function parseHtmlTable(filePath) {
  const html = fs.readFileSync(filePath, "utf8");
  const rows = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const cells = [];
    const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let tdMatch;
    while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
      const text = tdMatch[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
      cells.push(text);
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function findHeaderRow(rows) {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some(c => c === "Date") && rows[i].some(c => c === "Instrument")) return i;
  }
  return -1;
}

function parseTimestamp(raw) {
  if (!raw) return null;
  // Extract "M/D/YYYY, HH:mm:ss AM/PM" pattern
  const m1 = raw.match(/(\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM))/i);
  if (m1) {
    const m = moment(m1[1].trim(), "M/D/YYYY, h:mm:ss A");
    if (m.isValid()) return m;
  }
  const m2 = moment(raw.trim());
  return m2.isValid() ? m2 : null;
}

function parsePrice(raw) {
  if (!raw || raw === "-" || raw.trim() === "") return null;
  const match = raw.toString().replace(/,/g, "").match(/^-?[\d]+\.?\d*/);
  return match ? parseFloat(match[0]) : null;
}

function parsePnL(raw) {
  if (!raw || raw === "-" || raw.trim() === "") return null;
  const clean = raw.toString().replace(/,/g, "").trim();
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

function normalizeSymbol(instrument) {
  return instrument
    .replace(/\s+\d{1,2}\s+\w{3}\s+\d{4}\s+\w+$/i, "")
    .trim();
}

function parseNeoStoxTrades(filePath) {
  const rows = parseHtmlTable(filePath);
  const headerIdx = findHeaderRow(rows);
  if (headerIdx === -1) throw new Error("Could not find header row");

  const headers = rows[headerIdx];
  const dataRows = rows.slice(headerIdx + 1);

  const col = name => headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));
  const colDate = col("Date");
  const colInstr = col("Instrument");
  const colOrd = col("Ord Type");
  const colQty = col("Quantity");
  const colEntry = col("Entry Price");
  const colExit = col("Exit Price");
  const colPnL = col("Net P/L");
  const colTarget = col("Target");
  const colSL = col("StopLoss");

  const buys = [], sells = [];

  for (const row of dataRows) {
    if (!row[colDate] || row[colDate].length < 5) continue;
    const ordType = (row[colOrd] || "").toUpperCase();
    if (!ordType.includes("BUY") && !ordType.includes("SELL")) continue;

    const ts = parseTimestamp(row[colDate]);
    if (!ts) continue;

    const entryPrice = parsePrice(row[colEntry]);
    const exitPrice = parsePrice(row[colExit]);
    const netPnL = parsePnL(row[colPnL]);

    const obj = {
      raw_date: row[colDate],
      timestamp: ts,
      instrument: (row[colInstr] || "").trim(),
      symbol: normalizeSymbol((row[colInstr] || "").trim()),
      ord_type: ordType,
      qty: parseInt(row[colQty]) || 0,
      entry_price: entryPrice,
      exit_price: exitPrice,
      net_pnl: netPnL,
      target: parsePrice(row[colTarget]),
      stop_loss: parsePrice(row[colSL]),
    };

    // BUY row has entry_price set; SELL row has exit_price + net_pnl set
    if (ordType.includes("BUY") && entryPrice !== null) {
      buys.push(obj);
    } else if (ordType.includes("SELL") && exitPrice !== null && netPnL !== null) {
      sells.push(obj);
    } else if (ordType.includes("BUY") && entryPrice === null && netPnL !== null) {
      // Closing BUY (covering a short)
      sells.push(obj);
    } else if (ordType.includes("SELL") && entryPrice !== null) {
      // Opening SELL (short entry)
      buys.push({ ...obj, entry_price: entryPrice, direction: "SELL" });
    }
  }

  const trades = [];
  const usedSells = new Set();

  for (const buy of buys) {
    // Find first matching SELL for same instrument after buy time
    const sellIdx = sells.findIndex((s, i) =>
      !usedSells.has(i) &&
      normalizeSymbol(s.instrument) === buy.symbol &&
      s.timestamp.isSameOrAfter(buy.timestamp)
    );

    if (sellIdx !== -1) {
      const sell = sells[sellIdx];
      usedSells.add(sellIdx);

      const direction = buy.direction || "BUY";
      const entryP = buy.entry_price;
      const exitP = sell.exit_price || sell.entry_price;

      trades.push({
        symbol: buy.symbol,
        instrument: buy.instrument,
        entry_time: buy.timestamp.format("YYYY-MM-DD HH:mm:ss"),
        exit_time: sell.timestamp.format("YYYY-MM-DD HH:mm:ss"),
        entry_time_moment: buy.timestamp,
        exit_time_moment: sell.timestamp,
        direction,
        qty: buy.qty || sell.qty,
        entry_price: entryP,
        exit_price: exitP,
        target: buy.target,
        stop_loss: buy.stop_loss,
        net_pnl: sell.net_pnl,
        trade_date: buy.timestamp.format("YYYY-MM-DD"),
      });
    } else {
      // Open trade — no matching sell found
      trades.push({
        symbol: buy.symbol,
        instrument: buy.instrument,
        entry_time: buy.timestamp.format("YYYY-MM-DD HH:mm:ss"),
        exit_time: null,
        entry_time_moment: buy.timestamp,
        exit_time_moment: null,
        direction: buy.direction || "BUY",
        qty: buy.qty,
        entry_price: buy.entry_price,
        exit_price: null,
        target: buy.target,
        stop_loss: buy.stop_loss,
        net_pnl: null,
        trade_date: buy.timestamp.format("YYYY-MM-DD"),
      });
    }
  }

  trades.sort((a, b) => a.entry_time.localeCompare(b.entry_time));
  console.log(`✅ Parsed ${trades.length} trades (${trades.filter(t => t.net_pnl === null).length} open, ${trades.filter(t => t.net_pnl !== null).length} closed)`);
  return trades;
}

module.exports = { parseNeoStoxTrades, normalizeSymbol };