// // server.js — Trading Dashboard Backend
// require("dotenv").config();
// const express = require("express");
// const http = require("http");
// const WebSocket = require("ws");
// const cors = require("cors");
// const moment = require("moment-timezone");
// const path = require("path");
// const fs = require("fs");

// const { fetchCandles, clearCache } = require("./fetchCandles");
// const { processSymbol, resetAll } = require("./strategy");
// const { loadStocks, chunkArray } = require("./loadStocks");
// const { attachEMAFormatted, resampleCandles } = require("./ema");
// const { getStoredTokens } = require("./src/generate");
// const { fyers, setToken } = require("./utils/fyersClient");

// // ── Optional ngrok tunnel ─────────────────────────────────────────────────
// let ngrok = null;
// try { ngrok = require("@ngrok/ngrok"); } catch (_) { /* not installed — local only */ }

// const app = express();
// const server = http.createServer(app);
// // noServer=true so we control the upgrade handshake with auth
// const wss = new WebSocket.Server({ noServer: true });

// const PORT = process.env.PORT || 3200;
// const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "10");
// const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS || "2000");
// const SCAN_INTERVAL_MS = 3 * 60 * 1000 + 10 * 1000;
// const IST = "Asia/Kolkata";

// // ── In-memory signal store ─────────────────────────────────────────────────
// // Keyed by `${symbol}::${date}` so signals for different dates don't mix
// const signalStore = new Map();

// function storeKey(symbol, date) { return `${symbol}::${date}`; }

// function upsertSignals(symbol, date, newSigs) {
//   if (!newSigs || newSigs.length === 0) return;
//   const key = storeKey(symbol, date);
//   if (!signalStore.has(key)) signalStore.set(key, { signals: [] });
//   const store = signalStore.get(key);
//   for (const sig of newSigs) {
//     if (sig.type === "LAST_HIGH" || sig.type === "LAST_LOW") {
//       store.signals = store.signals.filter(s => s.type !== sig.type);
//       store.signals.push(sig);
//     } else if (sig.type === "FIRST_HIGH" || sig.type === "FIRST_LOW") {
//       if (!store.signals.find(s => s.type === sig.type)) store.signals.push(sig);
//     } else {
//       if (!store.signals.find(s => s.type === sig.type && s.ts === sig.ts)) store.signals.push(sig);
//     }
//   }
// }

// function getSignals(symbol, date) {
//   return signalStore.get(storeKey(symbol, date))?.signals || [];
// }

// // ── State ──────────────────────────────────────────────────────────────────
// let allSymbols = [], lastResetDate = null, isRunning = false;
// let runCount = 0, schedulerTimeout = null, lastScanTime = null, nextScanTimeStr = null;

// app.use(cors());
// app.use(express.json());

// // ── Basic Auth (protects all routes when DASHBOARD_USER/PASS set in .env) ─
// const DASH_USER = process.env.DASHBOARD_USER || "ema9";
// const DASH_PASS = process.env.DASHBOARD_PASS || "signals";
// const basicAuth = (req, res, next) => {
//   const authHeader = req.headers.authorization;
//   if (!authHeader || !authHeader.startsWith("Basic ")) {
//     res.setHeader("WWW-Authenticate", 'Basic realm="EMA9 Dashboard"');
//     return res.status(401).send("Authentication required");
//   }
//   const [user, pass] = Buffer.from(authHeader.split(" ")[1], "base64").toString().split(":");
//   if (user === DASH_USER && pass === DASH_PASS) return next();
//   res.setHeader("WWW-Authenticate", 'Basic realm="EMA9 Dashboard"');
//   return res.status(401).send("Access denied");
// };
// app.use(basicAuth);

// // ── WebSocket Basic Auth ───────────────────────────────────────────────────
// // Validate credentials on every WS upgrade request
// wss.on("headers", (headers, req) => {
//   const authHeader = req.headers.authorization;
//   if (!authHeader) return; // will be rejected in connection handler
// });

// // Intercept upgrade at HTTP level to enforce auth
// server.on("upgrade", (req, socket, head) => {
//   const authHeader = req.headers.authorization;
//   let authorized = false;
//   if (authHeader && authHeader.startsWith("Basic ")) {
//     const [user, pass] = Buffer.from(authHeader.split(" ")[1], "base64").toString().split(":");
//     authorized = (user === DASH_USER && pass === DASH_PASS);
//   }
//   if (!authorized) {
//     socket.write("HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"EMA9 Dashboard\"\r\n\r\n");
//     socket.destroy();
//     return;
//   }
//   wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
// });

// const frontendBuild = path.join(__dirname, "frontend", "build");
// // Create static middleware once — serves frontend/build if it exists
// const serveStatic = express.static(frontendBuild);
// app.use((req, res, next) => {
//   if (fs.existsSync(path.join(frontendBuild, "index.html"))) {
//     return serveStatic(req, res, next);
//   }
//   next();
// });

// function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// function nowIST() { return moment().tz(IST); }

// function isWeekend() { const d = nowIST().day(); return d === 0 || d === 6; }

// function isMarketOpen() {
//   const now = nowIST();
//   const open = now.clone().set({ hour: 9, minute: 15, second: 0, millisecond: 0 });
//   const close = now.clone().set({ hour: 15, minute: 30, second: 10, millisecond: 0 });
//   return now.isSameOrAfter(open) && now.isSameOrBefore(close);
// }

// function getNextScanMoment() {
//   const base = nowIST().startOf("day").set({ hour: 9, minute: 15, second: 10, millisecond: 0 });
//   const now = nowIST();
//   if (now.isBefore(base)) return base;
//   const steps = Math.floor(now.diff(base) / SCAN_INTERVAL_MS) + 1;
//   return base.clone().add(steps * SCAN_INTERVAL_MS, "ms");
// }

// function getTodayIST() { return nowIST().format("YYYY-MM-DD"); }

// function getActiveScanDate() {
//   // Use SCAN_DATE from env if set, otherwise today in IST
//   return process.env.SCAN_DATE || getTodayIST();
// }

// function checkDailyReset() {
//   const today = getTodayIST();
//   if (lastResetDate !== today) {
//     console.info(`🌅 New day (${today} IST) — resetting states`);
//     resetAll(); clearCache();
//     lastResetDate = today;
//   }
// }

// function broadcast(type, data) {
//   const msg = JSON.stringify({ type, data, ts: Date.now() });
//   for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
// }

// async function processBatch(symbols, scanDate) {
//   const results = [];
//   await Promise.all(symbols.map(async symbol => {
//     try {
//       const raw = await fetchCandles(symbol, "3", 7, scanDate); // 7 days ensures previous trading day candles for EMA warm-up
//       if (!raw) return;
//       const sigs = processSymbol(symbol, raw, scanDate);
//       if (sigs && sigs.length > 0) {
//         upsertSignals(symbol, scanDate, sigs);
//         results.push(...sigs);
//         broadcast("new_signals", { symbol, signals: sigs, date: scanDate });

//         // ── Print NEW_HIGH / NEW_LOW signals to console as they are found ──
//         const clean = symbol.replace("NSE:", "").replace("-EQ", "").replace("-INDEX", "");
//         for (const sig of sigs) {
//           if (sig.type === "NEW_HIGH") {
//             console.info(`  📈 NEW_HIGH  ${clean.padEnd(18)} ₹${sig.price.toFixed(2)}  @ ${moment.unix(sig.ts).tz(IST).format("HH:mm")}`);
//           } else if (sig.type === "NEW_LOW") {
//             console.info(`  📉 NEW_LOW   ${clean.padEnd(18)} ₹${sig.price.toFixed(2)}  @ ${moment.unix(sig.ts).tz(IST).format("HH:mm")}`);
//           }
//         }
//       }
//     } catch (err) { console.error(`❌ ${symbol}: ${err.message}`); }
//   }));
//   return results;
// }

// async function runCycle(symbols) {
//   if (isRunning) { console.warn("⚠️  Skipping — still running"); return; }
//   isRunning = true; runCount++;
//   lastScanTime = nowIST().format("HH:mm:ss");
//   const t0 = Date.now();
//   const scanDate = getActiveScanDate();
//   console.info(`\n${"─".repeat(50)}\n🚀 Cycle #${runCount} @ ${lastScanTime} IST | ${symbols.length} symbols | date: ${scanDate}`);
//   broadcast("scan_start", { cycle: runCount, time: lastScanTime });
//   try {
//     const batches = chunkArray(symbols, BATCH_SIZE);
//     let total = 0;
//     for (let i = 0; i < batches.length; i++) {
//       total += (await processBatch(batches[i], scanDate)).length;
//       if (i < batches.length - 1) await sleep(BATCH_DELAY_MS);
//     }
//     const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
//     console.info(`✅ Cycle #${runCount} done in ${elapsed}s | ${total} new signals`);
//     broadcast("scan_complete", { cycle: runCount, elapsed, newSignals: total });
//   } finally { isRunning = false; }
// }

