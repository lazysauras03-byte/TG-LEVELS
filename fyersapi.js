const fyersModel = require("fyers-api-v3").fyersModel;
if (typeof localStorage === "undefined" || localStorage === null) {
    var LocalStorage = require("node-localstorage").LocalStorage;
    localStorage = new LocalStorage("./scratch");
}
const fyers = new fyersModel({ path: "", enableLogging: false });

fyers.setAppId(process.env.APP_ID);
fyers.setRedirectUrl("https://www.google.com/");

const raw = localStorage.getItem("token");
const tempauth = raw ? JSON.parse(raw) : null;

if (tempauth) {
  fyers.setAccessToken(tempauth);
}

module.exports = fyers;