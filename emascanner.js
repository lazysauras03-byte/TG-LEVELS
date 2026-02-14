const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
// const { DateTime } = require('luxon');

// ================= CONFIG =================
const CONFIG = {
    EMA_FAST: 9,
    EMA_SLOW: 100,
    VOL_LEN: 20,
    VOL_MULT: 1.25,
    RANGE_LEN: 7,
    RANGE_MULT: 1.3,
    TIMEFRAME: "60",      // 1H
    ROLLING_DAYS: 30,
    TIMEZONE: "Asia/Kolkata",
    DATA_DIR: "data",
    STATE_DIR: "state",
    TEST_MODE: false  // Set to true to allow past signals (yesterday, day before)
};

const STATE_FILE = path.join(CONFIG.STATE_DIR, 'strategy_state.json');

// ================= FYERS & TELEGRAM SETUP =================
let fyers;
let bot;
let telegramchat;
let symbols = [];

// Initialize these from your existing setup
function initializeServices(fyersInstance, botInstance, chatId, symbolsList) {
    fyers = fyersInstance;
    bot = botInstance;
    telegramchat = chatId;
    symbols = symbolsList;
}

// ================= HELPER FUNCTIONS =================
async function ensureDirectories() {
    await fs.mkdir(CONFIG.DATA_DIR, { recursive: true });
    await fs.mkdir(CONFIG.STATE_DIR, { recursive: true });
}

async function loadState() {
    try {
        const data = await fs.readFile(STATE_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

async function saveState(state) {
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

function isFullyConfirmedSignal(st) {
    const requiredFields = [
        "crossover_time",
        "direction",
        "first_candle_type",
        "first_candle_time",
        "second_candle_type",
        "second_candle_time",
        "signal_time"
    ];

    if (st.state !== "FINAL_SIGNAL") {
        return false;
    }

    for (const field of requiredFields) {
        if (!st[field]) {
            return false;
        }
    }

    return true;
}

function getValidToDate(now) {
    let date = DateTime.fromJSDate(now, { zone: CONFIG.TIMEZONE });
    
    if (date.hour < 9 || (date.hour === 9 && date.minute < 15)) {
        date = date.minus({ days: 1 });
    }
    
    if (date.weekday === 6) {  // Saturday
        date = date.minus({ days: 1 });
    } else if (date.weekday === 7) {  // Sunday
        date = date.minus({ days: 2 });
    }
    
    return date;
}

// ================= INDICATOR CALCULATIONS =================
function calculateEMA(data, period) {
    const k = 2 / (period + 1);
    const emaArray = new Array(data.length);
    
    // First value is just the first data point
    emaArray[0] = data[0];
    
    for (let i = 1; i < data.length; i++) {
        emaArray[i] = data[i] * k + emaArray[i - 1] * (1 - k);
    }
    
    return emaArray;
}

function calculateSMA(data, period) {
    const smaArray = new Array(data.length).fill(null);
    
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j];
        }
        smaArray[i] = sum / period;
    }
    
    return smaArray;
}

function addIndicators(df) {
    // Calculate EMAs
    df.ema9 = calculateEMA(df.low, CONFIG.EMA_FAST);
    df.ema100 = calculateEMA(df.close, CONFIG.EMA_SLOW);
    
    // Calculate range
    df.range = df.high.map((h, i) => h - df.low[i]);
    
    // Calculate averages
    df.avg_volume = calculateSMA(df.volume, CONFIG.VOL_LEN);
    df.avg_range = calculateSMA(df.range, CONFIG.RANGE_LEN);
    
    // Calculate candle types
    df.white = df.close.map((c, i) => {
        return (
            df.volume[i] > df.avg_volume[i] * CONFIG.VOL_MULT &&
            df.range[i] > df.avg_range[i] * CONFIG.RANGE_MULT &&
            c > df.open[i] &&
            (c - df.open[i]) > df.avg_range[i]
        );
    });
    
    df.orange = df.close.map((c, i) => {
        return (
            df.volume[i] > df.avg_volume[i] * CONFIG.VOL_MULT &&
            df.range[i] > df.avg_range[i] * CONFIG.RANGE_MULT &&
            c < df.open[i]
        );
    });
    
    df.red = df.close.map((c, i) => {
        return (
            df.volume[i] > df.avg_volume[i] * CONFIG.VOL_MULT &&
            df.range[i] > df.avg_range[i] * CONFIG.RANGE_MULT &&
            c < df.open[i] &&
            (df.open[i] - c) > df.avg_range[i]
        );
    });
    
    return df;
}

// ================= CSV OPERATIONS =================
async function loadCSV(csvPath) {
    try {
        const content = await fs.readFile(csvPath, 'utf8');
        const lines = content.trim().split('\n');
        const headers = lines[0].split(',');
        
        const data = {
            datetime: [],
            open: [],
            high: [],
            low: [],
            close: [],
            volume: []
        };
        
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',');
            data.datetime.push(new Date(values[0]));
            data.open.push(parseFloat(values[1]));
            data.high.push(parseFloat(values[2]));
            data.low.push(parseFloat(values[3]));
            data.close.push(parseFloat(values[4]));
            data.volume.push(parseFloat(values[5]));
        }
        
        return data;
    } catch (error) {
        return null;
    }
}

