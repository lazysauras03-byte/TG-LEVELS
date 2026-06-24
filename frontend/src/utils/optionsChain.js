// utils/optionsChain.js
// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers for OptionsChainModal.
// Supports: NSE equities, NSE/BSE indices, MCX commodities.
// ─────────────────────────────────────────────────────────────────────────────

// ── Month codes ───────────────────────────────────────────────────────────────
const MONTH_CODES = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

// ── MCX commodity config ──────────────────────────────────────────────────────
// strikeStep  — interval between strikes (in ₹ per unit)
// decimals    — decimal places in strike price
// unit        — traded unit label shown in the options chain header
export const MCX_COMMODITIES = {
  GOLD:        { name: "Gold",             strikeStep: 100,  decimals: 0, unit: "10g",   exchange: "MCX" },
  GOLDM:       { name: "Gold Mini",        strikeStep: 100,  decimals: 0, unit: "100g",  exchange: "MCX" },
  GOLDPETAL:   { name: "Gold Petal",       strikeStep: 50,   decimals: 0, unit: "1g",    exchange: "MCX" },
  SILVER:      { name: "Silver",           strikeStep: 500,  decimals: 0, unit: "1kg",   exchange: "MCX" },
  SILVERM:     { name: "Silver Mini",      strikeStep: 500,  decimals: 0, unit: "100g",  exchange: "MCX" },
  SILVERMIC:   { name: "Silver Micro",     strikeStep: 100,  decimals: 0, unit: "1kg",   exchange: "MCX" },
  CRUDEOIL:    { name: "Crude Oil",        strikeStep: 50,   decimals: 0, unit: "bbl",   exchange: "MCX" },
  CRUDEOILM:   { name: "Crude Oil Mini",   strikeStep: 50,   decimals: 0, unit: "bbl",   exchange: "MCX" },
  NATURALGAS:  { name: "Natural Gas",      strikeStep: 5,    decimals: 1, unit: "mmBtu", exchange: "MCX" },
  NATGASMINI:  { name: "Natural Gas Mini", strikeStep: 5,    decimals: 1, unit: "mmBtu", exchange: "MCX" },
  COPPER:      { name: "Copper",           strikeStep: 5,    decimals: 1, unit: "1kg",   exchange: "MCX" },
  ZINC:        { name: "Zinc",             strikeStep: 1,    decimals: 1, unit: "1kg",   exchange: "MCX" },
  ZINCMINI:    { name: "Zinc Mini",        strikeStep: 1,    decimals: 1, unit: "1kg",   exchange: "MCX" },
  LEAD:        { name: "Lead",             strikeStep: 1,    decimals: 1, unit: "1kg",   exchange: "MCX" },
  LEADMINI:    { name: "Lead Mini",        strikeStep: 1,    decimals: 1, unit: "1kg",   exchange: "MCX" },
  NICKEL:      { name: "Nickel",           strikeStep: 10,   decimals: 0, unit: "1kg",   exchange: "MCX" },
  ALUMINIUM:   { name: "Aluminium",        strikeStep: 1,    decimals: 1, unit: "1kg",   exchange: "MCX" },
  MENTHAOIL:   { name: "Mentha Oil",       strikeStep: 1,    decimals: 1, unit: "kg",    exchange: "MCX" },
  COTTON:      { name: "Cotton",           strikeStep: 100,  decimals: 0, unit: "bale",  exchange: "MCX" },
  CASTORSEED:  { name: "Castor Seed",      strikeStep: 50,   decimals: 0, unit: "100kg", exchange: "MCX" },
};

// ── MCX expiry-day approximations ─────────────────────────────────────────────
// Used to decide which contract month to start from — MUST stay in sync with
// symbolsRouter.js MCX_EXPIRY_DAY so commodity, futures, and options chain
// always show the same contract month.
// Rule: only roll forward to next month once today is PAST (expiryDay + grace)
// — never roll early. See symbolsRouter.js for the full rationale.
const MCX_EXPIRY_DAY = {
  CRUDEOIL: 19, CRUDEOILM: 19,
  NATURALGAS: 23, NATGASMINI: 23,
  COPPER: 22, ZINC: 22, ZINCMINI: 22,
  ALUMINIUM: 22, LEAD: 22, LEADMINI: 22, NICKEL: 22,
  GOLD: 5, GOLDM: 29, GOLDPETAL: 29,
  SILVER: 27, SILVERM: 27, SILVERMIC: 27,
  MENTHAOIL: 29, COTTON: 29, CASTORSEED: 29,
};
const EXPIRY_GRACE_DAYS = 1; // roll this many days AFTER the approx expiry (never before)

