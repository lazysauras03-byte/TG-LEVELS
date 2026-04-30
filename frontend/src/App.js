import React, { useState } from "react";
import StatusBar from "./components/StatusBar";
import CandleChart from "./components/CandleChart";
import SignalTable from "./components/SignalTable";
import StatsPanel from "./components/StatsPanel";
import { useSocket } from "./hooks/useSocket";
import "./App.css";

export default function App() {
  const { chartData, connected, loading, error, refresh } = useSocket();

  const [symbol, setSymbol] = useState(
    process.env.REACT_APP_SYMBOL || "NSE:NIFTY50-INDEX"
  );
  const [resolution, setResolution] = useState(
    parseInt(process.env.REACT_APP_RESOLUTION || "3")
  );
  const [activeTab, setActiveTab] = useState("signals");

  const candles = chartData?.candles || [];
  const emaHighs = chartData?.emaHighs || [];
  const emaLows = chartData?.emaLows || [];
  const signals = chartData?.signals || [];
  const currentState = chartData?.currentState ?? 0;
  const bestPrice = chartData?.bestPrice;

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
      />

      <div className="main-content">

        {/* ── Chart ── */}
        <div className="chart-area">
          {error && <div className="error-bar">⚠ {error}</div>}

          {loading && candles.length === 0 ? (
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
            />
          )}
        </div>

        {/* ── Sidebar ── */}
        <div className="sidebar">
          <div className="tabs">
            <button
              className={`tab-btn ${activeTab === "signals" ? "active" : ""}`}
              onClick={() => setActiveTab("signals")}
            >
              Signals ({signals.length})
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
              <SignalTable signals={signals} candles={candles} />
            ) : (
              <StatsPanel
                signals={signals}
                candles={candles}
                currentState={currentState}
                bestPrice={bestPrice}
              />
            )}
          </div>
        </div>

      </div>
    </div>
  );
}