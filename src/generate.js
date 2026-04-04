const readline = require('readline');
const fs = require('fs');
const { fyersModel } = require('fyers-api-v3');

const client_id = process.env.APP_ID;
const secret_key = process.env.ST_KEY;
const redirect_uri = "https://trade.fyers.in/api-login/redirect-uri/index.html";
const response_type = "code";
const state = "sample_state";
const grant_type = "authorization_code";

const fyers = new fyersModel({
  path: "",
  enableLogging: false
});

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

// async function authenticate() {
//   // Step 1: Generate the auth URL (equivalent to session.generate_authcode())
//   const authUrl = fyers.generateAuthCode({
//     client_id,
//     redirect_uri,
//     response_type,
//     state,
//   });

//   console.log("Auth URL:", authUrl);
//   console.log("Open the above URL in your browser and copy the auth_code from the redirect.");

//   // Step 2: Get auth code from user
//   const auth_code = await prompt("Enter Auth Code: ");

//   // Step 3: Exchange auth code for tokens (equivalent to session.set_token() + session.generate_token())
//   const response = await fyers.generate_access_token({
//     client_id,
//     secret_key,
//     auth_code: auth_code.trim(),
//     grant_type,
//   });

//   if (response.s !== 'ok') {
//     throw new Error(`Failed to get access token: ${JSON.stringify(response)}`);
//   }

//   const { refresh_token } = response;

//   fs.writeFileSync("fyers_refresh_token.txt", refresh_token);

//   console.log("Refresh Tokens saved to files.");



//   return
// }

function getStoredTokens() {
  const refreshTokenPath = "fyers_refresh_token.txt";

  return {
    refresh_token: fs.existsSync(refreshTokenPath)
      ? fs.readFileSync(refreshTokenPath, "utf8").trim()
      : null,
  };
}

module.exports = { authenticate, getStoredTokens };


async function authenticate() {
  const authUrl = fyers.generateAuthCode({
    client_id,
    redirect_uri,
    response_type,
    state,
  });

  console.log("Auth URL:", authUrl);
  console.log("Open the above URL in your browser and copy the auth_code from the redirect.");

  const auth_code = await prompt("Enter Auth Code: ");

  const response = await fyers.generate_access_token({
    client_id,
    secret_key,
    auth_code: auth_code.trim(),
    grant_type,
  });

  if (response.s !== 'ok') {
    throw new Error(`Failed to get access token: ${JSON.stringify(response)}`);
  }

  const { access_token, refresh_token } = response;

  // ✅ Save refresh token to file (existing)
  fs.writeFileSync("fyers_refresh_token.txt", refresh_token);

  // ✅ Save access token to localStorage so index.js can read it
  if (typeof localStorage === "undefined" || localStorage === null) {
    var LocalStorage = require("node-localstorage").LocalStorage;
    localStorage = new LocalStorage("./scratch");
  }
  localStorage.setItem("token", JSON.stringify(access_token));

  console.log("✅ Access token and refresh token saved.");

  return access_token;
}