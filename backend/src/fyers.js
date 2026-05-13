/**
 * Fyers API v3 — using fyers-api-v3 npm package
 * Token is read from fyers_access_token.txt (written by generate.js)
 *
 * FIXES vs previous version:
 *   • validateToken() uses a hard 8s timeout — never hangs on weekends/after-hours
 *   • fetchCandles() uses a hard 15s timeout per attempt — same reason
 *   • Both use Promise.race() with a rejectAfter helper (Fyers SDK exposes no timeout option)
 */

const fs = require("fs");
const path = require("path");
const { fyersModel } = require("fyers-api-v3");

const ROOT = path.resolve(__dirname, "..");
const TOKEN_FILE = path.join(ROOT, "fyers_access_token.txt");
const REFRESH_FILE = path.join(ROOT, "fyers_refresh_token.txt");

// ── Timeout helper ────────────────────────────────────────────────────────────
function rejectAfter(ms, label) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`[Fyers] ${label} timed out after ${ms}ms`)), ms)
  );
}

// ── Token helpers ─────────────────────────────────────────────────────────────
function loadToken() {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  return fs.readFileSync(TOKEN_FILE, "utf8").trim();
}

function saveToken(token) {
  fs.writeFileSync(TOKEN_FILE, token.trim(), "utf8");
  fs.writeFileSync(path.join(ROOT, ".fyers_token"), token.trim(), "utf8");
}

// ── Build authenticated fyersModel instance ───────────────────────────────────
function getFyersClient() {
  const token = loadToken();
  if (!token) throw new Error("No access token. Run: node src/generate.js");

  const appId = process.env.APP_ID;
  if (!appId) throw new Error("APP_ID missing in .env");

  const fyers = new fyersModel({ path: "", enableLogging: false });
  fyers.setAppId(appId);
  fyers.setRedirectUrl("https://trade.fyers.in/api-login/redirect-uri/index.html");
  fyers.setAccessToken(token);
  return fyers;
}

// ── Auth URL ──────────────────────────────────────────────────────────────────
function getAuthURL() {
  const appId = process.env.APP_ID;
  if (!appId) throw new Error("APP_ID not set in .env");
  const fyers = new fyersModel({ path: "", enableLogging: false });
  return fyers.generateAuthCode({
    client_id: appId,
    redirect_uri: "https://trade.fyers.in/api-login/redirect-uri/index.html",
    response_type: "code",
    state: "sample_state",
  });
}

// ── Generate token from auth_code ─────────────────────────────────────────────
async function generateToken(authCode) {
  const appId = process.env.APP_ID;
  const secretKey = process.env.ST_KEY;
  if (!appId || !secretKey) throw new Error("APP_ID / ST_KEY missing in .env");

  const fyers = new fyersModel({ path: "", enableLogging: false });
  const response = await fyers.generate_access_token({
    client_id: appId,
    secret_key: secretKey,
    auth_code: authCode,
    grant_type: "authorization_code",
  });

  if (response.s !== "ok") {
    throw new Error("Token exchange failed: " + JSON.stringify(response));
  }

  saveToken(response.access_token);
  if (response.refresh_token) {
    fs.writeFileSync(REFRESH_FILE, response.refresh_token.trim(), "utf8");
  }
  return response.access_token;
}

// ── Validate token ────────────────────────────────────────────────────────────
// Hard 8-second timeout. Fyers profile endpoint can hang on weekends/after-hours.
// Returns false cleanly instead of throwing — caller treats false as "not authed".
async function validateToken() {
  const token = loadToken();
  if (!token) return false;
  try {
    const fyers = getFyersClient();
    const res = await Promise.race([
      fyers.get_profile(),
      rejectAfter(8000, "validateToken"),
    ]);
    return res && res.s === "ok";
  } catch (err) {
    console.warn("[Fyers] validateToken failed:", err.message);
    return false;
  }
}

