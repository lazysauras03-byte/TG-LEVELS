# TGG — EMA9 NH/NL/BC Dashboard

Professional trading dashboard that visualises your Pine Script v6 EMA9 NH/NL/BC strategy using live Fyers API data.

```
TGG/
├── backend/          ← Node.js + Express + Socket.io
│   ├── src/
│   │   ├── server.js         ← Express server + Socket.io + routes
│   │   ├── signalEngine.js   ← EMA9 NH/NL/BC logic (exact Pine Script port)
│   │   └── fyers.js          ← Fyers API v3 integration
│   ├── .env                  ← keys 
│   └── package.json
│
└── frontend/         ← React 18 dashboard
    ├── src/
    │   ├── App.js
    │   ├── components/
    │   │   ├── CandleChart.js   ← lightweight-charts with EMA + markers
    │   │   ├── SignalTable.js   ← NH/NL/BC signal list
    │   │   ├── StatsPanel.js    ← counts + state + legend
    │   │   ├── StatusBar.js     ← top header
    │   │   └── AuthPanel.js     ← Fyers auth flow
    │   └── hooks/
    │       └── useSocket.js     ← WebSocket + API data hook
    ├── .env                     ← keys 
    └── package.json
```

---

## Step-by-Step: How to Run

### Step 1 — Install backend dependencies

```bash
cd backend
npm install
```

### Step 2 — Configure backend .env

Edit `backend/.env` and set your Fyers credentials:

```
APP_ID=YOUR_APP_ID-100
ST_KEY=YOUR_SECRET_KEY
PIN=YOUR_PIN
HASH_ID=YOUR_HASH_ID
```

### Step 3 — Authenticate with Fyers (first time only)

```bash
cd backend
npm start
```

Open your browser and visit:
```
http://localhost:3299/api/auth/url
```

This gives you the Fyers login URL. Open it, log in, and copy the `auth_code` from the redirect URL.

Then POST the code (use curl or the React UI's auth panel):

```bash
curl -X POST http://localhost:3299/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"code": "YOUR_AUTH_CODE_HERE"}'
```

### Step 4 — Start backend (if not running)

```bash
cd backend
npm start
```

For development with auto-reload:
```bash
npm run dev
```

Backend runs on: **http://localhost:3299**

### Step 5 — Install frontend dependencies

Open a NEW terminal:

```bash
cd frontend
npm install
```

### Step 6 — Start frontend

```bash
npm start
```

Frontend runs on: **http://localhost:3000**

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api/auth/status` | Check if authenticated |
| GET | `/api/auth/url` | Get Fyers auth URL |
| POST | `/api/auth/token` | Exchange auth code → token |
| GET | `/api/chart` | Get chart + signals (cached) |
| POST | `/api/chart/refresh` | Force fresh fetch |
| GET | `/api/signals` | Get signals only |

## WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `chart_update` | server → client | New chart data |
| `request_refresh` | client → server | Trigger fresh fetch |
| `error` | server → client | Error message |

---

## Pine Script State Machine (ported exactly)

| State | Meaning |
|-------|---------|
| `0` | Waiting |
| `1` | Tracking High (touchHigh seen) |
| `-1` | Tracking Low (touchLow seen) |
| `2` | Trailing Low after NH confirmed |
| `-2` | Trailing High after NL confirmed |

Signal rules:
- **NH** → marked with green ▼ arrow above bar
- **NL** → marked with red ▲ arrow below bar  
- **BC** → both EMA bands touched same candle → yellow ⚡ above AND below
