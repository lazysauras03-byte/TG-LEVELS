// components/SymbolSearch.jsx
import { useState, useRef, useEffect, useMemo } from "react";

export default function SymbolSearch({ symbols, selected, onSelect }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return symbols.slice(0, 50);
    const q = query.toUpperCase();
    return symbols
      .filter((s) => s.includes(q) || s.replace("NSE:", "").replace("-EQ", "").includes(q))
      .slice(0, 50);
  }, [query, symbols]);

  useEffect(() => {
    setHighlighted(0);
  }, [filtered]);

  function handleKey(e) {
    if (!open) { setOpen(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); }
    if (e.key === "Enter" && filtered[highlighted]) {
      pick(filtered[highlighted]);
    }
    if (e.key === "Escape") { setOpen(false); }
  }

  function pick(sym) {
    onSelect(sym);
    setQuery("");
    setOpen(false);
  }

  // Display name: strip NSE: and -EQ
  function display(sym) {
    return sym.replace("NSE:", "").replace("NFO:", "").replace("-EQ", "").replace("FUT", "");
  }

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        background: "#0d1221", border: "1px solid #1e2d4a",
        borderRadius: 8, padding: "0 12px", height: 40,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4b6899" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKey}
          placeholder={selected ? display(selected) : "Search symbol…"}
          style={{
            background: "transparent", border: "none", outline: "none",
            color: "#e2e8f0", fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
            width: "100%", letterSpacing: 0.3,
          }}
        />
        {selected && (
          <span style={{
            fontSize: 10, color: "#22c55e", background: "#052e16",
            padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap",
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {display(selected)}
          </span>
        )}
      </div>

      {open && filtered.length > 0 && (
        <div ref={listRef} style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
          background: "#0d1221", border: "1px solid #1e2d4a", borderRadius: 8,
          maxHeight: 280, overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}>
          {filtered.map((sym, i) => (
            <div
              key={sym}
              onMouseDown={() => pick(sym)}
              style={{
                padding: "8px 12px", cursor: "pointer", display: "flex",
                alignItems: "center", justifyContent: "space-between",
                background: i === highlighted ? "#131d35" : "transparent",
                borderBottom: "1px solid #0f1929",
              }}
            >
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#e2e8f0",
                letterSpacing: 0.3,
              }}>
                {display(sym)}
              </span>
              <span style={{ fontSize: 10, color: "#3b5280" }}>{sym.split(":")[0]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