// ── Smart lookback calculator ─────────────────────────────────────────────────
// Each wave needs ~8 candles on average. We target 60 waves (buffer above 50)
// so the chart always has at least 50 visible waves.
// Calendar days = trading days × (365 / 252).
//
// Fyers API limits per resolution:
//   intraday (≤ 1h)  → max 100 days per request  (we page automatically)
//   Daily            → max 365 days
//   Weekly           → no documented limit; 10 years works fine
function calcLookbackDays(resolution) {
  const res = String(resolution).toUpperCase();
  const CANDLES_PER_WAVE = 8;   // empirical average
  const TARGET_WAVES = 60;  // fetch 60 to reliably display 50
  const CANDLES_NEEDED = TARGET_WAVES * CANDLES_PER_WAVE; // 480 candles
  const CALENDAR_RATIO = 365 / 252;

  let candlesPerTradingDay;

  if (res === "W" || res === "10080") {
    // 10 years = 3650 days = ~520 weekly candles → ~65 waves (well above 50 target).
    // Going further (5000 days = 2012) pulls in real Nifty prices ~5000–6000 which,
    // mixed with current ~24000, wrecks the price axis (giant spike candle on chart).
    // 3650 days keeps us in the post-2015 era at the correct price scale.
    return 3650;
  }

  if (res === "D" || res === "1440") {
    candlesPerTradingDay = 1;
    // 480 trading days ≈ 696 calendar days → round up to 2 years for safety
    return 730;
  }

  const mins = parseInt(res, 10) || 3;

  // Explicit overrides for resolutions where the formula under-delivers:
  //   15m: formula gives 30 days (~500 candles). 60 days (~1000 candles) ensures 50+ waves.
  //   1h : formula gives 116 days (~480 candles). 150 days gives safe buffer;
  //        chunk size is already 90 days so this becomes 2 chunks automatically.
  if (mins === 15) return 60;
  if (mins === 60) return 150;

  candlesPerTradingDay = Math.floor(375 / mins);

  const tradingDaysNeeded = Math.ceil(CANDLES_NEEDED / candlesPerTradingDay);
  const calendarDaysNeeded = Math.ceil(tradingDaysNeeded * CALENDAR_RATIO);

  // Ensure a sensible minimum even for very short timeframes
  return Math.max(30, calendarDaysNeeded);
}

