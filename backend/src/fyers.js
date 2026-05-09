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
function calcLookbackDays(resolution) {
  const res = String(resolution).toUpperCase();
  const TARGET_WAVES = 50;
  const MIN_DAYS = 90; // always fetch at least 3 months

  let wavesPerDay;
  if (res === "D" || res === "1440") {
    wavesPerDay = 0.5;
  } else {
    const mins = parseInt(res, 10) || 3;
    const candlesPerDay = Math.floor(375 / mins);
    wavesPerDay = candlesPerDay / 8;
  }

  const tradingDaysNeeded = Math.ceil((TARGET_WAVES / wavesPerDay) * 1.5);
  const calendarDaysNeeded = Math.ceil(tradingDaysNeeded * (365 / 252));

  const isDaily = res === "D" || res === "1440";
  const maxDays = isDaily ? 365 : 100;

  return Math.min(maxDays, Math.max(MIN_DAYS, calendarDaysNeeded));
}

// ── Fetch historical candles ──────────────────────────────────────────────────
// Hard 15-second timeout per attempt. Works 24/7 — Fyers REST history is
// available on weekends and after hours (returns the last available data).
async function fetchCandles(symbol, resolution, count = 10000) {
  const fyers = getFyersClient();

  const now = Math.floor(Date.now() / 1000);

  const isDaily = resolution === 1440 || String(resolution).toUpperCase() === "D";
  const fyersResolution = isDaily ? "D" : String(resolution);

  const lookbackDays = calcLookbackDays(resolution);
  const rangeFrom = now - lookbackDays * 24 * 60 * 60;

  const FETCH_TIMEOUT_MS = 15000;

  async function tryFetch(from) {
    return Promise.race([
      fyers.getHistory({
        symbol,
        resolution: fyersResolution,
        date_format: "0",
        range_from: String(from),
        range_to: String(now),
        cont_flag: "1",
      }),
      rejectAfter(FETCH_TIMEOUT_MS, `fetchCandles(${symbol} res=${fyersResolution})`),
    ]);
  }

  let res;
  try {
    res = await tryFetch(rangeFrom);
  } catch (err) {
    console.warn(`[Fyers] Primary fetch failed (${err.message}) — trying fallback ranges`);
    res = null;
  }

  // If primary range failed or returned error, try shorter ranges
  if (!res || res.s !== "ok") {
    const fallbacks = [180, 90, 30].map((d) => now - d * 24 * 60 * 60);
    for (const fallbackFrom of fallbacks) {
      if (fallbackFrom >= rangeFrom) continue;
      try {
        res = await tryFetch(fallbackFrom);
        if (res && res.s === "ok") break;
      } catch (err) {
        console.warn(`[Fyers] Fallback fetch (${Math.round((now - fallbackFrom) / 86400)}d) failed:`, err.message);
      }
    }
  }

  if (!res || res.s !== "ok") {
    const msg = res?.message || res?.errmsg || JSON.stringify(res) || "unknown error";
    throw new Error("Fyers getHistory failed: " + msg);
  }

  const raw = res.candles || [];
  return raw.map((c) => ({
    time: c[0] * 1000, // ms; Fyers timestamps are already IST epoch seconds
    open: c[1],
    high: c[2],
    low: c[3],
    close: c[4],
    volume: c[5],
  }));
}

module.exports = { loadToken, saveToken, getAuthURL, generateToken, validateToken, fetchCandles };