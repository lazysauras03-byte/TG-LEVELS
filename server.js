require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const { runFullAnalysis, getCachedData, getLastRefresh } = require("./analyzeTrades");

const app = express();
const PORT = process.env.PORT || 3600;

app.use(cors());

// 🔐 Basic Auth Middleware
const basicAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Analytics Dashboard"');
    return res.status(401).send('Authentication required');
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  if (username === 'TG' && password === '1234') {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Analytics Dashboard"');
  return res.status(401).send('Access denied');
};

app.use(basicAuth);

app.use(express.static(path.join(__dirname, "public")));

// GET /data — return cached analytics
app.get("/data", async (req, res) => {
  try {
    let data = getCachedData();
    if (!data) {
      console.log("🔄 No cache — running initial analysis...");
      data = await runFullAnalysis(); // auto-detects token
    }
    res.json({ success: true, last_refresh: getLastRefresh(), data });
  } catch (err) {
    console.error("❌ /data error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /refresh — force re-run
app.get("/refresh", async (req, res) => {
  try {
    const data = await runFullAnalysis(); // auto-detects token
    res.json({ success: true, last_refresh: getLastRefresh(), data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok", last_refresh: getLastRefresh() }));

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🚀 Trading Analytics Server → http://localhost:${PORT}`);
  console.log(`📊 Dashboard               → http://localhost:${PORT}/`);
  console.log(`🔌 API                     → http://localhost:${PORT}/data\n`);

  try {
    await runFullAnalysis(); // auto-detects token — no manual skipFyers needed
    console.log(`\n✅ Ready — visit http://localhost:${PORT}/`);
  } catch (err) {
    console.error("❌ Startup analysis failed:", err.message);
  }
});