// Commodities that trade WEEKLY options (every Friday expiry on MCX)
export const WEEKLY_EXPIRY_COMMODITIES = new Set(["SILVERMIC"]);

// ── NSE index option roots ────────────────────────────────────────────────────
const NSE_INDEX_ROOTS = {
  "NIFTY50-INDEX":    "NIFTY",
  "NIFTYBANK-INDEX":  "BANKNIFTY",
  "CNXFINANCE-INDEX": "FINNIFTY",
  "CNXIT-INDEX":      "NIFTYIT",
  "MIDCPNIFTY-INDEX": "MIDCPNIFTY",
  "SENSEX-INDEX":     "SENSEX",   // BSE
};

// ── Parse an underlying symbol → { exch, root, isIndex, isCommodity, strikeStep, decimals } ──
export function getOptionRoot(symbolStr) {
  if (!symbolStr) return { exch: "NSE", root: "", isIndex: false, isCommodity: false, strikeStep: 50, decimals: 0 };

  const colonIdx = symbolStr.indexOf(":");
  const exch   = colonIdx >= 0 ? symbolStr.slice(0, colonIdx) : "NSE";
  const ticker = colonIdx >= 0 ? symbolStr.slice(colonIdx + 1) : symbolStr;

  // MCX commodity — ticker may be:
  //   "CRUDEOIL-I"        (old -I style, should not reach here anymore)
  //   "CRUDEOIL26JULFUT"  (dated future from /api/symbols, type=commodity)
  //   "NATGASMINI26JUNFUT"
  if (exch === "MCX") {
    let base = ticker.replace(/-.*$/, "");  // strip -I or any suffix after dash
    base = base.replace(/\d{2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)FUT$/i, ""); // strip dated FUT
    base = base.toUpperCase();
    const cfg = MCX_COMMODITIES[base] || { strikeStep: 50, decimals: 0 };
    return {
      exch:          "MCX",
      root:          base,
      isIndex:       false,
      isCommodity:   true,
      strikeStep:    cfg.strikeStep,
      decimals:      cfg.decimals,
      commodityName: cfg.name || base,
    };
  }

  // NSE/BSE index
  if (ticker.endsWith("-INDEX") || NSE_INDEX_ROOTS[ticker]) {
    const root = NSE_INDEX_ROOTS[ticker] || ticker.replace(/-INDEX$/, "");
    return { exch, root, isIndex: true, isCommodity: false, strikeStep: 50, decimals: 0 };
  }

  // NSE equity (e.g. RELIANCE-EQ → root = RELIANCE)
  const root = ticker.replace(/-(EQ|BE|SM|PP|N1|N2|T0)$/i, "");
  return { exch, root, isIndex: false, isCommodity: false, strikeStep: 50, decimals: 0 };
}

// ── Unified expiry roll logic ─────────────────────────────────────────────────
// Returns the month offset (0 = this month, 1 = next, ...) for the NEAR
// contract of a given MCX root — IDENTICAL to symbolsRouter.js mcxNearMonthOffset
// so the commodity tab, futures tab, and options chain all show the same month.
function mcxNearMonthOffset(root, now = new Date()) {
  const expiryDay = MCX_EXPIRY_DAY[root];
  if (!expiryDay) return 0;
  return now.getDate() > (expiryDay + EXPIRY_GRACE_DAYS) ? 1 : 0;
}

