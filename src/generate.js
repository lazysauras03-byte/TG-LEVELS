// src/generate.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { fyersModel } = require("fyers-api-v3");

const client_id = process.env.APP_ID;
const secret_key = process.env.ST_KEY;
const redirect_uri = "https://trade.fyers.in/api-login/redirect-uri/index.html";
const response_type = "code";
const state = "sample_state";
const grant_type = "authorization_code";

const fyers = new fyersModel({ path: "", enableLogging: false });

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); }));
}

async function authenticate() {
  if (!client_id || !secret_key) {
    console.error("❌ APP_ID or ST_KEY missing in .env");
    process.exit(1);
  }

  console.log("\n" + "═".repeat(55));
  console.log("  Fyers Authentication");
  console.log("═".repeat(55));

  // Step 1: Generate auth URL
  const authUrl = fyers.generateAuthCode({
    client_id,
    redirect_uri,
    response_type,
    state,
  });

  console.log("\n📌 STEP 1 — Open this URL in your browser:\n");
  console.log("  " + authUrl);
  console.log("\n📌 STEP 2 — After login, you'll be redirected to a URL like:");
  console.log("  https://trade.fyers.in/api-login/redirect-uri/index.html?auth_code=XXXXX&...");
  console.log("\n📌 STEP 3 — Copy ONLY the auth_code value from that URL\n");

  const auth_code = await prompt("▶  Paste auth_code here: ");

  if (!auth_code || auth_code.length < 10) {
    console.error("❌ Invalid auth_code entered. Try again.");
    process.exit(1);
  }

  console.log("\n⏳ Generating access token...");

  let response;
  try {
    response = await fyers.generate_access_token({
      client_id,
      secret_key,
      auth_code,
      grant_type,
    });
  } catch (err) {
    console.error("❌ Token generation failed:", err.message);
    process.exit(1);
  }

  if (response.s !== "ok") {
    console.error("❌ Fyers error:", JSON.stringify(response, null, 2));
    process.exit(1);
  }

  const { access_token, refresh_token } = response;

  // Save tokens to root of project (one level up from src/)
  const rootDir = path.resolve(__dirname, "..");
  fs.writeFileSync(path.join(rootDir, "fyers_access_token.txt"), access_token);
  if (refresh_token) {
    fs.writeFileSync(path.join(rootDir, "fyers_refresh_token.txt"), refresh_token);
  }

  // Also save to scratch for fyersClient localStorage fallback
  const scratchDir = path.join(rootDir, "scratch");
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir);
  fs.writeFileSync(path.join(scratchDir, "token"), JSON.stringify(access_token));

  console.log("\n✅ Token saved successfully!");
  console.log("═".repeat(55));
  console.log("\n🚀 Now run in Terminal 1:   node server.js");
  console.log("🚀 Now run in Terminal 2:   cd frontend && npm start");
  console.log("═".repeat(55) + "\n");
}

function getStoredTokens() {
  const rootDir = path.resolve(__dirname, "..");
  const refreshTokenPath = path.join(rootDir, "fyers_refresh_token.txt");
  const accessTokenPath = path.join(rootDir, "fyers_access_token.txt");
  return {
    refresh_token: fs.existsSync(refreshTokenPath) ? fs.readFileSync(refreshTokenPath, "utf8").trim() : null,
    access_token: fs.existsSync(accessTokenPath) ? fs.readFileSync(accessTokenPath, "utf8").trim() : null,
  };
}

// ── Auto-run when called directly: node src/generate.js ──────────────────────
if (require.main === module) {
  authenticate().catch((err) => {
    console.error("💥 Fatal:", err.message);
    process.exit(1);
  });
}

module.exports = { authenticate, getStoredTokens };
