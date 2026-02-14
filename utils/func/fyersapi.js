const fyersModel = require("fyers-api-v3").fyersModel;
if (typeof localStorage === "undefined" || localStorage === null) {
    var LocalStorage = require("node-localstorage").LocalStorage;
    localStorage = new LocalStorage("./scratch");
}
const fyers = new fyersModel({ path: "", enableLogging: false });

const appid = "KETLMLSN3I-100";

fyers.setAppId(appid);
fyers.setRedirectUrl("https://www.google.com/");

// Get token from localStorage
const raw = localStorage.getItem("token");
const tempauth = raw ? JSON.parse(raw) : null;

if (tempauth) {
  fyers.setAccessToken(tempauth);
}

// Export the configured instance
module.exports = fyers;