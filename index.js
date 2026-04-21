// 3C Break FUT FILE 

// node index.js
// npm start

const express = require("express");
require("dotenv").config();
const fs = require("fs");
const moment = require("moment");
const { authenticate, getStoredTokens } = require("./src/generate");

const fyers = require("./fyersapi");


if (typeof localStorage === "undefined" || localStorage === null) {
  var LocalStorage = require("node-localstorage").LocalStorage;
  localStorage = new LocalStorage("./scratch");
}

const app = express();

// ─── Auth ─────────────────────────────────────────────────────────────────────
const tokens = getStoredTokens();
var tempauth;

const raw = localStorage.getItem("token");
tempauth = raw ? JSON.parse(raw) : null;

let data = {
  grant_type: "refresh_token",
  appIdHash: process.env.HASH_ID,
  refresh_token: tokens.refresh_token,
  pin: process.env.PIN,
};

const runauth = async () => {
  const tokens = getStoredTokens();
  const accessToken = tokens.access_token;

  if (!accessToken) {
    console.error("❌ No access token found. Run authenticate() first (Option 1 in main).");
    process.exit(1);
  }

  fyers.setAppId(process.env.APP_ID);
  fyers.setRedirectUrl("https://www.google.com/");
  fyers.setAccessToken(accessToken);
  tempauth = accessToken;

  const profile = await fyers.get_profile();
  console.log("✅ Auth OK:", profile);
};

async function main() {
  try {
    // ── Option 1: First-time / monthly auth (saves refresh token to file) ──
    await authenticate();
    console.log("✅ Authentication complete. You can now run runauth() daily.");
    process.exit(0);

  } catch (err) {
    console.error("❌ Fatal startup error:", err.message);
    process.exit(1);
  }
}

// ─── Unhandled rejection safety net ──────────────────────────────────────────
process.on("unhandledRejection", (reason) => {
  console.error("⚠️  Unhandled rejection:", reason?.message || reason);
  // Do NOT exit — let nodemon keep running
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3600;
app.listen(PORT, async () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  await main(); // ← Start after server is up
});