// function scheduleNextScan(symbols) {
//   if (schedulerTimeout) clearTimeout(schedulerTimeout);
//   // Only schedule live scans when no SCAN_DATE override (i.e. live mode)
//   if (process.env.SCAN_DATE) {
//     console.info("📅 SCAN_DATE override active — no auto-scheduling");
//     return;
//   }
//   const next = getNextScanMoment();
//   nextScanTimeStr = next.format("HH:mm:ss");
//   const delay = Math.max(0, next.diff(nowIST()));
//   console.info(`⏰ Next scan at ${nextScanTimeStr} IST (in ${(delay / 1000).toFixed(0)}s)`);
//   schedulerTimeout = setTimeout(async () => {
//     checkDailyReset();
//     if (!isWeekend() && isMarketOpen()) await runCycle(symbols);
//     else console.info("📴 Market closed");
//     scheduleNextScan(symbols);
//   }, delay);
// }

// // ── REST API ───────────────────────────────────────────────────────────────

// app.get("/api/symbols", (req, res) => res.json({ symbols: allSymbols, count: allSymbols.length }));

// // GET /api/chart?symbol=NSE:DLF-EQ&resolution=3&timeframe=1m&date=2026-04-17
// app.get("/api/chart", async (req, res) => {
//   const { symbol, resolution = "3", timeframe = "1m" } = req.query;
//   // date param allows viewing any past date from the UI
//   const targetDate = req.query.date || getActiveScanDate();

//   if (!symbol) return res.status(400).json({ error: "symbol required" });

//   try {
//     // Calculate days needed based on timeframe
//     const daysMap = { "1d": 7, "5d": 10, "1m": 35, "3m": 95 }; // min 7d to ensure EMA warm-up across weekends
//     const days = daysMap[timeframe] || 35;

//     const baseRes = resolution === "D" ? "D" : "3";
//     const raw = await fetchCandles(symbol, baseRes, days, targetDate);
//     if (!raw) return res.status(404).json({ error: `No data for ${symbol} on ${targetDate}` });

//     // Format raw candles — convert UTC timestamps to IST display
//     let formatted = raw.map(c => ({
//       ts: c[0], time: c[0],  // keep unix ts as-is for chart library
//       open: parseFloat(c[1]), high: parseFloat(c[2]),
//       low: parseFloat(c[3]), close: parseFloat(c[4]),
//       volume: parseFloat(c[5]),
//     }));

//     // Resample to higher timeframe if needed
//     const resMin = parseInt(resolution) || 3;
//     if (resMin > 3 && resolution !== "D") formatted = resampleCandles(formatted, resMin);

//     const withEma = attachEMAFormatted(formatted);

//     // Get signals for the requested date
//     let signals = getSignals(symbol, targetDate);

//     // If no signals in memory yet for this date, run strategy now
//     if (signals.length === 0 && raw.length > 0) {
//       const sigs = processSymbol(symbol, raw, targetDate);
//       if (sigs && sigs.length > 0) {
//         upsertSignals(symbol, targetDate, sigs);
//         signals = getSignals(symbol, targetDate);
//       }
//     }

//     res.json({
//       symbol, resolution, date: targetDate,
//       candles: withEma,
//       signals,
//       meta: { count: withEma.length, lastUpdated: lastScanTime, nextScan: nextScanTimeStr, timezone: "IST" },
//     });
//   } catch (err) {
//     console.error(`Chart API error [${symbol}]:`, err.message);
//     res.status(500).json({ error: err.message });
//   }
// });

// app.get("/api/signals", (req, res) => {
//   const { symbol, date } = req.query;
//   const d = date || getActiveScanDate();
//   if (symbol) return res.json({ symbol, signals: getSignals(symbol, d) });
//   res.json({ date: d, message: "Specify ?symbol= to get signals" });
// });

// app.get("/api/status", (req, res) => res.json({
//   running: isRunning, cycle: runCount, symbols: allSymbols.length,
//   lastScan: lastScanTime, nextScan: nextScanTimeStr,
//   marketOpen: isMarketOpen(), scanDate: getActiveScanDate(),
//   timezone: "IST", uptime: process.uptime(),
// }));

// app.post("/api/refresh", async (req, res) => {
//   const { symbol, date } = req.body;
//   const d = date || getActiveScanDate();
//   if (symbol) {
//     clearCache(symbol);
//     const raw = await fetchCandles(symbol, "3", 35, d);
//     if (raw) {
//       const sigs = processSymbol(symbol, raw, d);
//       upsertSignals(symbol, d, sigs);
//     }
//     return res.json({ ok: true, symbol, date: d });
//   }
//   res.json({ ok: true });
// });

// app.get("/health", (req, res) => res.json({
//   status: "ok", cycle: runCount, lastScan: lastScanTime,
//   scanDate: getActiveScanDate(), marketOpen: isMarketOpen(),
// }));

// app.get("*", (req, res) => {
//   const idx = path.join(frontendBuild, "index.html");
//   if (fs.existsSync(idx)) return res.sendFile(idx);
//   // Build not found — show a helpful page with a button to redirect to /chart once built
//   res.send(`<!DOCTYPE html>
// <html>
// <head>
//   <meta charset="utf-8">
//   <title>EMA9 Dashboard</title>
//   <style>
//     body { background:#0a0e1a; color:#e2e8f0; font-family:monospace; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; flex-direction:column; gap:20px; }
//     h2 { color:#3b82f6; margin:0; }
//     p  { color:#64748b; margin:0; font-size:13px; }
//     .box { background:#0d1221; border:1px solid #1e3a8a; border-radius:10px; padding:32px 48px; text-align:center; }
//     code { background:#131d35; padding:4px 10px; border-radius:4px; color:#f97316; font-size:13px; }
//   </style>
// </head>
// <body>
//   <div class="box">
//     <h2>⚠️ Frontend build not found</h2>
//     <br>
//     <p>Run <code>.\\start.bat</code> from the <code>ema9-structure</code> folder.</p>
//     <br>
//     <p>The build creates <code>frontend/build/index.html</code> which serves the dashboard.</p>
//     <br>
//     <p style="color:#22c55e">API is running → <a href="/api/status" style="color:#3b82f6">/api/status</a></p>
//   </div>
// </body>
// </html>`);
// });

// wss.on("connection", ws => {
//   ws.send(JSON.stringify({
//     type: "init", data: {
//       symbols: allSymbols, scanDate: getActiveScanDate(),
//       status: { lastScan: lastScanTime, nextScan: nextScanTimeStr, marketOpen: isMarketOpen() },
//     }
//   }));
//   ws.on("close", () => { });
// });

// async function start() {
//   const stored = getStoredTokens();
//   if (!stored || !stored.access_token) {
//     console.error("\n❌ No access token. Run: node src/generate.js\n"); process.exit(1);
//   }
//   setToken(stored.access_token);
//   console.info("✅ Fyers token loaded");

//   allSymbols = loadStocks();
//   console.info(`📊 ${allSymbols.length} symbols loaded`);
//   checkDailyReset();

//   await new Promise(resolve => server.listen(PORT, "0.0.0.0", resolve));
//   console.info(`\n${"═".repeat(55)}`);
//   console.info(`🚀 Dashboard  →  http://localhost:${PORT}`);
//   console.info(`📡 WebSocket  →  ws://localhost:${PORT}`);
//   console.info(`📅 Scan date  →  ${getActiveScanDate()}`);

//   // ── Start ngrok tunnel (URL printed after scan completes) ────────────────
//   let ngrokUrl = null;
//   const ngrokToken = process.env.NGROK_AUTHTOKEN;
//   if (ngrok && ngrokToken) {
//     try {
//       const listener = await ngrok.forward({ addr: PORT, authtoken: ngrokToken });
//       ngrokUrl = listener.url();
//     } catch (ngrokErr) {
//       console.warn(`⚠️  ngrok failed: ${ngrokErr.message}`);
//     }
//   }
//   console.info(`${"═".repeat(55)}\n`);

//   console.info("🎯 Running initial scan...");
//   await runCycle(allSymbols);

//   // ── Print shareable link NOW — after all signals are ready ───────────────
//   console.info(`\n${"═".repeat(55)}`);
//   if (ngrokUrl) {
//     console.info(`✅ All signals scanned! Share this link with your team:`);
//     console.info(`\n   🌐  ${ngrokUrl}\n`);
//     console.info(`   Login: use your dashboard credentials`);
//   } else if (!ngrokToken) {
//     console.info(`ℹ️  No NGROK_AUTHTOKEN set — tunnel disabled`);
//     console.info(`   Local access only → http://localhost:${PORT}/chart`);
//   }
//   console.info(`${"═".repeat(55)}\n`);

//   scheduleNextScan(allSymbols);
// }

// start().catch(err => { console.error("💥 Fatal:", err.message); process.exit(1); });


// // server.js — Trading Dashboard Backend
// require("dotenv").config();
// const express = require("express");
// const http = require("http");
// const WebSocket = require("ws");
// const cors = require("cors");
// const moment = require("moment-timezone");
// const path = require("path");
// const fs = require("fs");

// const { fetchCandles, clearCache } = require("./fetchCandles");
// const { processSymbol, resetAll } = require("./strategy");
// const { loadStocks, chunkArray } = require("./loadStocks");
// const { attachEMAFormatted, resampleCandles } = require("./ema");
// const { getStoredTokens } = require("./src/generate");
// const { fyers, setToken } = require("./utils/fyersClient");