// ── Build expiry list ─────────────────────────────────────────────────────────
// Returns `count` upcoming expiry objects { label, code, date, approx }
//
// KEY DESIGN: For MCX commodities, the starting month is determined by
// mcxNearMonthOffset() — the SAME roll logic as symbolsRouter.js — so
// the first expiry shown here always matches the contract month shown
// in the Commodity tab and Futures tab of the search bar.
//
// NSE equities/indices: last Thursday of the month (exchange rule, exact).
// MCX commodities: approximate expiry day per commodity (MCX publishes exact
// date via monthly circular; `approx: true` flags this in the UI).
export function nextMonthlyExpiries(count = 3, commodityRoot = null) {
  // Silver Micro uses WEEKLY expiries (every Friday), not monthly
  if (commodityRoot && WEEKLY_EXPIRY_COMMODITIES.has(commodityRoot)) {
    return nextWeeklyExpiries(count);
  }

  const now = new Date();
  const results = [];

  // For MCX: start from the near-month offset so we match symbolsRouter
  // For NSE: start offset = 0 (current month), let the cutoff skip if passed
  const startOffset = commodityRoot ? mcxNearMonthOffset(commodityRoot, now) : 0;
  const approxDay   = commodityRoot ? MCX_EXPIRY_DAY[commodityRoot] : null;

  let year  = now.getFullYear();
  let month = now.getMonth() + startOffset; // 0-based, may exceed 11
  year  += Math.floor(month / 12);
  month  = month % 12;

  for (let i = 0; results.length < count; i++) {
    let m = month + i;
    let y = year + Math.floor(m / 12);
    m = m % 12;

    const expDate = approxDay
      ? clampToLastDayOfMonth(y, m, approxDay)
      : lastThursdayOfMonth(y, m);

    // For NSE (no approxDay), skip months whose expiry has already passed
    if (!approxDay) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 1);
      if (expDate < cutoff) continue;
    }
    // For MCX, we trust the offset calculation — no additional cutoff check
    // needed because mcxNearMonthOffset() already ensures we start fresh.

    const dd  = String(expDate.getDate()).padStart(2, "0");
    const mon = MONTH_CODES[m];
    const yy  = String(y).slice(-2);

    results.push({
      label:  `${approxDay ? "~" : ""}${dd} ${mon}`,
      code:   `${yy}${mon}`,  // e.g. "26JUL" — used in Fyers option symbol
      date:   expDate,
      approx: !!approxDay,
    });
  }
  return results;
}

// Returns upcoming Friday expiry dates (for weekly-expiry commodities like SILVERMIC)
function nextWeeklyExpiries(count = 4) {
  const results = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1); // start from tomorrow
  while (results.length < count) {
    if (d.getDay() === 5) { // Friday
      const dd  = String(d.getDate()).padStart(2, "0");
      const mon = MONTH_CODES[d.getMonth()];
      const yy  = String(d.getFullYear()).slice(-2);
      results.push({
        label:  `${dd} ${mon}`,
        code:   `${yy}${mon}`,
        date:   new Date(d),
        approx: true,
      });
    }
    d.setDate(d.getDate() + 1);
  }
  return results;
}

function clampToLastDayOfMonth(year, month, day) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

function lastThursdayOfMonth(year, month) {
  const d = new Date(year, month + 1, 0); // last day of month
  while (d.getDay() !== 4) d.setDate(d.getDate() - 1);
  return new Date(d);
}

// ── Build strike ladder centred on spot ───────────────────────────────────────
export function buildStrikeLadder(spot, indexRoot, stepsEachSide = 14, overrideStep = null) {
  if (!spot || spot <= 0) return { strikes: [], atm: null };

  let step = overrideStep;
  if (!step) {
    step = indexRoot
      ? (INDEX_STRIKE_STEPS[indexRoot] || guessStep(spot))
      : guessStep(spot);
  }

  const atm = Math.round(spot / step) * step;
  const strikes = [];
  for (let i = -stepsEachSide; i <= stepsEachSide; i++) {
    const s = atm + i * step;
    if (s > 0) strikes.push(Math.round(s * 100) / 100);
  }
  return { strikes, atm };
}

const INDEX_STRIKE_STEPS = {
  NIFTY:      50,
  BANKNIFTY:  100,
  FINNIFTY:   50,
  MIDCPNIFTY: 25,
  NIFTYIT:    50,
  SENSEX:     100,
};

function guessStep(price) {
  if (price >= 50000) return 500;
  if (price >= 10000) return 200;
  if (price >=  5000) return 100;
  if (price >=  2000) return 50;
  if (price >=  1000) return 20;
  if (price >=   500) return 10;
  if (price >=   200) return 5;
  if (price >=   100) return 2;
  if (price >=    50) return 1;
  if (price >=    10) return 0.5;
  return 0.1;
}

// ── Build Fyers option symbol string ─────────────────────────────────────────
// NSE equity:    NSE:RELIANCE26JUL3200CE
// NSE index:     NSE:NIFTY26JUL24000CE
// MCX commodity: MCX:CRUDEOIL26JUL5000CE
//                MCX:NATGASMINI26JUN310CE
export function optionSymbol(exch, root, expiryCode, strike, kind) {
  const strikeStr = Number.isInteger(strike) ? String(strike) : strike.toFixed(1);
  return `${exch}:${root}${expiryCode}${strikeStr}${kind}`;
}
