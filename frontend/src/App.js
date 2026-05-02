import React, { useState, useCallback, useEffect } from "react";
import StatusBar from "./components/StatusBar";
import CandleChart from "./components/CandleChart";
import SignalTable from "./components/SignalTable";
import StatsPanel from "./components/StatsPanel";
import { useSocket } from "./hooks/useSocket";
import "./App.css";

// ── Persist user preferences across page refreshes ──────────────────────────
function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem("tgg_" + key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem("tgg_" + key, JSON.stringify(value)); } catch { }
}

export default function App() {
  const { chartData, connected, loading, error, refresh } = useSocket();

  // Restore last-used preferences from localStorage
  const [symbol, setSymbol] = useState(() => loadPref("symbol", "NSE:NIFTY50-INDEX"));
  const [resolution, setResolution] = useState(() => loadPref("resolution", 3));
  const [activeTab, setActiveTab] = useState(() => loadPref("activeTab", "signals"));
  const [todayMode, setTodayMode] = useState(() => loadPref("todayMode", true));
  const [sidebarOpen, setSidebarOpen] = useState(() => loadPref("sidebarOpen", true));

  // Persist whenever they change
  useEffect(() => savePref("symbol", symbol), [symbol]);
  useEffect(() => savePref("resolution", resolution), [resolution]);
  useEffect(() => savePref("activeTab", activeTab), [activeTab]);
  useEffect(() => savePref("todayMode", todayMode), [todayMode]);
  useEffect(() => savePref("sidebarOpen", sidebarOpen), [sidebarOpen]);

  // On first mount, auto-fetch with the persisted symbol + resolution
  const [didInitialFetch, setDidInitialFetch] = useState(false);
  useEffect(() => {
    if (!didInitialFetch) {
      setDidInitialFetch(true);
      refresh(symbol, resolution);
    }
  }, []); // eslint-disable-line

  const [crosshairBar, setCrosshairBar] = useState(null);
  const handleCrosshairMove = useCallback((bar) => setCrosshairBar(bar), []);

  const candles = chartData?.candles || [];
  const emaHighs = chartData?.emaHighs || [];
  const emaLows = chartData?.emaLows || [];
  const signals = chartData?.signals || [];
  const currentState = chartData?.currentState ?? 0;
  const bestPrice = chartData?.bestPrice;

  const showLoadingScreen = loading && candles.length === 0;

  const todayIST = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  const displayedSignals = todayMode
    ? signals.filter((s) => new Date(s.time).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) === todayIST)
    : signals;

  return (
    <div className="app-layout">

      <StatusBar
        connected={connected}
        loading={loading}
        chartData={chartData}
        onRefresh={refresh}
        symbol={symbol}
        resolution={resolution}
        onSymbolChange={setSymbol}
        onResolutionChange={setResolution}
        todayMode={todayMode}
        onTodayToggle={() => setTodayMode((p) => !p)}
        crosshairBar={crosshairBar}
        onSidebarToggle={() => setSidebarOpen((p) => !p)}
      />

      <div className="main-content">

        <div className="chart-area">
          {error && <div className="error-bar">⚠ {error}</div>}

          {showLoadingScreen ? (
            <div className="loading-screen">
              <div className="loading-spinner" />
              <div>Loading chart data…</div>
            </div>
          ) : candles.length === 0 ? (
            <div className="loading-screen">
              <div className="no-data-msg">
                <div className="no-data-icon">📊</div>
                <div className="no-data-title">No Data Yet</div>
                <div className="no-data-sub">
                  Run <code>npm run generate</code> in the backend terminal,<br />
                  then click Refresh above.
                </div>
              </div>
            </div>
          ) : (
            <CandleChart
              candles={candles}
              emaHighs={emaHighs}
              emaLows={emaLows}
              signals={signals}
              currentState={currentState}
              todayMode={todayMode}
              onCrosshairMove={handleCrosshairMove}
            />
          )}
        </div>

        <div className={`sidebar ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
          <div className="tabs">
            <button
              className={`tab-btn ${activeTab === "signals" ? "active" : ""}`}
              onClick={() => setActiveTab("signals")}
            >
              Signals ({displayedSignals.length})
            </button>
            <button
              className={`tab-btn ${activeTab === "stats" ? "active" : ""}`}
              onClick={() => setActiveTab("stats")}
            >
              Stats
            </button>
          </div>

          <div className="tab-content">
            {activeTab === "signals" ? (
              <SignalTable signals={signals} candles={candles} todayMode={todayMode} />
            ) : (
              <StatsPanel
                signals={signals}
                candles={candles}
                currentState={currentState}
                bestPrice={bestPrice}
                todayMode={todayMode}
              />
            )}
          </div>
        </div>

      </div>
    </div>
  );
}