async function saveCSV(csvPath, df) {
    const rows = ['datetime,open,high,low,close,volume'];
    
    for (let i = 0; i < df.datetime.length; i++) {
        rows.push(
            `${df.datetime[i].toISOString()},${df.open[i]},${df.high[i]},${df.low[i]},${df.close[i]},${df.volume[i]}`
        );
    }
    
    await fs.writeFile(csvPath, rows.join('\n'));
}

function mergeDataframes(dfOld, dfNew) {
    const datetimeMap = new Map();
    
    // Add old data
    if (dfOld) {
        for (let i = 0; i < dfOld.datetime.length; i++) {
            const key = dfOld.datetime[i].getTime();
            datetimeMap.set(key, {
                datetime: dfOld.datetime[i],
                open: dfOld.open[i],
                high: dfOld.high[i],
                low: dfOld.low[i],
                close: dfOld.close[i],
                volume: dfOld.volume[i]
            });
        }
    }
    
    // Add/overwrite with new data
    for (let i = 0; i < dfNew.datetime.length; i++) {
        const key = dfNew.datetime[i].getTime();
        datetimeMap.set(key, {
            datetime: dfNew.datetime[i],
            open: dfNew.open[i],
            high: dfNew.high[i],
            low: dfNew.low[i],
            close: dfNew.close[i],
            volume: dfNew.volume[i]
        });
    }
    
    // Convert back to arrays and sort
    const sorted = Array.from(datetimeMap.values()).sort((a, b) => 
        a.datetime.getTime() - b.datetime.getTime()
    );
    
    return {
        datetime: sorted.map(r => r.datetime),
        open: sorted.map(r => r.open),
        high: sorted.map(r => r.high),
        low: sorted.map(r => r.low),
        close: sorted.map(r => r.close),
        volume: sorted.map(r => r.volume)
    };
}

// ================= TELEGRAM =================
function tvLink(symbol) {
    return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
}

async function sendAlert(message) {
    if (!bot || !telegramchat) {
        console.log("Telegram not configured");
        return;
    }
    
    try {
        await bot.sendMessage(telegramchat, message, { parse_mode: 'HTML' });
    } catch (error) {
        console.error("Telegram send error:", error.message);
    }
}

