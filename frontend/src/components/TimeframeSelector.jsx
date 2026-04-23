// components/TimeframeSelector.jsx
// timeframe param tells the server how many days to fetch:
//   "1d"  = 1 trading day  (for 1m and 3m intraday views)
//   "5d"  = 5 trading days (for 5m and 15m short-term views)
//   "1m"  = ~35 days       (for 1h view — need ~1 month of hourly bars)
//   "3m"  = ~95 days       (for 1D view — need ~3 months of daily bars)
const RESOLUTIONS = [
  { label: "1m", resolution: "1", timeframe: "1d" },
  { label: "3m", resolution: "3", timeframe: "1d" },
  { label: "5m", resolution: "5", timeframe: "5d" },
  { label: "15m", resolution: "15", timeframe: "5d" },
  { label: "1h", resolution: "60", timeframe: "1m" },
  { label: "1D", resolution: "D", timeframe: "3m" },
];

export default function TimeframeSelector({ active, onChange }) {
  return (
    <div style={{
      display: "flex", gap: 2, background: "#060b14",
      border: "1px solid #1e2d4a", borderRadius: 6, padding: 2,
    }}>
      {RESOLUTIONS.map((r) => {
        const isActive = active === r.resolution;
        return (
          <button
            key={r.resolution}
            onClick={() => onChange(r.resolution, r.timeframe)}
            style={{
              padding: "4px 10px", borderRadius: 4, border: "none", cursor: "pointer",
              fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
              background: isActive ? "#1e3a8a" : "transparent",
              color: isActive ? "#93c5fd" : "#8899bb",
              fontWeight: isActive ? 700 : 400,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { if (!isActive) e.target.style.color = "#c8d8f0"; }}
            onMouseLeave={(e) => { if (!isActive) e.target.style.color = "#8899bb"; }}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}