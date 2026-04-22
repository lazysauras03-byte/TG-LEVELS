// components/PriceHeader.jsx
import { useState, useEffect } from "react";

function fmt(v) {
  if (v == null) return "—";
  return Number(v).toFixed(2);
}

export default function PriceHeader({ symbol, data, crosshairData }) {
  const [displayData, setDisplayData] = useState(null);

  useEffect(() => {
    if (crosshairData?.seriesData?.size > 0) {
      const entries = Array.from(crosshairData.seriesData.values());
      if (entries[0]?.open != null) {
        setDisplayData(entries[0]);
        return;
      }
    }
    // Show last candle
    if (data?.candles?.length > 0) {
      const last = data.candles[data.candles.length - 1];
      setDisplayData(last);
    }
  }, [crosshairData, data]);

  const candle = displayData;
  const change = candle ? (candle.close - candle.open) : null;
  const changePct = candle && candle.open ? ((change / candle.open) * 100) : null;
  const isUp = change >= 0;

  // Strip NSE: and -EQ for clean display
  const cleanSymbol = symbol
    ? symbol.replace("NSE:", "").replace("NFO:", "").replace("-EQ", "")
    : "";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 20, padding: "0 4px",
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      {/* Symbol name */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", letterSpacing: 0.5 }}>
          {cleanSymbol || "—"}
        </span>
        <span style={{ fontSize: 9, color: "#3b5280", letterSpacing: 1 }}>NSE · EQ</span>
      </div>

      {candle && (
        <>
          {/* Current price */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{
              fontSize: 18, fontWeight: 700,
              color: isUp ? "#22c55e" : "#ef4444",
              letterSpacing: 0.3,
            }}>
              ₹{fmt(candle.close)}
            </span>
            {changePct != null && (
              <span style={{
                fontSize: 10, color: isUp ? "#16a34a" : "#dc2626",
              }}>
                {isUp ? "+" : ""}{fmt(change)} ({isUp ? "+" : ""}{changePct.toFixed(2)}%)
              </span>
            )}
          </div>

          {/* OHLC */}
          <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#4b6899" }}>
            {[["O", candle.open], ["H", candle.high], ["L", candle.low], ["C", candle.close]].map(([lbl, val]) => (
              <span key={lbl}>
                <span style={{ color: "#2a3e5e", marginRight: 2 }}>{lbl}</span>
                <span style={{ color: "#8899bb" }}>{fmt(val)}</span>
              </span>
            ))}
          </div>

          {/* EMA values */}
          {(candle.ema9High || candle.ema9Low) && (
            <div style={{ display: "flex", gap: 12, fontSize: 10, color: "#4b6899" }}>
              {candle.ema9High && (
                <span>
                  <span style={{ color: "#1d4ed8", marginRight: 2 }}>EMA9H</span>
                  <span style={{ color: "#3b82f6" }}>{fmt(candle.ema9High)}</span>
                </span>
              )}
              {candle.ema9Low && (
                <span>
                  <span style={{ color: "#c2410c", marginRight: 2 }}>EMA9L</span>
                  <span style={{ color: "#f97316" }}>{fmt(candle.ema9Low)}</span>
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
