// components/TimeframeSelector.jsx

const RESOLUTIONS = [
  { label: "1m",  resolution: "1",  timeframe: "1d" },
  { label: "3m",  resolution: "3",  timeframe: "1d" },
  { label: "5m",  resolution: "5",  timeframe: "5d" },
  { label: "15m", resolution: "15", timeframe: "5d" },
  { label: "1h",  resolution: "60", timeframe: "1m" },
  { label: "1D",  resolution: "D",  timeframe: "1m" },
];

export default function TimeframeSelector({ active, onChange }) {
  return (
    <div style={{
      display: "flex", gap: 2, background: "#060b14",
      border: "1px solid #0f1929", borderRadius: 6, padding: 2,
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
              color: isActive ? "#93c5fd" : "#4b6899",
              fontWeight: isActive ? 600 : 400,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { if (!isActive) e.target.style.color = "#93c5fd"; }}
            onMouseLeave={(e) => { if (!isActive) e.target.style.color = "#4b6899"; }}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