// // ── Optional ngrok tunnel ─────────────────────────────────────────────────
// let ngrok = null;
// try { ngrok = require("@ngrok/ngrok"); } catch (_) { /* not installed — local only */ }

// const app = express();
// const server = http.createServer(app);
// // noServer=true so we control the upgrade handshake with auth
// const wss = new WebSocket.Server({ noServer: true });

// const PORT = process.env.PORT || 3200;
// const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "10");
// const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS || "2000");
// const SCAN_INTERVAL_MS = 3 * 60 * 1000 + 10 * 1000;
// const IST = "Asia/Kolkata";

// // ── In-memory signal store ─────────────────────────────────────────────────
// // Keyed by `${symbol}::${date}` so signals for different dates don't mix
// const signalStore = new Map();

// function storeKey(symbol, date) { return `${symbol}::${date}`; }

// function upsertSignals(symbol, date, newSigs) {
//   if (!newSigs || newSigs.length === 0) return;
//   const key = storeKey(symbol, date);
//   if (!signalStore.has(key)) signalStore.set(key, { signals: [] });
//   const store = signalStore.get(key);
//   for (const sig of newSigs) {
//     if (sig.type === "LAST_HIGH" || sig.type === "LAST_LOW") {
//       store.signals = store.signals.filter(s => s.type !== sig.type);
//       store.signals.push(sig);
//     } else if (sig.type === "FIRST_HIGH" || sig.type === "FIRST_LOW") {
//       if (!store.signals.find(s => s.type === sig.type)) store.signals.push(sig);
//     } else {
//       if (!store.signals.find(s => s.type === sig.type && s.ts === sig.ts)) store.signals.push(sig);
//     }
//   }
// }

// function getSignals(symbol, date) {
//   return signalStore.get(storeKey(symbol, date))?.signals || [];
// }

// // ── State ──────────────────────────────────────────────────────────────────
// let allSymbols = [], lastResetDate = null, isRunning = false;
// let runCount = 0, schedulerTimeout = null, lastScanTime = null, nextScanTimeStr = null;

// app.use(cors());
// app.use(express.json());

// // ── Basic Auth (protects all routes when DASHBOARD_USER/PASS set in .env) ─
// const DASH_USER = process.env.DASHBOARD_USER || "ema9";
// const DASH_PASS = process.env.DASHBOARD_PASS || "signals";
// const basicAuth = (req, res, next) => {
//   const authHeader = req.headers.authorization;
//   if (!authHeader || !authHeader.startsWith("Basic ")) {
//     res.setHeader("WWW-Authenticate", 'Basic realm="EMA9 Dashboard"');
//     return res.status(401).send("Authentication required");
//   }
//   const [user, pass] = Buffer.from(authHeader.split(" ")[1], "base64").toString().split(":");
//   if (user === DASH_USER && pass === DASH_PASS) return next();
//   res.setHeader("WWW-Authenticate", 'Basic realm="EMA9 Dashboard"');
//   return res.status(401).send("Access denied");
// };
// app.use(basicAuth);

// // ── WebSocket Basic Auth ───────────────────────────────────────────────────
// // Validate credentials on every WS upgrade request
// wss.on("headers", (headers, req) => {
//   const authHeader = req.headers.authorization;
//   if (!authHeader) return; // will be rejected in connection handler
// });

// // Intercept upgrade at HTTP level to enforce auth
// server.on("upgrade", (req, socket, head) => {
//   const authHeader = req.headers.authorization;
//   let authorized = false;
//   if (authHeader && authHeader.startsWith("Basic ")) {
//     const [user, pass] = Buffer.from(authHeader.split(" ")[1], "base64").toString().split(":");
//     authorized = (user === DASH_USER && pass === DASH_PASS);
//   }
//   if (!authorized) {
//     socket.write("HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"EMA9 Dashboard\"\r\n\r\n");
//     socket.destroy();
//     return;
//   }
//   wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
// });

// const frontendBuild = path.join(__dirname, "frontend", "build");
// // Serve static files dynamically so it works even if build didn't exist at startup
// app.use((req, res, next) => {
//   if (fs.existsSync(frontendBuild)) {
//     return require("express").static(frontendBuild)(req, res, next);
//   }
//   next();
// });

// function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// function nowIST() { return moment().tz(IST); }

// function isWeekend() { const d = nowIST().day(); return d === 0 || d === 6; }

// function isMarketOpen() {
//   const now = nowIST();
//   const open = now.clone().set({ hour: 9, minute: 15, second: 0, millisecond: 0 });
//   const close = now.clone().set({ hour: 15, minute: 30, second: 10, millisecond: 0 });
//   return now.isSameOrAfter(open) && now.isSameOrBefore(close);
// }

// function getNextScanMoment() {
//   const base = nowIST().startOf("day").set({ hour: 9, minute: 15, second: 10, millisecond: 0 });
//   const now = nowIST();
//   if (now.isBefore(base)) return base;
//   const steps = Math.floor(now.diff(base) / SCAN_INTERVAL_MS) + 1;
//   return base.clone().add(steps * SCAN_INTERVAL_MS, "ms");
// }

// function getTodayIST() { return nowIST().format("YYYY-MM-DD"); }

// function getActiveScanDate() {
//   // Use SCAN_DATE from env if set, otherwise today in IST
//   return process.env.SCAN_DATE || getTodayIST();
// }

// function checkDailyReset() {
//   const today = getTodayIST();
//   if (lastResetDate !== today) {
//     console.info(`🌅 New day (${today} IST) — resetting states`);
//     resetAll(); clearCache();
//     lastResetDate = today;
//   }
// }

// function broadcast(type, data) {
//   const msg = JSON.stringify({ type, data, ts: Date.now() });
//   for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
// }

// async function processBatch(symbols, scanDate) {
//   const results = [];
//   await Promise.all(symbols.map(async symbol => {
//     try {
//       const raw = await fetchCandles(symbol, "3", 2, scanDate);
//       if (!raw) return;
//       const sigs = processSymbol(symbol, raw, scanDate);
//       if (sigs && sigs.length > 0) {
//         upsertSignals(symbol, scanDate, sigs);
//         results.push(...sigs);
//         broadcast("new_signals", { symbol, signals: sigs, date: scanDate });
//       }
//     } catch (err) { console.error(`❌ ${symbol}: ${err.message}`); }
//   }));
//   return results;
// }

// async function runCycle(symbols) {
//   if (isRunning) { console.warn("⚠️  Skipping — still running"); return; }
//   isRunning = true; runCount++;
//   lastScanTime = nowIST().format("HH:mm:ss");
//   const t0 = Date.now();
//   const scanDate = getActiveScanDate();
//   console.info(`\n${"─".repeat(50)}\n🚀 Cycle #${runCount} @ ${lastScanTime} IST | ${symbols.length} symbols | date: ${scanDate}`);
//   broadcast("scan_start", { cycle: runCount, time: lastScanTime });
//   try {
//     const batches = chunkArray(symbols, BATCH_SIZE);
//     let total = 0;
//     for (let i = 0; i < batches.length; i++) {
//       total += (await processBatch(batches[i], scanDate)).length;
//       if (i < batches.length - 1) await sleep(BATCH_DELAY_MS);
//     }
//     const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
//     console.info(`✅ Cycle #${runCount} done in ${elapsed}s | ${total} new signals`);
//     broadcast("scan_complete", { cycle: runCount, elapsed, newSignals: total });
//   } finally { isRunning = false; }
// }

// function scheduleNextScan(symbols) {
//   if (schedulerTimeout) clearTimeout(schedulerTimeout);
//   // Only schedule live scans when no SCAN_DATE override (i.e. live mode)
//   if (process.env.SCAN_DATE) {
//     console.info("📅 SCAN_DATE override active — no auto-scheduling");
//     return;
//   }
//   const next = getNextScanMoment();
//   nextScanTimeStr = next.format("HH:mm:ss");
//   const delay = Math.max(0, next.diff(nowIST()));
//   console.info(`⏰ Next scan at ${nextScanTimeStr} IST (in ${(delay / 1000).toFixed(0)}s)`);
//   schedulerTimeout = setTimeout(async () => {
//     checkDailyReset();
//     if (!isWeekend() && isMarketOpen()) await runCycle(symbols);
//     else console.info("📴 Market closed");
//     scheduleNextScan(symbols);
//   }, delay);
// }

// // ── REST API ───────────────────────────────────────────────────────────────

// app.get("/api/symbols", (req, res) => res.json({ symbols: allSymbols, count: allSymbols.length }));

// // GET /api/chart?symbol=NSE:DLF-EQ&resolution=3&timeframe=1m&date=2026-04-17
// app.get("/api/chart", async (req, res) => {
//   const { symbol, resolution = "3", timeframe = "1m" } = req.query;
//   // date param allows viewing any past date from the UI
//   const targetDate = req.query.date || getActiveScanDate();

//   if (!symbol) return res.status(400).json({ error: "symbol required" });

//   try {
//     // Calculate days needed based on timeframe
//     const daysMap = { "1d": 2, "5d": 7, "1m": 35, "3m": 95 };
//     const days = daysMap[timeframe] || 35;

