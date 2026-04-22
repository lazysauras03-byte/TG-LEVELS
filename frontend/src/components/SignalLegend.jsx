// components/SignalLegend.jsx
import { useMemo } from "react";

const TYPE_META = {
  FIRST_HIGH: { label: "First Candle High", color: "#f59e0b", bg: "#1c1200", dot: "●" },
  FIRST_LOW:  { label: "First Candle Low",  color: "#f59e0b", bg: "#1c1200", dot: "●" },
  NEW_HIGH:   { label: "New High",          color: "#22c55e", bg: "#052e16", dot: "●" },
  NEW_LOW:    { label: "New Low",           color: "#ef4444", bg: "#2d0808", dot: "●" },
  LAST_HIGH:  { label: "Last Candle High",  color: "#f59e0b", bg: "#1c1200", dot: "○" },
  LAST_LOW:   { label: "Last Candle Low",   color: "#f59e0b", bg: "#1c1200", dot: "○" },
};

function formatTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function SignalLegend({ signals }) {
  const byType = useMemo(() => {
    const map = {};
    for (const sig of (signals || [])) {
      if (!map[sig.type]) map[sig.type] = [];
      map[sig.type].push(sig);
    }
    return map;
  }, [signals]);

  const order = ["FIRST_HIGH", "FIRST_LOW", "NEW_HIGH", "NEW_LOW", "LAST_HIGH", "LAST_LOW"];
  const present = order.filter((t) => byType[t]?.length > 0);

  if (present.length === 0) {
    return (
      <div style={{ padding: "12px 16px", color: "#3b5280", fontSize: 12, textAlign: "center" }}>
        No signals yet today
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "8px 0" }}>
      {present.map((type) => {
        const meta = TYPE_META[type];
        const list = byType[type];
        const latest = list[list.length - 1];
        return (
          <div key={type} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "6px 12px", borderRadius: 6,
            background: meta.bg, border: `1px solid ${meta.color}22`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: meta.color, fontSize: 14, lineHeight: 1 }}>{meta.dot}</span>
              <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "'JetBrains Mono', monospace" }}>
                {meta.label}
              </span>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{
                fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
                color: meta.color, fontWeight: 600,
              }}>
                ₹{latest.price.toFixed(2)}
              </div>
              <div style={{ fontSize: 10, color: "#4b6899", fontFamily: "'JetBrains Mono', monospace" }}>
                {formatTime(latest.ts)}
                {list.length > 1 && <span style={{ color: "#3b5280" }}> ×{list.length}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
