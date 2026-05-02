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

// ── Fetch historical candles — 1 month of data ───────────────────────────────
async function fetchCandles(symbol, resolution, count = 10000) {
  const fyers = getFyersClient();

  // Go back 45 calendar days to guarantee ~30 trading days
  // (accounts for weekends + holidays in Indian market)
  const now = Math.floor(Date.now() / 1000);
  const rangeFrom = now - 45 * 24 * 60 * 60;

  const res = await fyers.getHistory({
    symbol,
    resolution: String(resolution),
    date_format: "0",
    range_from: String(rangeFrom),
    range_to: String(now),
    cont_flag: "1",
  });

  if (!res || res.s !== "ok") {
    throw new Error("Fyers getHistory failed: " + JSON.stringify(res));
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