// utils/logger.js
const moment = require("moment");

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS = {
  debug: "\x1b[36m", info: "\x1b[32m", warn: "\x1b[33m",
  error: "\x1b[31m", reset: "\x1b[0m",
};

const currentLevel = LEVELS[process.env.LOG_LEVEL || "info"] ?? 1;

function log(level, ...args) {
  if (LEVELS[level] < currentLevel) return;
  const ts = moment().format("HH:mm:ss");
  const color = COLORS[level] || "";
  console.log(`${color}[${ts}] [${level.toUpperCase()}]${COLORS.reset}`, ...args);
}

module.exports = {
  debug: (...a) => log("debug", ...a),
  info: (...a) => log("info", ...a),
  warn: (...a) => log("warn", ...a),
  error: (...a) => log("error", ...a),

  signal: (symbol, type, price, ts) => {
    const SCAN_DATE = process.env.SCAN_DATE;
    const signalDate = moment.unix(ts).format("YYYY-MM-DD");

    if (SCAN_DATE) {
      if (signalDate !== SCAN_DATE) return;
    } else {
      const today = moment().format("YYYY-MM-DD");
      if (signalDate !== today) return;
    }

    // Arrow icon per type
    const arrow =
      type === "NEW_HIGH" ? "📈" :
        type === "NEW_LOW" ? "📉" :
          type === "First Candle HIGH" ? "📊" :
            type === "First Candle LOW" ? "📊" :
              type === "Last Candle HIGH" ? "📊" :
                type === "Last Candle LOW" ? "📊" : "📊";

    const time = moment.unix(ts).format("HH:mm");
    const label = type.padEnd(18);

    console.log(
      `${COLORS.info}[${moment().format("HH:mm:ss")}] SIGNAL${COLORS.reset}  ` +
      `${arrow} ${symbol.padEnd(25)} → ${label} @ ₹${price.toFixed(2)}  [${time}]`
    );
  },
};