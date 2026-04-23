// components/EMAToggles.jsx

const TOGGLES = [
  { key: "showEMA9High", label: "EMA9H", color: "#3b82f6" },
  { key: "showEMA9Low", label: "EMA9L", color: "#f97316" },
  { key: "showEMA9Close", label: "EMA9C", color: "#a855f7" },
];

export default function EMAToggles({ state, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {TOGGLES.map(({ key, label, color }) => {
        const active = state[key];
        return (
          <button
            key={key}
            onClick={() => onChange(key, !active)}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "4px 10px", borderRadius: 4, cursor: "pointer",
              border: `1px solid ${active ? color + "66" : "#1e2d4a"}`,
              background: active ? color + "15" : "transparent",
              color: active ? color : "#8899bb",
              fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
              transition: "all 0.15s",
            }}
          >
            <span style={{
              width: 12, height: 2, display: "inline-block",
              background: active ? color : "#2a3555", borderRadius: 1,
            }} />
            {label}
          </button>
        );
      })}
    </div>
  );
}