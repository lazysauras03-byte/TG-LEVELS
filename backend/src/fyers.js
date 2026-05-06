/**
 * Fyers API v3 — using fyers-api-v3 npm package
 * Token is read from fyers_access_token.txt (written by generate.js)
 */

const fs = require("fs");
const path = require("path");
const { fyersModel } = require("fyers-api-v3");

const ROOT = path.resolve(__dirname, "..");
const TOKEN_FILE = path.join(ROOT, "fyers_access_token.txt");
const REFRESH_FILE = path.join(ROOT, "fyers_refresh_token.txt");

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
async function validateToken() {
  const token = loadToken();
  if (!token) return false;
  try {
    const fyers = getFyersClient();
    const res = await fyers.get_profile();
    return res && res.s === "ok";
  } catch {
    return false;
  }
}

// ── Smart lookback calculator ─────────────────────────────────────────────────
// Goal: always load enough data to form 50 waves, with a minimum of 3 months.
// Wave frequency estimates per resolution (waves per trading day):
//   1m  → ~10-15 waves/day   | 1D  → ~0.4-0.6 waves/day (2-3/week)
//   3m  → ~6-8 waves/day     | 15m → ~3-4 waves/day
//   5m  → ~5-6 waves/day     | 60m → ~1-2 waves/day
// We want 50 waves ÷ waves_per_day = trading days needed.
// 1 month ≈ 22 trading days. Add 50% buffer. Cap at 12 months for daily,
// 3 months for intraday (Fyers limit on intraday history is 100 days).
function calcLookbackDays(resolution) {
  const res = String(resolution).toUpperCase();
  const TARGET_WAVES = 50;
  const TRADING_DAYS_PER_MONTH = 22;
  const MIN_MONTHS = 3; // always fetch at least 3 months
  const MIN_DAYS = MIN_MONTHS * 30;

  let wavesPerDay;
  if (res === "D" || res === "1440") {
    wavesPerDay = 0.5; // ~2-3 waves per week
  } else {
    const mins = parseInt(res, 10) || 3;
    // Intraday session = 375 minutes. Each wave = ~2x resolution minutes minimum.
    // Be conservative: effective waves per candle ≈ 1/8 of candles per day
    const candlesPerDay = Math.floor(375 / mins);
    wavesPerDay = candlesPerDay / 8;
  }

  const tradingDaysNeeded = Math.ceil((TARGET_WAVES / wavesPerDay) * 1.5); // 50% buffer
  const calendarDaysNeeded = Math.ceil(tradingDaysNeeded * (365 / 252)); // trading→calendar

  const isDaily = res === "D" || res === "1440";
  const maxDays = isDaily ? 365 : 100; // Fyers intraday limit ~100 days

  return Math.min(maxDays, Math.max(MIN_DAYS, calendarDaysNeeded));
}

// ── Fetch historical candles ─────────────────────────────────────────────────
async function fetchCandles(symbol, resolution, count = 10000) {
  const fyers = getFyersClient();

  const now = Math.floor(Date.now() / 1000);

  const isDaily = resolution === 1440 || String(resolution).toUpperCase() === "D";
  const fyersResolution = isDaily ? "D" : String(resolution);

  // Smart lookback: enough data for 50 waves, min 3 months
  const lookbackDays = calcLookbackDays(resolution);
  const rangeFrom = now - lookbackDays * 24 * 60 * 60;

  let res = await fyers.getHistory({
    symbol,
    resolution: fyersResolution,
    date_format: "0",
    range_from: String(rangeFrom),
    range_to: String(now),
    cont_flag: "1",
  });

  // If the full range fails (stock may not have that history), fall back to
  // progressively shorter ranges: 6 months → 3 months → 1 month
  if (res && res.s !== "ok") {
    const fallbacks = [180, 90, 30].map((d) => now - d * 24 * 60 * 60);
    for (const fallbackFrom of fallbacks) {
      if (fallbackFrom >= rangeFrom) continue; // no point trying a longer range
      res = await fyers.getHistory({
        symbol,
        resolution: fyersResolution,
        date_format: "0",
        range_from: String(fallbackFrom),
        range_to: String(now),
        cont_flag: "1",
      });
      if (res && res.s === "ok") break;
    }
  }

  if (!res || res.s !== "ok") {
    const msg = res?.message || res?.errmsg || JSON.stringify(res);
    throw new Error("Fyers getHistory failed: " + msg);
  }

  const raw = res.candles || [];
  // Return ALL candles in the range — no artificial slice cap
  return raw.map((c) => ({
    time: c[0] * 1000, // milliseconds; Fyers timestamps are already IST
    open: c[1],
    high: c[2],
    low: c[3],
    close: c[4],
    volume: c[5],
  }));
}

module.exports = { loadToken, saveToken, getAuthURL, generateToken, validateToken, fetchCandles };