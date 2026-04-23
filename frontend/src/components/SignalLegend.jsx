// components/SignalLegend.jsx
// Shows one row per signal type with ONLY the latest occurrence (abbr+number · time) + price.
// Does NOT list every NH1, NH2, NH3... — just the current state (e.g. NH10 · 15:21).
import { useMemo } from "react";

const TYPE_META = {
  FIRST_HIGH: { label: "First Candle High", color: "#f59e0b", bg: "#1c120033", dot: "●", abbr: "FH" },
  FIRST_LOW: { label: "First Candle Low", color: "#f59e0b", bg: "#1c120033", dot: "●", abbr: "FL" },
  NEW_HIGH: { label: "New High", color: "#22c55e", bg: "#052e1633", dot: "●", abbr: "NH" },
  NEW_LOW: { label: "New Low", color: "#ef4444", bg: "#2d080833", dot: "●", abbr: "NL" },
  LAST_HIGH: { label: "Last Candle High", color: "#f59e0b", bg: "#1c120033", dot: "○", abbr: "LH" },
  LAST_LOW: { label: "Last Candle Low", color: "#f59e0b", bg: "#1c120033", dot: "○", abbr: "LL" },
};

const IST_OFFSET = 19800;

function formatTime(ts) {
  const d = new Date((ts + IST_OFFSET) * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
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

  const ORDER = ["FIRST_HIGH", "FIRST_LOW", "NEW_HIGH", "NEW_LOW", "LAST_HIGH", "LAST_LOW"];
  const present = ORDER.filter(t => byType[t]?.length > 0);

  if (present.length === 0) {
    return (
      <div style={{ padding: "16px", color: "#3b5280", fontSize: 11, textAlign: "center", fontFamily: "'JetBrains Mono', monospace" }}>
        No signals
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "6px 0" }}>
      {present.map(type => {
        const meta = TYPE_META[type];
        const list = byType[type];
        const count = list.length;
        // Latest signal in the list (last chronologically)
        const latest = list[list.length - 1];

        return (
          <div key={type} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "7px 10px", borderRadius: 6,
            background: meta.bg, border: `1px solid ${meta.color}22`,
          }}>
            {/* Left: dot + type label + latest tag */}
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ color: meta.color, fontSize: 14, lineHeight: 1, flexShrink: 0 }}>{meta.dot}</span>
              <div>
                <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "'JetBrains Mono', monospace", marginBottom: 2 }}>
                  {meta.label}
                </div>
                {/* Single badge: latest entry number + time */}
                <span style={{
                  fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                  color: meta.color,
                  background: meta.color + "18",
                  border: `1px solid ${meta.color}33`,
                  borderRadius: 3, padding: "1px 5px",
                }}>
                  {meta.abbr}{count} · {formatTime(latest.ts)}
                </span>
              </div>
            </div>

            {/* Right: latest price */}
            <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 8 }}>
              <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: meta.color, fontWeight: 700 }}>
                ₹{latest.price.toFixed(2)}
              </div>
              {count > 1 && (
                <div style={{ fontSize: 9, color: "#4b6899", fontFamily: "'JetBrains Mono', monospace" }}>
                  ×{count}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}