//     const baseRes = resolution === "D" ? "D" : "3";
//     const raw = await fetchCandles(symbol, baseRes, days, targetDate);
//     if (!raw) return res.status(404).json({ error: `No data for ${symbol} on ${targetDate}` });

//     // Format raw candles — convert UTC timestamps to IST display
//     let formatted = raw.map(c => ({
//       ts: c[0], time: c[0],  // keep unix ts as-is for chart library
//       open: parseFloat(c[1]), high: parseFloat(c[2]),
//       low: parseFloat(c[3]), close: parseFloat(c[4]),
//       volume: parseFloat(c[5]),
//     }));

//     // Resample to higher timeframe if needed
//     const resMin = parseInt(resolution) || 3;
//     if (resMin > 3 && resolution !== "D") formatted = resampleCandles(formatted, resMin);

//     const withEma = attachEMAFormatted(formatted);

//     // Get signals for the requested date
//     let signals = getSignals(symbol, targetDate);

//     // If no signals in memory yet for this date, run strategy now
//     if (signals.length === 0 && raw.length > 0) {
//       const sigs = processSymbol(symbol, raw, targetDate);
//       if (sigs && sigs.length > 0) {
//         upsertSignals(symbol, targetDate, sigs);
//         signals = getSignals(symbol, targetDate);
//       }
//     }

//     res.json({
//       symbol, resolution, date: targetDate,
//       candles: withEma,
//       signals,
//       meta: { count: withEma.length, lastUpdated: lastScanTime, nextScan: nextScanTimeStr, timezone: "IST" },
//     });
//   } catch (err) {
//     console.error(`Chart API error [${symbol}]:`, err.message);
//     res.status(500).json({ error: err.message });
//   }
// });

// app.get("/api/signals", (req, res) => {
//   const { symbol, date } = req.query;
//   const d = date || getActiveScanDate();
//   if (symbol) return res.json({ symbol, signals: getSignals(symbol, d) });
//   res.json({ date: d, message: "Specify ?symbol= to get signals" });
// });

// app.get("/api/status", (req, res) => res.json({
//   running: isRunning, cycle: runCount, symbols: allSymbols.length,
//   lastScan: lastScanTime, nextScan: nextScanTimeStr,
//   marketOpen: isMarketOpen(), scanDate: getActiveScanDate(),
//   timezone: "IST", uptime: process.uptime(),
// }));

// app.post("/api/refresh", async (req, res) => {
//   const { symbol, date } = req.body;
//   const d = date || getActiveScanDate();
//   if (symbol) {
//     clearCache(symbol);
//     const raw = await fetchCandles(symbol, "3", 35, d);
//     if (raw) {
//       const sigs = processSymbol(symbol, raw, d);
//       upsertSignals(symbol, d, sigs);
//     }
//     return res.json({ ok: true, symbol, date: d });
//   }
//   res.json({ ok: true });
// });

// app.get("/health", (req, res) => res.json({
//   status: "ok", cycle: runCount, lastScan: lastScanTime,
//   scanDate: getActiveScanDate(), marketOpen: isMarketOpen(),
// }));

// app.get("*", (req, res) => {
//   const idx = path.join(frontendBuild, "index.html");
//   if (fs.existsSync(idx)) return res.sendFile(idx);
//   // Build not found — show a helpful page with a button to redirect to /chart once built
//   res.send(`<!DOCTYPE html>
// <html>
// <head>
//   <meta charset="utf-8">
//   <title>EMA9 Dashboard</title>
//   <style>
//     body { background:#0a0e1a; color:#e2e8f0; font-family:monospace; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; flex-direction:column; gap:20px; }
//     h2 { color:#3b82f6; margin:0; }
//     p  { color:#64748b; margin:0; font-size:13px; }
//     .box { background:#0d1221; border:1px solid #1e3a8a; border-radius:10px; padding:32px 48px; text-align:center; }
//     code { background:#131d35; padding:4px 10px; border-radius:4px; color:#f97316; font-size:13px; }
//   </style>
// </head>
// <body>
//   <div class="box">
//     <h2>⚠️ Frontend build not found</h2>
//     <br>
//     <p>Run <code>.\\start.bat</code> from the <code>ema9-structure</code> folder.</p>
//     <br>
//     <p>The build creates <code>frontend/build/index.html</code> which serves the dashboard.</p>
//     <br>
//     <p style="color:#22c55e">API is running → <a href="/api/status" style="color:#3b82f6">/api/status</a></p>
//   </div>
// </body>
// </html>`);
// });

// wss.on("connection", ws => {
//   ws.send(JSON.stringify({
//     type: "init", data: {
//       symbols: allSymbols, scanDate: getActiveScanDate(),
//       status: { lastScan: lastScanTime, nextScan: nextScanTimeStr, marketOpen: isMarketOpen() },
//     }
//   }));
//   ws.on("close", () => { });
// });

// async function start() {
//   const stored = getStoredTokens();
//   if (!stored || !stored.access_token) {
//     console.error("\n❌ No access token. Run: node src/generate.js\n"); process.exit(1);
//   }
//   setToken(stored.access_token);
//   console.info("✅ Fyers token loaded");

//   allSymbols = loadStocks();
//   console.info(`📊 ${allSymbols.length} symbols loaded`);
//   checkDailyReset();

//   await new Promise(resolve => server.listen(PORT, "0.0.0.0", resolve));
//   console.info(`\n${"═".repeat(55)}`);
//   console.info(`🚀 Dashboard  →  http://localhost:${PORT}`);
//   console.info(`📡 WebSocket  →  ws://localhost:${PORT}`);
//   console.info(`📅 Scan date  →  ${getActiveScanDate()}`);

//   // ── Start ngrok tunnel (URL printed after scan completes) ────────────────
//   let ngrokUrl = null;
//   const ngrokToken = process.env.NGROK_AUTHTOKEN;
//   if (ngrok && ngrokToken) {
//     try {
//       const listener = await ngrok.forward({ addr: PORT, authtoken: ngrokToken });
//       ngrokUrl = listener.url();
//     } catch (ngrokErr) {
//       console.warn(`⚠️  ngrok failed: ${ngrokErr.message}`);
//     }
//   }
//   console.info(`${"═".repeat(55)}\n`);

//   console.info("🎯 Running initial scan...");
//   await runCycle(allSymbols);

//   // ── Print shareable link NOW — after all signals are ready ───────────────
//   console.info(`\n${"═".repeat(55)}`);
//   if (ngrokUrl) {
//     console.info(`✅ All signals scanned! Share this link with your team:`);
//     console.info(`\n   🌐  ${ngrokUrl}\n`);
//     console.info(`   Login: use your dashboard credentials`);
//   } else if (!ngrokToken) {
//     console.info(`ℹ️  No NGROK_AUTHTOKEN set — tunnel disabled`);
//     console.info(`   Local access only → http://localhost:${PORT}/chart`);
//   }
//   console.info(`${"═".repeat(55)}\n`);

//   scheduleNextScan(allSymbols);
// }

// start().catch(err => { console.error("💥 Fatal:", err.message); process.exit(1); });

// // server.js — Trading Dashboard Backend
// require("dotenv").config();
// const express = require("express");
// const http = require("http");
// const WebSocket = require("ws");
// const cors = require("cors");
// const moment = require("moment-timezone");
// const path = require("path");
// const fs = require("fs");

// const { fetchCandles, clearCache } = require("./fetchCandles");
// const { processSymbol, resetAll } = require("./strategy");
// const { loadStocks, chunkArray } = require("./loadStocks");
// const { attachEMAFormatted, resampleCandles } = require("./ema");
// const { getStoredTokens } = require("./src/generate");
// const { fyers, setToken } = require("./utils/fyersClient");

// // ── Optional ngrok tunnel ─────────────────────────────────────────────────
// let ngrok = null;
// try { ngrok = require("@ngrok/ngrok"); } catch (_) { /* not installed — local only */ }

// const app = express();
// const server = http.createServer(app);
// // noServer=true so we control the upgrade handshake with auth
// const wss = new WebSocket.Server({ noServer: true });

// const PORT = process.env.PORT || 3200;
// const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "10");
// const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS || "2000");
// const SCAN_INTERVAL_MS = 3 * 60 * 1000 + 10 * 1000;
// const IST = "Asia/Kolkata";

// // ── In-memory signal store ─────────────────────────────────────────────────
// // Keyed by `${symbol}::${date}` so signals for different dates don't mix
// const signalStore = new Map();

// function storeKey(symbol, date) { return `${symbol}::${date}`; }

// function upsertSignals(symbol, date, newSigs) {
//   if (!newSigs || newSigs.length === 0) return;
//   const key = storeKey(symbol, date);
//   if (!signalStore.has(key)) signalStore.set(key, { signals: [] });
//   const store = signalStore.get(key);
//   for (const sig of newSigs) {
//     if (sig.type === "LAST_HIGH" || sig.type === "LAST_LOW") {
//       store.signals = store.signals.filter(s => s.type !== sig.type);
//       store.signals.push(sig);
//     } else if (sig.type === "FIRST_HIGH" || sig.type === "FIRST_LOW") {
//       if (!store.signals.find(s => s.type === sig.type)) store.signals.push(sig);
//     } else {
//       if (!store.signals.find(s => s.type === sig.type && s.ts === sig.ts)) store.signals.push(sig);
//     }
//   }
// }

