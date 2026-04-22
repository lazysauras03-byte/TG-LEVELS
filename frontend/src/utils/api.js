// utils/api.js
const BASE = process.env.REACT_APP_API_URL || "http://localhost:3200";

export async function fetchChartData(symbol, resolution = "3", timeframe = "1d") {
  const url = `${BASE}/api/chart?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&timeframe=${timeframe}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchSymbols() {
  const res = await fetch(`${BASE}/api/symbols`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchStatus() {
  const res = await fetch(`${BASE}/api/status`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function createWebSocket() {
  const wsUrl = (process.env.REACT_APP_API_URL || window.location.origin)
    .replace(/^http/, "ws");
  return new WebSocket(wsUrl);
}