// ================= MAIN SCANNER =================
async function scanSymbol(symbol, strategyState) {
    const csvPath = path.join(CONFIG.DATA_DIR, `${symbol.replace(':', '_')}.csv`);
    const validTo = getValidToDate(new Date());
    
    // ================= FETCH DATA =================
    let response;
    try {
        response = await fyers.history({
            symbol: symbol,
            resolution: CONFIG.TIMEFRAME,
            date_format: "1",
            range_from: validTo.minus({ days: CONFIG.ROLLING_DAYS }).toFormat("yyyy-MM-dd"),
            range_to: validTo.toFormat("yyyy-MM-dd"),
            cont_flag: "1"
        });
    } catch (error) {
        console.log(`❌ API error | ${symbol}: ${error.message}`);
        return;
    }
    
    const candles = response.candles || [];
    if (!candles.length) {
        console.log(`❌ No data | ${symbol}`);
        return;
    }
    
    // Convert to dataframe structure
    const dfNew = {
        datetime: candles.map(c => new Date(c[0] * 1000)),
        open: candles.map(c => c[1]),
        high: candles.map(c => c[2]),
        low: candles.map(c => c[3]),
        close: candles.map(c => c[4]),
        volume: candles.map(c => c[5])
    };
    
    // ================= CSV MERGE =================
    const dfOld = await loadCSV(csvPath);
    let df = mergeDataframes(dfOld, dfNew);
    await saveCSV(csvPath, df);
    
    // ================= INDICATORS =================
    df = addIndicators(df);
    
    // ================= INIT STATE =================
    if (!strategyState[symbol]) {
        strategyState[symbol] = {};
    }
    
    if (!strategyState[symbol].engine) {
        strategyState[symbol].engine = {
            state: "IDLE",
            crossover_time: null,
            direction: null
        };
    }
    
    if (!strategyState[symbol].signals) {
        strategyState[symbol].signals = {};
    }
    
    const st = strategyState[symbol].engine;
    const signals = strategyState[symbol].signals;
    
    // ================= NORMALIZE STATE =================
    const legacyStateMap = {
        "BULL_WAIT_WHITE": "WAIT_FIRST_WHITE",
        "BEAR_WAIT_ORANGE": "WAIT_FIRST_ORANGE"
    };
    
    if (legacyStateMap[st.state]) {
        st.state = legacyStateMap[st.state];
    }
    
    // Ensure mandatory keys
    st.first_candle_type = st.first_candle_type || null;
    st.first_candle_time = st.first_candle_time || null;
    st.second_candle_type = st.second_candle_type || null;
    st.second_candle_time = st.second_candle_time || null;
    st.signal_time = st.signal_time || null;
    st.alert_sent = st.alert_sent || false;
    
    // ================= SCAN CANDLES =================
    for (let i = 1; i < df.datetime.length; i++) {
        const prev = {
            datetime: df.datetime[i - 1],
            open: df.open[i - 1],
            high: df.high[i - 1],
            low: df.low[i - 1],
            close: df.close[i - 1],
            volume: df.volume[i - 1],
            ema9: df.ema9[i - 1],
            ema100: df.ema100[i - 1]
        };
        
        const curr = {
            datetime: df.datetime[i],
            open: df.open[i],
            high: df.high[i],
            low: df.low[i],
            close: df.close[i],
            volume: df.volume[i],
            ema9: df.ema9[i],
            ema100: df.ema100[i],
            white: df.white[i],
            orange: df.orange[i],
            red: df.red[i]
        };
        
        const currentCrossoverTime = DateTime.fromJSDate(curr.datetime, { zone: CONFIG.TIMEZONE })
            .toFormat("yyyy-MM-dd HH:mm");
        
        // Check for crossovers
        const bullCross = (
            prev.ema9 < prev.ema100 &&
            curr.ema9 > curr.ema100 &&
            prev.ema9 !== prev.ema100
        );
        
        const bearCross = (
            prev.ema9 > prev.ema100 &&
            curr.ema9 < curr.ema100 &&
            prev.ema9 !== prev.ema100
        );
        
        // ================= STATE MACHINE =================
        if (st.state === "IDLE") {
            // 🟢 Bullish crossover
            if (bullCross && st.last_crossover_time !== currentCrossoverTime) {
                st.state = "WAIT_ORANGE_BULL";
                st.crossover_time = currentCrossoverTime;
                st.last_crossover_time = currentCrossoverTime;
                st.direction = "BULLISH";
                st.orange_high = null;
            }
            // 🔴 Bearish crossover
            else if (bearCross && st.last_crossover_time !== currentCrossoverTime) {
                st.state = "WAIT_WHITE_BEAR";
                st.crossover_time = currentCrossoverTime;
                st.last_crossover_time = currentCrossoverTime;
                st.direction = "BEARISH";
                st.white_low = null;
            }
        }
        // 🟢 BULLISH FLOW
        else if (st.state === "WAIT_ORANGE_BULL") {
            if (curr.low < curr.ema100) {
                st.state = "IDLE";
            } else if (curr.orange && curr.low > curr.ema100) {
                st.state = "WAIT_WHITE_BULL";
                st.orange_high = curr.high;
                st.first_candle_type = "ORANGE";
                st.first_candle_time = DateTime.fromJSDate(curr.datetime, { zone: CONFIG.TIMEZONE })
                    .toFormat("yyyy-MM-dd HH:mm");
                st.first_candle_index = i;
            }
        }
        else if (st.state === "WAIT_WHITE_BULL") {
            if (curr.low < curr.ema100) {
                st.state = "IDLE";
            } else {
                const candlesSinceOrange = i - (st.first_candle_index || i);
                if (candlesSinceOrange > 20) {
                    st.state = "IDLE";
                    continue;
                }
                
                if (curr.white && curr.close > st.orange_high) {
                    st.state = "FINAL_SIGNAL";
                    st.second_candle_type = "WHITE";
                    st.second_candle_time = DateTime.fromJSDate(curr.datetime, { zone: CONFIG.TIMEZONE })
                        .toFormat("yyyy-MM-dd HH:mm");
                    st.signal_time = DateTime.fromJSDate(curr.datetime, { zone: CONFIG.TIMEZONE })
                        .toFormat("yyyy-MM-dd HH:mm");
                    st.alert_sent = false;
                }
            }
        }
        // 🔴 BEARISH FLOW
        else if (st.state === "WAIT_WHITE_BEAR") {
            if (curr.high > curr.ema100) {
                st.state = "IDLE";
            } else if (curr.white && curr.high < curr.ema100) {
                st.state = "WAIT_ORANGE_BEAR";
                st.white_low = curr.low;
                st.first_candle_type = "WHITE";
                st.first_candle_time = DateTime.fromJSDate(curr.datetime, { zone: CONFIG.TIMEZONE })
                    .toFormat("yyyy-MM-dd HH:mm");
                st.first_candle_index = i;
            }
        }
        else if (st.state === "WAIT_ORANGE_BEAR") {
            if (curr.high > curr.ema100) {
                st.state = "IDLE";
            } else {
                const candlesSinceWhite = i - (st.first_candle_index || i);
                if (candlesSinceWhite > 20) {
                    st.state = "IDLE";
                    continue;
                }
                
                if ((curr.orange || curr.red) && curr.close < st.white_low) {
                    st.state = "FINAL_SIGNAL";
                    st.second_candle_type = "ORANGE/RED";
                    st.second_candle_time = DateTime.fromJSDate(curr.datetime, { zone: CONFIG.TIMEZONE })
                        .toFormat("yyyy-MM-dd HH:mm");
                    st.signal_time = DateTime.fromJSDate(curr.datetime, { zone: CONFIG.TIMEZONE })
                        .toFormat("yyyy-MM-dd HH:mm");
                    st.alert_sent = false;
                }
            }
        }
    }
    
    // ================= ALERT OUTPUT =================
    if (isFullyConfirmedSignal(st)) {
        const signalTime = st.signal_time;
        
        // 🚫 Prevent duplicate log
        if (signals[signalTime]) {
            return;
        }
        
        // ✅ 24-Hour Rolling Filter
        const signalTimeObj = DateTime.fromFormat(signalTime, "yyyy-MM-dd HH:mm", { zone: CONFIG.TIMEZONE });
        const now = DateTime.now().setZone(CONFIG.TIMEZONE);
        
        if (!CONFIG.TEST_MODE) {
            if (signalTimeObj < now.minus({ hours: 24 })) {
                return;
            }
        }
        
        const signalType = st.direction === "BULLISH" ? "Buy" : "Sell";
        
        // -------- SAVE CLEAN SIGNAL LOG --------
        signals[signalTime] = {
            signal_type: signalType,
            crossover_time: st.crossover_time,
            first_candle: `${st.first_candle_type} (${st.first_candle_time})`,
            second_candle: `${st.second_candle_type} (${st.second_candle_time})`
        };
        
        // -------- TELEGRAM --------
        const tgMsg = 
            `📊 <b>EMA Crossover Signal Confirmed</b>\n\n` +
            `Stock: <a href='${tvLink(symbol)}'>${symbol}</a>\n` +
            `Timeframe: 1H\n\n` +
            `EMA Crossover Time:\n${st.crossover_time}\n\n` +
            `First Candle:\n${st.first_candle_type} @ ${st.first_candle_time}\n\n` +
            `Second Candle:\n${st.second_candle_type} @ ${st.second_candle_time}\n\n` +
            `Final Signal: <b>${signalType}</b>\n` +
            `Confirmed At:\n${st.signal_time}`;
        
        await sendAlert(tgMsg);
        
        // -------- CONSOLE LOG --------
        console.log("\n[EMA Crossover Signal CONFIRMED]");
        console.log(`Stock            : ${symbol}`);
        console.log(`Signal Type      : ${signalType}`);
        console.log(`Crossover Time   : ${st.crossover_time}`);
        console.log(`First Candle     : ${st.first_candle_type} (${st.first_candle_time})`);
        console.log(`Second Candle    : ${st.second_candle_type} (${st.second_candle_time})`);
        console.log(`Confirmed At     : ${st.signal_time}`);
        
        // 🔄 RESET ENGINE
        st.state = "IDLE";
        st.crossover_time = null;
        st.direction = null;
        st.first_candle_type = null;
        st.first_candle_time = null;
        st.first_candle_index = null;
        st.second_candle_type = null;
        st.second_candle_time = null;
        st.signal_time = null;
    }
}

// ================= MAIN LOOP =================
async function runScanner() {
    console.log("\n♻️ REPLAY + TELEGRAM SCANNER STARTED\n");
    
    await ensureDirectories();
    
    while (true) {
        console.log("\n🫀 Scanner running...");
        console.log(`🔍 Symbols: ${symbols.length}`);
        
        const strategyState = await loadState();
        
        for (const symbol of symbols) {
            try {
                await scanSymbol(symbol, strategyState);
            } catch (error) {
                console.error(`Error scanning ${symbol}:`, error.message);
            }
        }
        
        await saveState(strategyState);
        
        // Wait 60 seconds
        await new Promise(resolve => setTimeout(resolve, 60000));
    }
}

// ================= EXPORTS =================
module.exports = {
    initializeServices,
    runScanner,
    CONFIG
};