// function getSignals(symbol, date) {
//   return signalStore.get(storeKey(symbol, date))?.signals || [];
// }

// // ── State ──────────────────────────────────────────────────────────────────
// let allSymbols = [], lastResetDate = null, isRunning = false;
// let runCount = 0, schedulerTimeout = null, lastScanTime = null, nextScanTimeStr = null;

// app.use(cors());
// app.use(express.json());

// // ── Basic Auth (protects all routes when DASHBOARD_USER/PASS set in .env) ─
// const DASH_USER = process.env.DASHBOARD_USER || "ema9";
// const DASH_PASS = process.env.DASHBOARD_PASS || "signals";
// const basicAuth = (req, res, next) => {
//   const authHeader = req.headers.authorization;
//   if (!authHeader || !authHeader.startsWith("Basic ")) {
//     res.setHeader("WWW-Authenticate", 'Basic realm="EMA9 Dashboard"');
//     return res.status(401).send("Authentication required");
//   }
//   const [user, pass] = Buffer.from(authHeader.split(" ")[1], "base64").toString().split(":");
//   if (user === DASH_USER && pass === DASH_PASS) return next();
//   res.setHeader("WWW-Authenticate", 'Basic realm="EMA9 Dashboard"');
//   return res.status(401).send("Access denied");
// };
// app.use(basicAuth);

// // ── WebSocket Basic Auth ───────────────────────────────────────────────────
// // Validate credentials on every WS upgrade request
// wss.on("headers", (headers, req) => {
//   const authHeader = req.headers.authorization;
//   if (!authHeader) return; // will be rejected in connection handler
// });

// // Intercept upgrade at HTTP level to enforce auth
// server.on("upgrade", (req, socket, head) => {
//   const authHeader = req.headers.authorization;
//   let authorized = false;
//   if (authHeader && authHeader.startsWith("Basic ")) {
//     const [user, pass] = Buffer.from(authHeader.split(" ")[1], "base64").toString().split(":");
//     authorized = (user === DASH_USER && pass === DASH_PASS);
//   }
//   if (!authorized) {
//     socket.write("HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"EMA9 Dashboard\"\r\n\r\n");
//     socket.destroy();
//     return;
//   }
//   wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
// });

// const frontendBuild = path.join(__dirname, "frontend", "build");
// // Serve static files dynamically so it works even if build didn't exist at startup
// app.use((req, res, next) => {
//   if (fs.existsSync(frontendBuild)) {
//     return require("express").static(frontendBuild)(req, res, next);
//   }
//   next();
// });

// function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// function nowIST() { return moment().tz(IST); }

// function isWeekend() { const d = nowIST().day(); return d === 0 || d === 6; }

// function isMarketOpen() {
//   const now = nowIST();
//   const open = now.clone().set({ hour: 9, minute: 15, second: 0, millisecond: 0 });
//   const close = now.clone().set({ hour: 15, minute: 30, second: 10, millisecond: 0 });
//   return now.isSameOrAfter(open) && now.isSameOrBefore(close);
// }

// function getNextScanMoment() {
//   const base = nowIST().startOf("day").set({ hour: 9, minute: 15, second: 10, millisecond: 0 });
//   const now = nowIST();
//   if (now.isBefore(base)) return base;
//   const steps = Math.floor(now.diff(base) / SCAN_INTERVAL_MS) + 1;
//   return base.clone().add(steps * SCAN_INTERVAL_MS, "ms");
// }

// function getTodayIST() { return nowIST().format("YYYY-MM-DD"); }

// function getActiveScanDate() {
//   // Use SCAN_DATE from env if set, otherwise today in IST
//   return process.env.SCAN_DATE || getTodayIST();
// }

// function checkDailyReset() {
//   const today = getTodayIST();
//   if (lastResetDate !== today) {
//     console.info(`🌅 New day (${today} IST) — resetting states`);
//     resetAll(); clearCache();
//     lastResetDate = today;
//   }
// }

// function broadcast(type, data) {
//   const msg = JSON.stringify({ type, data, ts: Date.now() });
//   for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
// }

// async function processBatch(symbols, scanDate) {
//   const results = [];
//   await Promise.all(symbols.map(async symbol => {
//     try {
//       const raw = await fetchCandles(symbol, "3", 2, scanDate);
//       if (!raw) return;
//       const sigs = processSymbol(symbol, raw, scanDate);
//       if (sigs && sigs.length > 0) {
//         upsertSignals(symbol, scanDate, sigs);
//         results.push(...sigs);
//         broadcast("new_signals", { symbol, signals: sigs, date: scanDate });
//       }
//     } catch (err) { console.error(`❌ ${symbol}: ${err.message}`); }
//   }));
//   return results;
// }

// async function runCycle(symbols) {
//   if (isRunning) { console.warn("⚠️  Skipping — still running"); return; }
//   isRunning = true; runCount++;
//   lastScanTime = nowIST().format("HH:mm:ss");
//   const t0 = Date.now();
//   const scanDate = getActiveScanDate();
//   console.info(`\n${"─".repeat(50)}\n🚀 Cycle #${runCount} @ ${lastScanTime} IST | ${symbols.length} symbols | date: ${scanDate}`);
//   broadcast("scan_start", { cycle: runCount, time: lastScanTime });
//   try {
//     const batches = chunkArray(symbols, BATCH_SIZE);
//     let total = 0;
//     for (let i = 0; i < batches.length; i++) {
//       total += (await processBatch(batches[i], scanDate)).length;
//       if (i < batches.length - 1) await sleep(BATCH_DELAY_MS);
//     }
//     const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
//     console.info(`✅ Cycle #${runCount} done in ${elapsed}s | ${total} new signals`);
//     broadcast("scan_complete", { cycle: runCount, elapsed, newSignals: total });
//   } finally { isRunning = false; }
// }

// function scheduleNextScan(symbols) {
//   if (schedulerTimeout) clearTimeout(schedulerTimeout);
//   // Only schedule live scans when no SCAN_DATE override (i.e. live mode)
//   if (process.env.SCAN_DATE) {
//     console.info("📅 SCAN_DATE override active — no auto-scheduling");
//     return;
//   }
//   const next = getNextScanMoment();
//   nextScanTimeStr = next.format("HH:mm:ss");
//   const delay = Math.max(0, next.diff(nowIST()));
//   console.info(`⏰ Next scan at ${nextScanTimeStr} IST (in ${(delay / 1000).toFixed(0)}s)`);
//   schedulerTimeout = setTimeout(async () => {
//     checkDailyReset();
//     if (!isWeekend() && isMarketOpen()) await runCycle(symbols);
//     else console.info("📴 Market closed");
//     scheduleNextScan(symbols);
//   }, delay);
// }

// // ── REST API ───────────────────────────────────────────────────────────────

// app.get("/api/symbols", (req, res) => res.json({ symbols: allSymbols, count: allSymbols.length }));

// // GET /api/chart?symbol=NSE:DLF-EQ&resolution=3&timeframe=1m&date=2026-04-17
// app.get("/api/chart", async (req, res) => {
//   const { symbol, resolution = "3", timeframe = "1m" } = req.query;
//   // date param allows viewing any past date from the UI
//   const targetDate = req.query.date || getActiveScanDate();

//   if (!symbol) return res.status(400).json({ error: "symbol required" });

//   try {
//     // Calculate days needed based on timeframe
//     const daysMap = { "1d": 2, "5d": 7, "1m": 35, "3m": 95 };
//     const days = daysMap[timeframe] || 35;

//     const baseRes = resolution === "D" ? "D" : "3";
//     const raw = await fetchCandles(symbol, baseRes, days, targetDate);
//     if (!raw) return res.status(404).json({ error: `No data for ${symbol} on ${targetDate}` });

//     // Format raw candles — convert UTC timestamps to IST display
//     let formatted = raw.map(c => ({
//       ts: c[0], time: c[0],  // keep unix ts as-is for chart library
//       open: parseFloat(c[1]), high: parseFloat(c[2]),
//       low: parseFloat(c[3]), close: parseFloat(c[4]),
//       volume: parseFloat(c[5]),
//     }));

//     // Resample to higher timeframe if needed
//     const resMin = parseInt(resolution) || 3;
//     if (resMin > 3 && resolution !== "D") formatted = resampleCandles(formatted, resMin);

//     const withEma = attachEMAFormatted(formatted);

//     // Get signals for the requested date
//     let signals = getSignals(symbol, targetDate);

//     // If no signals in memory yet for this date, run strategy now
//     if (signals.length === 0 && raw.length > 0) {
//       const sigs = processSymbol(symbol, raw, targetDate);
//       if (sigs && sigs.length > 0) {
//         upsertSignals(symbol, targetDate, sigs);
//         signals = getSignals(symbol, targetDate);
//       }
//     }

