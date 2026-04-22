// components/StatusBar.jsx
export default function StatusBar({ status, connected, lastUpdate, onForceRefresh }) {
  const isMarket = status?.marketOpen;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "0 16px", height: 32,
      background: "#060b14", borderBottom: "1px solid #0f1929",
      fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
    }}>
      {/* WS Status */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: connected ? "#22c55e" : "#ef4444",
          boxShadow: connected ? "0 0 6px #22c55e88" : "0 0 6px #ef444488",
          display: "inline-block",
        }} />
        <span style={{ color: connected ? "#22c55e" : "#ef4444" }}>
          {connected ? "LIVE" : "DISCONNECTED"}
        </span>
      </div>

      <span style={{ color: "#1e2d4a" }}>│</span>

      {/* Market status */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: isMarket ? "#22c55e" : "#64748b",
          display: "inline-block",
          animation: isMarket ? "pulse 2s infinite" : "none",
        }} />
        <span style={{ color: isMarket ? "#94a3b8" : "#4b6899" }}>
          {isMarket ? "MARKET OPEN" : "MARKET CLOSED"}
        </span>
      </div>

      <span style={{ color: "#1e2d4a" }}>│</span>

      {status?.lastScan && (
        <span style={{ color: "#3b5280" }}>
          Last: <span style={{ color: "#64748b" }}>{status.lastScan}</span>
        </span>
      )}

      {status?.nextScan && (
        <>
          <span style={{ color: "#1e2d4a" }}>│</span>
          <span style={{ color: "#3b5280" }}>
            Next: <span style={{ color: "#64748b" }}>{status.nextScan}</span>
          </span>
        </>
      )}

      {status?.cycle > 0 && (
        <>
          <span style={{ color: "#1e2d4a" }}>│</span>
          <span style={{ color: "#3b5280" }}>
            Cycle: <span style={{ color: "#64748b" }}>#{status.cycle}</span>
          </span>
        </>
      )}

      <div style={{ flex: 1 }} />

      {lastUpdate && (
        <span style={{ color: "#3b5280" }}>
          Updated: <span style={{ color: "#64748b" }}>{lastUpdate}</span>
        </span>
      )}

      <button
        onClick={onForceRefresh}
        style={{
          background: "transparent", border: "1px solid #1e2d4a",
          color: "#4b6899", padding: "2px 8px", borderRadius: 4, cursor: "pointer",
          fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => { e.target.style.borderColor = "#3b82f6"; e.target.style.color = "#3b82f6"; }}
        onMouseLeave={(e) => { e.target.style.borderColor = "#1e2d4a"; e.target.style.color = "#4b6899"; }}
      >
        ↻ REFRESH
      </button>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