// ── Fetch historical candles ──────────────────────────────────────────────────
// Fyers API limits: intraday ≤ 100 days per request, daily/weekly = no hard limit.
// For intraday resolutions that need > 100 days we automatically page in 90-day
// chunks and merge all results chronologically.
async function fetchCandles(symbol, resolution, count = 10000) {
  const fyers = getFyersClient();

  const now = Math.floor(Date.now() / 1000);

  const isWeekly = resolution === 10080 || String(resolution).toUpperCase() === "W";
  const isDaily = resolution === 1440 || String(resolution).toUpperCase() === "D";
  const fyersResolution = isWeekly ? "W" : isDaily ? "D" : String(resolution);

  const lookbackDays = calcLookbackDays(resolution);

  // Fyers API max date range per single request:
  //   Intraday (≤ 1h) → 100 days
  //   Daily           → 365 days
  //   Weekly          → ~365 days (Fyers rejects ranges > ~400 days as "Invalid input")
  // We chunk safely below each limit.
  const CHUNK_DAYS = isWeekly ? 300 : isDaily ? 360 : 90;

  // Larger timeout for daily/weekly requests (more data, slower response)
  const FETCH_TIMEOUT_MS = isWeekly ? 30_000 : isDaily ? 20_000 : 15_000;

  async function fetchChunk(from, to) {
    return Promise.race([
      fyers.getHistory({
        symbol,
        resolution: fyersResolution,
        date_format: "0",
        range_from: String(from),
        range_to: String(to),
        cont_flag: "1",
      }),
      rejectAfter(FETCH_TIMEOUT_MS, `fetchCandles(${symbol} res=${fyersResolution} chunk)`),
    ]);
  }

  // IST offset: +5:30 = 330 minutes
  const IST_OFFSET_S = 5.5 * 3600;
  // 09:15 IST = 03:45 UTC = 225 minutes from midnight UTC
  const MARKET_OPEN_UTC_MINS = 3 * 60 + 45;

  function normalizeTimestamp(epochSec) {
    if (isWeekly || isDaily) {
      // Fyers daily/weekly timestamps can be midnight, 09:15, or end-of-day.
      // Normalize all to 09:15 IST of that trading day so the chart series
      // never gets duplicate or out-of-order timestamps.
      const istMidnightSec = Math.floor((epochSec + IST_OFFSET_S) / 86400) * 86400 - IST_OFFSET_S;
      return istMidnightSec + MARKET_OPEN_UTC_MINS * 60;
    }
    return epochSec;
  }

  function parseCandles(res) {
    if (!res || res.s !== "ok") return null;
    return (res.candles || [])
      .map((c) => ({
        time: normalizeTimestamp(c[0]) * 1000,
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        volume: c[5],
      }))
      .filter(
        (c) =>
          Number.isFinite(c.time) && c.time > 0 &&
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close)
      );
  }

  // Build list of [from, to] chunks covering the full lookback period
  const chunkSizeMs = CHUNK_DAYS * 24 * 60 * 60; // seconds
  const totalFrom = now - lookbackDays * 24 * 60 * 60;

  const chunks = [];
  let chunkEnd = now;
  while (chunkEnd > totalFrom) {
    const chunkStart = Math.max(totalFrom, chunkEnd - chunkSizeMs);
    chunks.unshift({ from: chunkStart, to: chunkEnd }); // oldest first
    chunkEnd = chunkStart - 1;
  }

  const allCandles = [];

  for (const chunk of chunks) {
    let res = null;
    try {
      res = await fetchChunk(chunk.from, chunk.to);
    } catch (err) {
      console.warn(`[Fyers] Chunk fetch failed (${err.message}) — skipping chunk`);
      continue;
    }

    const parsed = parseCandles(res);
    if (parsed) {
      allCandles.push(...parsed);
    } else {
      console.warn(`[Fyers] Chunk returned error: ${res?.message || res?.errmsg || "unknown"}`);
    }
  }

  if (allCandles.length === 0) {
    throw new Error(`Fyers getHistory returned no candles for ${symbol} res=${fyersResolution}`);
  }

  // Deduplicate by timestamp (overlap between chunks) and sort ascending
  const seen = new Set();
  let deduped = allCandles
    .filter((c) => {
      if (seen.has(c.time)) return false;
      seen.add(c.time);
      return true;
    })
    .sort((a, b) => a.time - b.time);

  // ── Recency guard for weekly data ─────────────────────────────────────────
  // Fyers weekly endpoint returns candles going back to Nifty's inception (~1990s).
  // We enforce a hard timestamp cutoff matching the requested lookback window.
  // This is sufficient to prevent ancient pre-2016 candles from corrupting the
  // chart's price axis. A separate price floor is NOT used because Fyers occasionally
  // returns adjusted/continuous prices that may not match spot index levels exactly.
  if (isWeekly && deduped.length > 0) {
    const cutoffMs = (now - lookbackDays * 24 * 60 * 60) * 1000;
    const before = deduped.length;
    deduped = deduped.filter((c) => c.time >= cutoffMs);
    if (deduped.length !== before) {
      console.log(
        `[Fyers] Weekly timestamp filter removed ${before - deduped.length} out-of-range candles (kept ${deduped.length})`
      );
    }
    if (deduped.length === 0) {
      throw new Error(
        `[Fyers] Weekly candles all filtered out — check symbol or date range`
      );
    }
  }

  console.log(`[Fyers] ${symbol} ${fyersResolution}: fetched ${deduped.length} candles over ${lookbackDays}d (${chunks.length} chunk${chunks.length > 1 ? "s" : ""})`);

  return deduped;
}

module.exports = { loadToken, saveToken, getAuthURL, generateToken, validateToken, fetchCandles };