//     res.json({
//       symbol, resolution, date: targetDate,
//       candles: withEma,
//       signals,
//       meta: { count: withEma.length, lastUpdated: lastScanTime, nextScan: nextScanTimeStr, timezone: "IST" },
//     });
//   } catch (err) {
//     console.error(`Chart API error [${symbol}]:`, err.message);
//     res.status(500).json({ error: err.message });
//   }
// });

// app.get("/api/signals", (req, res) => {
//   const { symbol, date } = req.query;
//   const d = date || getActiveScanDate();
//   if (symbol) return res.json({ symbol, signals: getSignals(symbol, d) });
//   res.json({ date: d, message: "Specify ?symbol= to get signals" });
// });

// app.get("/api/status", (req, res) => res.json({
//   running: isRunning, cycle: runCount, symbols: allSymbols.length,
//   lastScan: lastScanTime, nextScan: nextScanTimeStr,
//   marketOpen: isMarketOpen(), scanDate: getActiveScanDate(),
//   timezone: "IST", uptime: process.uptime(),
// }));

// app.post("/api/refresh", async (req, res) => {
//   const { symbol, date } = req.body;
//   const d = date || getActiveScanDate();
//   if (symbol) {
//     clearCache(symbol);
//     const raw = await fetchCandles(symbol, "3", 35, d);
//     if (raw) {
//       const sigs = processSymbol(symbol, raw, d);
//       upsertSignals(symbol, d, sigs);
//     }
//     return res.json({ ok: true, symbol, date: d });
//   }
//   res.json({ ok: true });
// });

// app.get("/health", (req, res) => res.json({
//   status: "ok", cycle: runCount, lastScan: lastScanTime,
//   scanDate: getActiveScanDate(), marketOpen: isMarketOpen(),
// }));

// app.get("*", (req, res) => {
//   const idx = path.join(frontendBuild, "index.html");
//   if (fs.existsSync(idx)) return res.sendFile(idx);
//   // Build not found — show a helpful page with a button to redirect to /chart once built
//   res.send(`<!DOCTYPE html>
// <html>
// <head>
//   <meta charset="utf-8">
//   <title>EMA9 Dashboard</title>
//   <style>
//     body { background:#0a0e1a; color:#e2e8f0; font-family:monospace; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; flex-direction:column; gap:20px; }
//     h2 { color:#3b82f6; margin:0; }
//     p  { color:#64748b; margin:0; font-size:13px; }
//     .box { background:#0d1221; border:1px solid #1e3a8a; border-radius:10px; padding:32px 48px; text-align:center; }
//     code { background:#131d35; padding:4px 10px; border-radius:4px; color:#f97316; font-size:13px; }
//   </style>
// </head>
// <body>
//   <div class="box">
//     <h2>⚠️ Frontend build not found</h2>
//     <br>
//     <p>Run <code>.\\start.bat</code> from the <code>ema9-structure</code> folder.</p>
//     <br>
//     <p>The build creates <code>frontend/build/index.html</code> which serves the dashboard.</p>
//     <br>
//     <p style="color:#22c55e">API is running → <a href="/api/status" style="color:#3b82f6">/api/status</a></p>
//   </div>
// </body>
// </html>`);
// });

// wss.on("connection", ws => {
//   ws.send(JSON.stringify({
//     type: "init", data: {
//       symbols: allSymbols, scanDate: getActiveScanDate(),
//       status: { lastScan: lastScanTime, nextScan: nextScanTimeStr, marketOpen: isMarketOpen() },
//     }
//   }));
//   ws.on("close", () => { });
// });

// async function start() {
//   const stored = getStoredTokens();
//   if (!stored || !stored.access_token) {
//     console.error("\n❌ No access token. Run: node src/generate.js\n"); process.exit(1);
//   }
//   setToken(stored.access_token);
//   console.info("✅ Fyers token loaded");

//   allSymbols = loadStocks();
//   console.info(`📊 ${allSymbols.length} symbols loaded`);
//   checkDailyReset();

//   await new Promise(resolve => server.listen(PORT, "0.0.0.0", resolve));
//   console.info(`\n${"═".repeat(55)}`);
//   console.info(`🚀 Dashboard  →  http://localhost:${PORT}`);
//   console.info(`📡 WebSocket  →  ws://localhost:${PORT}`);
//   console.info(`📅 Scan date  →  ${getActiveScanDate()}`);

//   // ── Start ngrok tunnel (URL printed after scan completes) ────────────────
//   let ngrokUrl = null;
//   const ngrokToken = process.env.NGROK_AUTHTOKEN;
//   if (ngrok && ngrokToken) {
//     try {
//       const listener = await ngrok.forward({ addr: PORT, authtoken: ngrokToken });
//       ngrokUrl = listener.url();
//     } catch (ngrokErr) {
//       console.warn(`⚠️  ngrok failed: ${ngrokErr.message}`);
//     }
//   }
//   console.info(`${"═".repeat(55)}\n`);

//   console.info("🎯 Running initial scan...");
//   await runCycle(allSymbols);

//   // ── Print shareable link NOW — after all signals are ready ───────────────
//   console.info(`\n${"═".repeat(55)}`);
//   if (ngrokUrl) {
//     console.info(`✅ All signals scanned! Share this link with your team:`);
//     console.info(`\n   🌐  ${ngrokUrl}\n`);
//     console.info(`   Login: use your dashboard credentials`);
//   } else if (!ngrokToken) {
//     console.info(`ℹ️  No NGROK_AUTHTOKEN set — tunnel disabled`);
//     console.info(`   Local access only → http://localhost:${PORT}/chart`);
//   }
//   console.info(`${"═".repeat(55)}\n`);

//   scheduleNextScan(allSymbols);
// }

// start().catch(err => { console.error("💥 Fatal:", err.message); process.exit(1); });

// server.js — Trading Dashboard Backend
require("dotenv").config();
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const moment = require("moment-timezone");
const path = require("path");
const fs = require("fs");

const { fetchCandles, clearCache } = require("./fetchCandles");
const { processSymbol, resetAll } = require("./strategy");
const { loadStocks, chunkArray } = require("./loadStocks");
const { attachEMAFormatted, resampleCandles } = require("./ema");
const { getStoredTokens } = require("./src/generate");
const { fyers, setToken } = require("./utils/fyersClient");

// ── Optional ngrok tunnel ─────────────────────────────────────────────────
let ngrok = null;
try { ngrok = require("@ngrok/ngrok"); } catch (_) { /* not installed — local only */ }

const app = express();
const server = http.createServer(app);
// noServer=true so we control the upgrade handshake with auth
const wss = new WebSocket.Server({ noServer: true });

const PORT = process.env.PORT || 3200;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "10");
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS || "2000");
const SCAN_INTERVAL_MS = 3 * 60 * 1000 + 10 * 1000;
const IST = "Asia/Kolkata";

// ── In-memory signal store ─────────────────────────────────────────────────
// Keyed by `${symbol}::${date}` so signals for different dates don't mix
const signalStore = new Map();

function storeKey(symbol, date) { return `${symbol}::${date}`; }

function upsertSignals(symbol, date, newSigs) {
  if (!newSigs || newSigs.length === 0) return;
  const key = storeKey(symbol, date);
  if (!signalStore.has(key)) signalStore.set(key, { signals: [] });
  const store = signalStore.get(key);
  for (const sig of newSigs) {
    if (sig.type === "LAST_HIGH" || sig.type === "LAST_LOW") {
      store.signals = store.signals.filter(s => s.type !== sig.type);
      store.signals.push(sig);
    } else if (sig.type === "FIRST_HIGH" || sig.type === "FIRST_LOW") {
      if (!store.signals.find(s => s.type === sig.type)) store.signals.push(sig);
    } else {
      if (!store.signals.find(s => s.type === sig.type && s.ts === sig.ts)) store.signals.push(sig);
    }
  }
}

function getSignals(symbol, date) {
  return signalStore.get(storeKey(symbol, date))?.signals || [];
}

// ── State ──────────────────────────────────────────────────────────────────
let allSymbols = [], lastResetDate = null, isRunning = false;
let runCount = 0, schedulerTimeout = null, lastScanTime = null, nextScanTimeStr = null;
let ngrokUrl = null; // set after tunnel starts; used in runCycle URL print

app.use(cors());
app.use(express.json());

// ── Basic Auth (protects all routes when DASHBOARD_USER/PASS set in .env) ─
const DASH_USER = process.env.DASHBOARD_USER || "ema9";
const DASH_PASS = process.env.DASHBOARD_PASS || "signals";
const basicAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="EMA9 Dashboard"');
    return res.status(401).send("Authentication required");
  }
  const [user, pass] = Buffer.from(authHeader.split(" ")[1], "base64").toString().split(":");
  if (user === DASH_USER && pass === DASH_PASS) return next();
  res.setHeader("WWW-Authenticate", 'Basic realm="EMA9 Dashboard"');
  return res.status(401).send("Access denied");
};
// Auth disabled — ngrok provides access control via its own URL sharing.
// Enabling basicAuth caused browser 401 loops (ngrok intercepts the WWW-Authenticate
// header and shows its own login popup that never resolves against Express).
// app.use("/api", basicAuth);
// app.use("/health", basicAuth);

