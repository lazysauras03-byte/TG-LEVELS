// utils/fyersClient.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");

if (typeof localStorage === "undefined" || localStorage === null) {
  const LocalStorage = require("node-localstorage").LocalStorage;
  global.localStorage = new LocalStorage("./scratch");
}

const { fyersModel } = require("fyers-api-v3");

const fyers = new fyersModel({ path: "", enableLogging: false });
fyers.setAppId(process.env.APP_ID);
fyers.setRedirectUrl("https://www.google.com/");

function setToken(token) {
  if (token) {
    fyers.setAccessToken(token);
    localStorage.setItem("token", JSON.stringify(token));
  }
}

function loadToken() {
  const fromLS = localStorage.getItem("token");
  if (fromLS) {
    try {
      const parsed = JSON.parse(fromLS);
      if (parsed && parsed.length > 10) return parsed;
    } catch {}
  }

  // Try reading from token file (same location as original project)
  const file = path.resolve("./fyers_access_token.txt");
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, "utf8").trim();
    if (raw && raw.length > 10) {
      localStorage.setItem("token", JSON.stringify(raw));
      return raw;
    }
  }

  return process.env.ACCESS_TOKEN || null;
}

const token = loadToken();
if (token) {
  fyers.setAccessToken(token);
  console.log("✅ Fyers token loaded");
} else {
  console.warn("⚠️  No Fyers access token — using mock data mode");
}

module.exports = { fyers, setToken, isTokenLoaded: !!token };