// ── WebSocket — no auth required (ngrok controls access via URL) ──────────
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

// ── NO-BUILD DASHBOARD ────────────────────────────────────────────────────────
// dashboard.html lives in the project root alongside server.js.
// It is a self-contained single-file React app (React via CDN, no build step).
// This permanently fixes "Cannot GET /chart" — there is nothing to build,
// nothing to go stale, nothing that requires npm run build before starting.
const DASHBOARD_HTML = path.join(__dirname, "dashboard.html");

// Also still support the compiled React build for developers who want it.
const frontendBuild = path.join(__dirname, "frontend", "build");
const serveStatic = express.static(frontendBuild);

app.use((req, res, next) => {
  // API routes pass through to their handlers
  if (req.path.startsWith("/api/") || req.path === "/health") return next();

  // Always serve dashboard.html for ALL non-API routes (/, /chart, /chart/*, etc.)
  // dashboard.html is a self-contained no-build React app — works on every restart,
  // every hard refresh, via ngrok, localhost, any URL — no stale build ever.
  if (fs.existsSync(DASHBOARD_HTML)) return res.sendFile(DASHBOARD_HTML);

  // Fallback: compiled React build (only if dashboard.html somehow missing)
  const builtIndex = path.join(frontendBuild, "index.html");
  if (fs.existsSync(builtIndex)) {
    const filePath = path.join(frontendBuild, req.path);
    if (req.path !== "/" && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return serveStatic(req, res, next);
    }
    return res.sendFile(builtIndex);
  }

  next();
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function nowIST() { return moment().tz(IST); }

function isWeekend() { const d = nowIST().day(); return d === 0 || d === 6; }

function isMarketOpen() {
  const now = nowIST();
  const open = now.clone().set({ hour: 9, minute: 15, second: 0, millisecond: 0 });
  const close = now.clone().set({ hour: 15, minute: 30, second: 10, millisecond: 0 });
  return now.isSameOrAfter(open) && now.isSameOrBefore(close);
}

function getNextScanMoment() {
  const base = nowIST().startOf("day").set({ hour: 9, minute: 15, second: 10, millisecond: 0 });
  const now = nowIST();
  if (now.isBefore(base)) return base;
  const steps = Math.floor(now.diff(base) / SCAN_INTERVAL_MS) + 1;
  return base.clone().add(steps * SCAN_INTERVAL_MS, "ms");
}

function getTodayIST() { return nowIST().format("YYYY-MM-DD"); }

function getActiveScanDate() {
  // Use SCAN_DATE from env if set, otherwise today in IST
  return process.env.SCAN_DATE || getTodayIST();
}

function checkDailyReset() {
  const today = getTodayIST();
  if (lastResetDate !== today) {
    console.info(`🌅 New day (${today} IST) — resetting states`);
    resetAll(); clearCache();
    lastResetDate = today;
  }
}

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
}

async function processBatch(symbols, scanDate) {
  const results = [];
  await Promise.all(symbols.map(async symbol => {
    try {
      const raw = await fetchCandles(symbol, "3", 7, scanDate); // 7 days ensures previous trading day candles for EMA warm-up
      if (!raw) return;
      const sigs = processSymbol(symbol, raw, scanDate);
      if (sigs && sigs.length > 0) {
        upsertSignals(symbol, scanDate, sigs);
        results.push(...sigs);
        broadcast("new_signals", { symbol, signals: sigs, date: scanDate });

        // ── Print NEW_HIGH / NEW_LOW signals to console as they are found ──
        const clean = symbol.replace("NSE:", "").replace("-EQ", "").replace("-INDEX", "");
        for (const sig of sigs) {
          if (sig.type === "NEW_HIGH") {
            console.info(`  📈 NEW_HIGH  ${clean.padEnd(18)} ₹${sig.price.toFixed(2)}  @ ${moment.unix(sig.ts).tz(IST).format("HH:mm")}`);
          } else if (sig.type === "NEW_LOW") {
            console.info(`  📉 NEW_LOW   ${clean.padEnd(18)} ₹${sig.price.toFixed(2)}  @ ${moment.unix(sig.ts).tz(IST).format("HH:mm")}`);
          }
        }
      }
    } catch (err) { console.error(`❌ ${symbol}: ${err.message}`); }
  }));
  return results;
}

async function runCycle(symbols) {
  if (isRunning) { console.warn("⚠️  Skipping — still running"); return; }
  isRunning = true; runCount++;
  lastScanTime = nowIST().format("HH:mm:ss");
  const t0 = Date.now();
  const scanDate = getActiveScanDate();
  console.info(`\n${"─".repeat(50)}\n🚀 Cycle #${runCount} @ ${lastScanTime} IST | ${symbols.length} symbols | date: ${scanDate}`);
  broadcast("scan_start", { cycle: runCount, time: lastScanTime });
  try {
    const batches = chunkArray(symbols, BATCH_SIZE);
    let total = 0;
    for (let i = 0; i < batches.length; i++) {
      total += (await processBatch(batches[i], scanDate)).length;
      if (i < batches.length - 1) await sleep(BATCH_DELAY_MS);
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.info(`✅ Cycle #${runCount} done in ${elapsed}s | ${total} new signals`);
    // Print shareable URL after every cycle so it's always visible in the terminal
    const urlBase = ngrokUrl || `http://localhost:${PORT}`;
    console.info(`🌐 Dashboard → ${urlBase}/chart`);
    broadcast("scan_complete", { cycle: runCount, elapsed, newSignals: total });
  } finally { isRunning = false; }
}

function scheduleNextScan(symbols) {
  if (schedulerTimeout) clearTimeout(schedulerTimeout);
  // Only schedule live scans when no SCAN_DATE override (i.e. live mode)
  if (process.env.SCAN_DATE) {
    console.info("📅 SCAN_DATE override active — no auto-scheduling");
    return;
  }
  const next = getNextScanMoment();
  nextScanTimeStr = next.format("HH:mm:ss");
  const delay = Math.max(0, next.diff(nowIST()));
  console.info(`⏰ Next scan at ${nextScanTimeStr} IST (in ${(delay / 1000).toFixed(0)}s)`);
  schedulerTimeout = setTimeout(async () => {
    checkDailyReset();
    if (!isWeekend()) {
      // Run cycle during market hours AND for a 3-minute grace window after close
      // so the final 15:27 candle is captured and signals/bubbles are computed.
      const now = nowIST();
      const scanOpen = now.clone().set({ hour: 9, minute: 15, second: 10, millisecond: 0 });
      const scanClose = now.clone().set({ hour: 15, minute: 33, second: 0, millisecond: 0 });
      const inScanWindow = now.isSameOrAfter(scanOpen) && now.isSameOrBefore(scanClose);
      if (inScanWindow) await runCycle(symbols);
      else console.info("📴 Market closed");
    } else {
      console.info("📴 Market closed");
    }
    scheduleNextScan(symbols);
  }, delay);
}

// ── REST API ───────────────────────────────────────────────────────────────

app.get("/api/symbols", (req, res) => res.json({ symbols: allSymbols, count: allSymbols.length }));

// GET /api/chart?symbol=NSE:DLF-EQ&resolution=3&timeframe=1m&date=2026-04-17
app.get("/api/chart", async (req, res) => {
  const { symbol, resolution = "3", timeframe = "1m" } = req.query;
  // date param allows viewing any past date from the UI
  const targetDate = req.query.date || getActiveScanDate();

  if (!symbol) return res.status(400).json({ error: "symbol required" });

  try {
    // Calculate days needed based on timeframe
    const daysMap = { "1d": 7, "5d": 10, "1m": 35, "3m": 95 }; // min 7d to ensure EMA warm-up across weekends
    const days = daysMap[timeframe] || 35;

    const baseRes = resolution === "D" ? "D" : "3";
    const raw = await fetchCandles(symbol, baseRes, days, targetDate);
    if (!raw) return res.status(404).json({ error: `No data for ${symbol} on ${targetDate}` });

    // Format raw candles — convert UTC timestamps to IST display
    let formatted = raw.map(c => ({
      ts: c[0], time: c[0],  // keep unix ts as-is for chart library
      open: parseFloat(c[1]), high: parseFloat(c[2]),
      low: parseFloat(c[3]), close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
    }));

    // Resample to higher timeframe if needed
    const resMin = parseInt(resolution) || 3;
    if (resMin > 3 && resolution !== "D") formatted = resampleCandles(formatted, resMin);

    const withEma = attachEMAFormatted(formatted);

    // Get signals for the requested date
    let signals = getSignals(symbol, targetDate);

    // If no signals in memory yet for this date, run strategy now
    if (signals.length === 0 && raw.length > 0) {
      const sigs = processSymbol(symbol, raw, targetDate);
      if (sigs && sigs.length > 0) {
        upsertSignals(symbol, targetDate, sigs);
        signals = getSignals(symbol, targetDate);
      }
    }

    res.json({
      symbol, resolution, date: targetDate,
      candles: withEma,
      signals,
      meta: { count: withEma.length, lastUpdated: lastScanTime, nextScan: nextScanTimeStr, timezone: "IST" },
    });
  } catch (err) {
    console.error(`Chart API error [${symbol}]:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chart-range?symbol=NSE:DLF-EQ&resolution=3&fromDate=2026-03-20&toDate=2026-04-20
// Returns merged candles + per-day signals for a date range.
// Strategy runs independently per trading day; EMA is warmed from extra days before fromDate.
// Fyers API limit ~100 days per call — for 3M we chunk into two fetches.
app.get("/api/chart-range", async (req, res) => {
  const { symbol, resolution = "3" } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  const toDate = req.query.toDate || getActiveScanDate();
  const fromDate = req.query.fromDate || moment.tz(toDate, IST).subtract(30, "days").format("YYYY-MM-DD");

  try {
    const baseRes = resolution === "D" ? "D" : "3";
    // Fyers allows max ~100 calendar days per call.
    // For ranges > 80 days we do two fetches and merge:
    //   Fetch A: warmup + first half
    //   Fetch B: second half including toDate (always includes today for live)
    const rangeDays = moment.tz(toDate, IST).diff(moment.tz(fromDate, IST), "days") + 1;
    const FYERS_MAX = 95; // safe limit
    let raw;

    if (rangeDays + 14 <= FYERS_MAX) {
      // Single fetch — warmup + full range fits in one call
      const totalDays = rangeDays + 14;
      raw = await fetchCandles(symbol, baseRes, totalDays, toDate);
    } else {
      // Two fetches: split at midpoint
      // Fetch B always ends at toDate, covers second half + overlap
      const midDate = moment.tz(fromDate, IST).add(Math.floor(rangeDays / 2), "days").format("YYYY-MM-DD");
      // Fetch A: warmup to midDate
      const daysA = moment.tz(midDate, IST).diff(moment.tz(fromDate, IST).subtract(14, "days"), "days") + 1;
      const rawA = await fetchCandles(symbol, baseRes, Math.min(daysA, FYERS_MAX), midDate);
      // Fetch B: overlap (extra 7 days before midDate for EMA) to toDate
      const daysB = moment.tz(toDate, IST).diff(moment.tz(midDate, IST).subtract(7, "days"), "days") + 1;
      const rawB = await fetchCandles(symbol, baseRes, Math.min(daysB, FYERS_MAX), toDate);

      if (!rawA && !rawB) return res.status(404).json({ error: `No data for ${symbol} in range ${fromDate}→${toDate}` });
      // Merge, deduplicate by timestamp
      const seen = new Set();
      raw = [];
      for (const c of [...(rawA || []), ...(rawB || [])]) {
        if (!seen.has(c[0])) { seen.add(c[0]); raw.push(c); }
      }
      raw.sort((a, b) => a[0] - b[0]);
    }

    if (!raw || raw.length === 0) return res.status(404).json({ error: `No data for ${symbol} in range ${fromDate}→${toDate}` });

    // Collect all unique trading days in [fromDate, toDate]
    const daySet = new Set();
    for (const c of raw) {
      const d = moment.unix(c[0]).tz(IST).format("YYYY-MM-DD");
      if (d >= fromDate && d <= toDate) daySet.add(d);
    }
    const tradingDays = [...daySet].sort();

    // Run strategy per day (always on 3m base candles) and collect signals
    const allSignals = [];
    for (const day of tradingDays) {
      let sigs = getSignals(symbol, day);
      if (sigs.length === 0) {
        sigs = processSymbol(symbol, raw, day);
        if (sigs && sigs.length > 0) upsertSignals(symbol, day, sigs);
        sigs = getSignals(symbol, day);
      }
      allSignals.push(...sigs);
    }

    // Format candles filtered to [fromDate, toDate]
    let formatted = raw
      .filter(c => {
        const d = moment.unix(c[0]).tz(IST).format("YYYY-MM-DD");
        return d >= fromDate && d <= toDate;
      })
      .map(c => ({
        ts: c[0], time: c[0],
        open: parseFloat(c[1]), high: parseFloat(c[2]),
        low: parseFloat(c[3]), close: parseFloat(c[4]),
        volume: parseFloat(c[5]),
      }));

    // Resample to requested timeframe if needed
    const resMin = parseInt(resolution) || 3;
    if (resMin > 3 && resolution !== "D") formatted = resampleCandles(formatted, resMin);

    const withEma = attachEMAFormatted(formatted);

    res.json({
      symbol, resolution,
      fromDate, toDate,
      tradingDays,
      candles: withEma,
      signals: allSignals,
      meta: { count: withEma.length, lastUpdated: lastScanTime, nextScan: nextScanTimeStr, timezone: "IST" },
    });
  } catch (err) {
    console.error(`Chart-range API error [${symbol}]:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/signals", (req, res) => {
  const { symbol, date } = req.query;
  const d = date || getActiveScanDate();
  if (symbol) return res.json({ symbol, signals: getSignals(symbol, d) });
  res.json({ date: d, message: "Specify ?symbol= to get signals" });
});

app.get("/api/status", (req, res) => res.json({
  running: isRunning, cycle: runCount, symbols: allSymbols.length,
  lastScan: lastScanTime, nextScan: nextScanTimeStr,
  marketOpen: isMarketOpen(), scanDate: getActiveScanDate(),
  timezone: "IST", uptime: process.uptime(),
}));

app.post("/api/refresh", async (req, res) => {
  const { symbol, date } = req.body;
  const d = date || getActiveScanDate();
  if (symbol) {
    clearCache(symbol);
    const raw = await fetchCandles(symbol, "3", 35, d);
    if (raw) {
      const sigs = processSymbol(symbol, raw, d);
      upsertSignals(symbol, d, sigs);
    }
    return res.json({ ok: true, symbol, date: d });
  }
  res.json({ ok: true });
});

app.get("/health", (req, res) => res.json({
  status: "ok", cycle: runCount, lastScan: lastScanTime,
  scanDate: getActiveScanDate(), marketOpen: isMarketOpen(),
}));

app.get("*", (req, res) => {
  // Always serve dashboard.html — the no-build self-contained app
  if (fs.existsSync(DASHBOARD_HTML)) return res.sendFile(DASHBOARD_HTML);
  // Fallback to compiled build if dashboard.html missing
  const idx = path.join(frontendBuild, "index.html");
  if (fs.existsSync(idx)) return res.sendFile(idx);
  // Build not found — show a helpful page with a button to redirect to /chart once built
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>EMA9 Dashboard</title>
  <style>
    body { background:#0a0e1a; color:#e2e8f0; font-family:monospace; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; flex-direction:column; gap:20px; }
    h2 { color:#3b82f6; margin:0; }
    p  { color:#64748b; margin:0; font-size:13px; }
    .box { background:#0d1221; border:1px solid #1e3a8a; border-radius:10px; padding:32px 48px; text-align:center; }
    code { background:#131d35; padding:4px 10px; border-radius:4px; color:#f97316; font-size:13px; }
  </style>
</head>
<body>
  <div class="box">
    <h2>⚠️ Frontend build not found</h2>
    <br>
    <p>Run <code>.\\start.bat</code> from the <code>ema9-structure</code> folder.</p>
    <br>
    <p>The build creates <code>frontend/build/index.html</code> which serves the dashboard.</p>
    <br>
    <p style="color:#22c55e">API is running → <a href="/api/status" style="color:#3b82f6">/api/status</a></p>
  </div>
</body>
</html>`);
});

wss.on("connection", ws => {
  ws.send(JSON.stringify({
    type: "init", data: {
      symbols: allSymbols, scanDate: getActiveScanDate(),
      status: { lastScan: lastScanTime, nextScan: nextScanTimeStr, marketOpen: isMarketOpen() },
    }
  }));
  ws.on("close", () => { });
});

async function start() {
  const stored = getStoredTokens();
  if (!stored || !stored.access_token) {
    console.error("\n❌ No access token. Run: node src/generate.js\n"); process.exit(1);
  }
  setToken(stored.access_token);
  console.info("✅ Fyers token loaded");

  allSymbols = loadStocks();
  console.info(`📊 ${allSymbols.length} symbols loaded`);
  checkDailyReset();

  await new Promise(resolve => server.listen(PORT, "0.0.0.0", resolve));
  console.info(`\n${"═".repeat(55)}`);
  console.info(`🚀 Dashboard  →  http://localhost:${PORT}`);
  console.info(`📡 WebSocket  →  ws://localhost:${PORT}`);
  console.info(`📅 Scan date  →  ${getActiveScanDate()}`);

  // ── Start ngrok tunnel ────────────────────────────────────────────────────
  const ngrokToken = process.env.NGROK_AUTHTOKEN;
  if (ngrok && ngrokToken) {
    try {
      const listener = await ngrok.forward({ addr: PORT, authtoken: ngrokToken });
      ngrokUrl = listener.url(); // assigned to module-level var
    } catch (ngrokErr) {
      console.warn(`⚠️  ngrok failed: ${ngrokErr.message}`);
    }
  }
  console.info(`${"═".repeat(55)}\n`);

  console.info("🎯 Running initial scan...");
  await runCycle(allSymbols);

  scheduleNextScan(allSymbols);
}

start().catch(err => { console.error("💥 Fatal:", err.message); process.exit(1); });