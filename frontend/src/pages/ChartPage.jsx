// // ChartPage.jsx
// import { useState, useCallback, useEffect } from "react";
// import { useParams, useNavigate, useSearchParams } from "react-router-dom";
// import TradingChart from "../components/TradingChart";
// import SymbolSearch from "../components/SymbolSearch";
// import SignalLegend from "../components/SignalLegend";
// import StatusBar from "../components/StatusBar";
// import TimeframeSelector from "../components/TimeframeSelector";
// import PriceHeader from "../components/PriceHeader";
// import EMAToggles from "../components/EMAToggles";
// import { useChartData } from "../hooks/useChartData";
// import { useWebSocket } from "../hooks/useWebSocket";
// import { fetchSymbols, fetchStatus } from "../utils/api";

// const DEFAULT_SYMBOL = "NSE:TORNTPHARM-EQ";

// function todayIST() {
//   return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
// }

// function subtractDays(dateStr, n) {
//   const d = new Date(dateStr + "T00:00:00Z");
//   d.setUTCDate(d.getUTCDate() - n);
//   return d.toISOString().slice(0, 10);
// }

// export default function ChartPage() {
//   const { symbol: urlSymbol } = useParams();
//   const navigate = useNavigate();
//   const [searchParams, setSearchParams] = useSearchParams();

//   const [symbols, setSymbols] = useState([]);
//   const [status, setStatus] = useState(null);
//   const [lastUpdate, setLastUpdate] = useState(null);
//   const [crosshairData, setCrosshairData] = useState(null);
//   const [resolution, setResolution] = useState("3");
//   const [timeframe, setTimeframe] = useState("1d");
//   const [sidebarOpen, setSidebarOpen] = useState(true);

//   const today = todayIST();

//   // ── Mode: "today" | "custom" ──────────────────────────────────────────────
//   // "today" = single date = today, auto-updates with scans
//   // "custom" = user picked a specific date (past)
//   const [mode, setMode] = useState(() => {
//     // If URL has a custom date param different from today, start in custom
//     const urlDate = searchParams.get("date");
//     if (urlDate && urlDate !== today) return "custom";
//     return "today";
//   });

//   const [customDate, setCustomDate] = useState(() => {
//     return searchParams.get("date") || today;
//   });

//   // Active date used for API: today in "today" mode, customDate in "custom" mode
//   const activeDate = mode === "today" ? today : customDate;

//   const [emaState, setEmaState] = useState({
//     showEMA9High: true, showEMA9Low: true, showEMA9Close: false,
//   });
//   const [shareMsg, setShareMsg] = useState("");

//   const activeSymbol = urlSymbol ? decodeURIComponent(urlSymbol) : DEFAULT_SYMBOL;

//   const { data, loading, error, reload } = useChartData(
//     activeSymbol, resolution, timeframe, activeDate,
//     null, null,
//   );

//   useEffect(() => {
//     fetchSymbols().then(r => setSymbols(r.symbols || [])).catch(() => { });
//     fetchStatus().then(s => {
//       setStatus(s);
//     }).catch(() => { });
//   }, []); // eslint-disable-line

//   useEffect(() => {
//     const id = setInterval(() => fetchStatus().then(setStatus).catch(() => { }), 30000);
//     return () => clearInterval(id);
//   }, []);

//   const handleWsMessage = useCallback((msg) => {
//     if (msg.type === "scan_complete") {
//       setStatus(p => ({ ...p, ...msg.data }));
//       setLastUpdate(new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" }));
//       // Only auto-reload in today mode
//       if (mode === "today") reload();
//     }
//     if (msg.type === "new_signals" && msg.data?.symbol === activeSymbol) {
//       if (mode === "today") reload();
//     }
//   }, [activeSymbol, reload, mode]); // eslint-disable-line

//   const { connected } = useWebSocket(handleWsMessage);

//   function handleSymbolSelect(sym) {
//     const params = mode === "today" ? { date: today } : { date: customDate };
//     navigate(`/chart/${encodeURIComponent(sym)}?${new URLSearchParams(params)}`);
//   }

//   function handleTimeframeChange(res, tf) {
//     setResolution(res);
//     setTimeframe(tf);
//     // Timeframe change always reloads — the activeDate stays the same
//   }

//   // ── TODAY button ─────────────────────────────────────────────────────────
//   function handleTodayClick() {
//     setMode("today");
//     setCustomDate(today);
//     setSearchParams({ date: today });
//     // Reload will happen naturally since activeDate changes to today
//   }

//   // ── Custom date picker ───────────────────────────────────────────────────
//   function handleCustomDateChange(e) {
//     const d = e.target.value;
//     setCustomDate(d);
//     if (d === today) {
//       setMode("today");
//       setSearchParams({ date: today });
//     } else {
//       setMode("custom");
//       setSearchParams({ date: d });
//     }
//   }

//   const cleanSymbol = activeSymbol.replace("NSE:", "").replace("NFO:", "").replace("-EQ", "");
//   const displayDateLabel = activeDate;
//   const isToday = mode === "today";

//   function handleCopyShare() {
//     const url = `${window.location.origin}/chart/${encodeURIComponent(activeSymbol)}?date=${activeDate}`;
//     navigator.clipboard.writeText(url);
//     setShareMsg("Copied!");
//     setTimeout(() => setShareMsg(""), 2000);
//   }

//   return (
//     <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0a0e1a", color: "#e2e8f0", fontFamily: "'Inter', sans-serif" }}>

//       {/* ── Top bar ── */}
//       <div style={{ display: "flex", alignItems: "center", height: 52, padding: "0 12px", background: "#060b14", borderBottom: "1px solid #1e2d4a", flexShrink: 0, gap: 0 }}>

//         {/* Logo */}
//         <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 14, paddingRight: 14, borderRight: "1px solid #1e2d4a", flexShrink: 0 }}>
//           <div style={{ width: 28, height: 28, background: "linear-gradient(135deg, #1e3a8a, #3b82f6)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff", fontFamily: "'JetBrains Mono', monospace" }}>E9</div>
//           <div>
//             <div style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 0.5 }}>EMA9 Signals</div>
//             <div style={{ fontSize: 9, color: "#4b6899", fontFamily: "'JetBrains Mono', monospace" }}>DASHBOARD</div>
//           </div>
//         </div>

//         {/* Symbol search */}
//         <div style={{ flexShrink: 0, marginRight: 10 }}>
//           <SymbolSearch symbols={symbols} activeSymbol={activeSymbol} onSelect={handleSymbolSelect} />
//         </div>

//         {/* Price header */}
//         <div style={{ flexShrink: 0, marginRight: 10 }}>
//           <PriceHeader symbol={activeSymbol} candles={data?.candles} crosshairData={crosshairData} />
//         </div>

//         {/* ── DATE CONTROLS: TODAY button + custom date picker ─────────── */}
//         <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8, flexShrink: 0 }}>

//           {/* TODAY button */}
//           <button
//             onClick={handleTodayClick}
//             style={{
//               padding: "4px 12px", borderRadius: 5, cursor: "pointer",
//               border: "1px solid " + (isToday ? "#22c55e" : "#1e2d4a"),
//               background: isToday ? "#052e1622" : "transparent",
//               color: isToday ? "#22c55e" : "#8899bb",
//               fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
//               fontWeight: isToday ? 700 : 400,
//               transition: "all 0.15s",
//             }}
//           >
//             TODAY
//           </button>

//           <div style={{ width: 1, height: 18, background: "#1e2d4a" }} />

//           {/* Custom date picker */}
//           <span style={{ fontSize: 10, color: "#8899bb", fontFamily: "'JetBrains Mono', monospace" }}>DATE</span>
//           <input
//             type="date"
//             value={customDate}
//             max={today}
//             onChange={handleCustomDateChange}
//             style={{
//               background: "#0d1221",
//               border: "1px solid " + (isToday ? "#22c55e33" : "#f59e0b88"),
//               color: isToday ? "#22c55e" : "#f59e0b",
//               padding: "3px 6px", borderRadius: 5, fontSize: 11,
//               fontFamily: "'JetBrains Mono', monospace",
//               outline: "none", cursor: "pointer", width: 114,
//             }}
//           />
//           {!isToday && (
//             <span style={{ fontSize: 10, color: "#f59e0b", padding: "2px 5px", borderRadius: 4, background: "#1c120066", border: "1px solid #f59e0b33" }}>PAST</span>
//           )}
//         </div>

//         {/* Timeframe selector */}
//         <div style={{ marginLeft: 10, flexShrink: 0 }}>
//           <TimeframeSelector active={resolution} onChange={handleTimeframeChange} />
//         </div>

//         {/* Sidebar toggle */}
//         <button
//           onClick={() => setSidebarOpen(v => !v)}
//           title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
//           style={{ marginLeft: 10, padding: "5px 10px", borderRadius: 5, border: "1px solid #1e2d4a", background: sidebarOpen ? "#1e3a8a33" : "transparent", color: sidebarOpen ? "#60a5fa" : "#8899bb", cursor: "pointer", fontSize: 12, flexShrink: 0 }}
//         >
//           {sidebarOpen ? "▶" : "◀"}
//         </button>
//       </div>

//       {/* Status bar */}
//       <StatusBar status={status} connected={connected} lastUpdate={lastUpdate} onForceRefresh={reload} />

//       {/* ── Main ── */}
//       <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

//         {/* Chart area */}
//         <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
//           {loading && (
//             <div style={{ position: "absolute", inset: 0, background: "#0a0e1acc", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
//               <div style={{ textAlign: "center" }}>
//                 <div style={{ width: 32, height: 32, margin: "0 auto 12px", border: "2px solid #1e2d4a", borderTopColor: "#3b82f6", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
//                 <div style={{ fontSize: 12, color: "#8899bb", fontFamily: "'JetBrains Mono', monospace" }}>
//                   Loading {cleanSymbol} · {displayDateLabel}…
//                 </div>
//               </div>
//             </div>
//           )}
//           {error && !loading && (
//             <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
//               <div style={{ background: "#0d1221", border: "1px solid #ef444466", borderRadius: 8, padding: "20px 32px", textAlign: "center" }}>
//                 <div style={{ fontSize: 28, marginBottom: 8 }}>⚠</div>
//                 <div style={{ fontSize: 12, color: "#ef4444", fontFamily: "'JetBrains Mono', monospace" }}>{error}</div>
//                 <button onClick={reload} style={{ marginTop: 12, padding: "6px 16px", borderRadius: 5, border: "1px solid #ef444466", background: "transparent", color: "#ef4444", cursor: "pointer", fontSize: 11 }}>Retry</button>
//               </div>
//             </div>
//           )}
//           <TradingChart data={data} showEMA9High={emaState.showEMA9High} showEMA9Low={emaState.showEMA9Low} showEMA9Close={emaState.showEMA9Close} onCrosshairMove={setCrosshairData} />
//         </div>

//         {/* ── Sidebar ── */}
//         {sidebarOpen && (
//           <div style={{ width: 240, background: "#060b14", borderLeft: "1px solid #1e2d4a", display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>

//             {/* Sidebar header */}
//             <div style={{ padding: "10px 14px", borderBottom: "1px solid #1e2d4a", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
//               <span style={{ fontSize: 11, color: "#8899bb", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "'JetBrains Mono', monospace" }}>Signals</span>
//               <div style={{ textAlign: "right" }}>
//                 <div style={{ fontSize: 10, color: "#22c55e", fontFamily: "'JetBrains Mono', monospace" }}>
//                   {data?.signals?.filter(s => s.type === "NEW_HIGH" || s.type === "NEW_LOW").length || 0} NH/NL · {data?.signals?.length || 0} total
//                 </div>
//                 <div style={{ fontSize: 9, color: "#4b6899", fontFamily: "'JetBrains Mono', monospace" }}>{displayDateLabel}</div>
//               </div>
//             </div>

//             {/* Signal list */}
//             <div style={{ flex: 1, overflowY: "auto", padding: "4px 6px" }}>
//               <SignalLegend signals={data?.signals} />
//             </div>

//             {/* EMA toggles */}
//             <div style={{ borderTop: "1px solid #1e2d4a", padding: "8px 14px", flexShrink: 0 }}>
//               <EMAToggles state={emaState} onChange={(k, v) => setEmaState(p => ({ ...p, [k]: v }))} />
//             </div>

//             {/* Numbering guide */}
//             <div style={{ borderTop: "1px solid #1e2d4a", padding: "10px 14px", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
//               <div style={{ marginBottom: 7, color: "#8899bb", textTransform: "uppercase", letterSpacing: 1.5, fontSize: 9 }}>Numbering</div>
//               {[
//                 { dot: "●", color: "#f59e0b", abbr: "FH", label: "First Candle High" },
//                 { dot: "●", color: "#f59e0b", abbr: "FL", label: "First Candle Low" },
//                 { dot: "●", color: "#22c55e", abbr: "NH", label: "New High" },
//                 { dot: "●", color: "#ef4444", abbr: "NL", label: "New Low" },
//                 { dot: "●", color: "#f97316", abbr: "LH", label: "Last Candle High" },
//                 { dot: "●", color: "#f97316", abbr: "LL", label: "Last Candle Low" },
//               ].map(({ dot, color, abbr, label }) => (
//                 <div key={abbr} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
//                   <span style={{ color, fontSize: 13, lineHeight: 1 }}>{dot}</span>
//                   <span style={{ color, fontWeight: 700, minWidth: 20, fontSize: 10 }}>{abbr}</span>
//                   <span style={{ color: "#8899bb", fontSize: 9 }}>{abbr}1, {abbr}2… — {label}</span>
//                 </div>
//               ))}
//             </div>

//             {/* Share URL */}
//             <div style={{ borderTop: "1px solid #1e2d4a", padding: "8px 14px", flexShrink: 0 }}>
//               <button
//                 onClick={handleCopyShare}
//                 style={{
//                   width: "100%", padding: "6px 0", borderRadius: 5,
//                   border: "1px solid " + (shareMsg ? "#22c55e55" : "#1e2d4a"),
//                   background: shareMsg ? "#052e1622" : "transparent",
//                   color: shareMsg ? "#22c55e" : "#8899bb",
//                   cursor: "pointer", fontSize: 10,
//                   fontFamily: "'JetBrains Mono', monospace",
//                   transition: "all 0.2s",
//                 }}
//               >
//                 {shareMsg ? "✓ Copied!" : "⎘ COPY SHARE URL"}
//               </button>
//             </div>
//           </div>
//         )}
//       </div>

//       <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
//     </div>
//   );
// }

// ChartPage.jsx
import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import TradingChart from "../components/TradingChart";
import SymbolSearch from "../components/SymbolSearch";
import SignalLegend from "../components/SignalLegend";
import StatusBar from "../components/StatusBar";
import TimeframeSelector from "../components/TimeframeSelector";
import PriceHeader from "../components/PriceHeader";
import { useChartData } from "../hooks/useChartData";
import { useWebSocket } from "../hooks/useWebSocket";
import { fetchSymbols, fetchStatus } from "../utils/api";

const DEFAULT_SYMBOL = "NSE:NIFTY50-INDEX";

function todayIST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function subtractDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function ChartPage() {
  const { symbol: urlSymbol } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [symbols, setSymbols] = useState([]);
  const [status, setStatus] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [crosshairData, setCrosshairData] = useState(null);
  const [resolution, setResolution] = useState("3");
  const [timeframe, setTimeframe] = useState("1d");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const today = todayIST();
  const oneMonthAgo = subtractDays(today, 30);

  // ── TODAY mode toggle ─────────────────────────────────────────────────────
  // todayActive = true  → single day (today only), uses /api/chart
  // todayActive = false → 1 month range, uses /api/chart-range, all bubbles
  const [todayActive, setTodayActive] = useState(true);

  const activeSymbol = urlSymbol ? decodeURIComponent(urlSymbol) : DEFAULT_SYMBOL;

  // chart data: today mode = single date; untoday = 1 month range
  const { data, loading, error, reload } = useChartData(
    activeSymbol, resolution, timeframe,
    todayActive ? today : null,       // date (single mode)
    todayActive ? null : oneMonthAgo, // fromDate (range mode)
    todayActive ? null : today,       // toDate (range mode)
  );

  const [emaState] = useState({ showEMA9High: true, showEMA9Low: true, showEMA9Close: false });
  const [shareMsg, setShareMsg] = useState("");

  useEffect(() => {
    fetchSymbols().then(r => setSymbols(r.symbols || [])).catch(() => { });
    fetchStatus().then(s => setStatus(s)).catch(() => { });
  }, []); // eslint-disable-line

  useEffect(() => {
    const id = setInterval(() => fetchStatus().then(setStatus).catch(() => { }), 30000);
    return () => clearInterval(id);
  }, []);

  const handleWsMessage = useCallback((msg) => {
    if (msg.type === "scan_complete") {
      setStatus(p => ({ ...p, ...msg.data }));
      setLastUpdate(new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" }));
      reload(); // always reload — today or range
    }
    if (msg.type === "new_signals" && msg.data?.symbol === activeSymbol) {
      reload();
    }
  }, [activeSymbol, reload]); // eslint-disable-line

  const { connected } = useWebSocket(handleWsMessage);

  function handleSymbolSelect(sym) {
    navigate(`/chart/${encodeURIComponent(sym)}`);
  }

  function handleTimeframeChange(res, tf) {
    setResolution(res);
    setTimeframe(tf);
  }

  function handleTodayToggle() {
    setTodayActive(v => !v);
  }

  const cleanSymbol = activeSymbol.replace("NSE:", "").replace("NFO:", "").replace("-EQ", "").replace("-INDEX", "");
  const displayDateLabel = todayActive ? today : `${oneMonthAgo} → ${today}`;

  function handleCopyShare() {
    const url = `${window.location.origin}/chart/${encodeURIComponent(activeSymbol)}`;
    navigator.clipboard.writeText(url);
    setShareMsg("Copied!");
    setTimeout(() => setShareMsg(""), 2000);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0a0e1a", color: "#e2e8f0", fontFamily: "'Inter', sans-serif" }}>

      {/* ── Top bar ── */}
      <div style={{ display: "flex", alignItems: "center", height: 52, padding: "0 12px", background: "#060b14", borderBottom: "1px solid #1e2d4a", flexShrink: 0, gap: 0 }}>

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 14, paddingRight: 14, borderRight: "1px solid #1e2d4a", flexShrink: 0 }}>
          <div style={{ width: 28, height: 28, background: "linear-gradient(135deg, #1e3a8a, #3b82f6)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff", fontFamily: "'JetBrains Mono', monospace" }}>E9</div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 0.5 }}>EMA9 Signals</div>
            <div style={{ fontSize: 9, color: "#4b6899", fontFamily: "'JetBrains Mono', monospace" }}>DASHBOARD</div>
          </div>
        </div>

        {/* Symbol search */}
        <div style={{ flexShrink: 0, marginRight: 10 }}>
          <SymbolSearch symbols={symbols} activeSymbol={activeSymbol} onSelect={handleSymbolSelect} />
        </div>

        {/* Price header */}
        <div style={{ flexShrink: 0, marginRight: 16 }}>
          <PriceHeader symbol={activeSymbol} candles={data?.candles} crosshairData={crosshairData} />
        </div>

        {/* ── TODAY toggle button ───────────────────────────────────────── */}
        <button
          onClick={handleTodayToggle}
          style={{
            padding: "5px 16px", borderRadius: 5, cursor: "pointer",
            border: "1px solid " + (todayActive ? "#22c55e" : "#1e2d4a"),
            background: todayActive ? "#052e1622" : "transparent",
            color: todayActive ? "#22c55e" : "#8899bb",
            fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
            fontWeight: todayActive ? 700 : 400,
            letterSpacing: 1,
            transition: "all 0.15s",
            flexShrink: 0,
          }}
        >
          TODAY
        </button>

        {/* Timeframe selector */}
        <div style={{ marginLeft: 12, flexShrink: 0 }}>
          <TimeframeSelector active={resolution} onChange={handleTimeframeChange} />
        </div>

        <div style={{ flex: 1 }} />

        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(v => !v)}
          title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          style={{ padding: "5px 10px", borderRadius: 5, border: "1px solid #1e2d4a", background: sidebarOpen ? "#1e3a8a33" : "transparent", color: sidebarOpen ? "#60a5fa" : "#8899bb", cursor: "pointer", fontSize: 12, flexShrink: 0 }}
        >
          {sidebarOpen ? "▶" : "◀"}
        </button>
      </div>

      {/* Status bar */}
      <StatusBar status={status} connected={connected} lastUpdate={lastUpdate} onForceRefresh={reload} />

      {/* ── Main ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Chart area */}
        <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
          {loading && (
            <div style={{ position: "absolute", inset: 0, background: "#0a0e1acc", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ width: 32, height: 32, margin: "0 auto 12px", border: "2px solid #1e2d4a", borderTopColor: "#3b82f6", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                <div style={{ fontSize: 12, color: "#8899bb", fontFamily: "'JetBrains Mono', monospace" }}>
                  Loading {cleanSymbol} · {displayDateLabel}…
                </div>
              </div>
            </div>
          )}
          {error && !loading && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
              <div style={{ background: "#0d1221", border: "1px solid #ef444466", borderRadius: 8, padding: "20px 32px", textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>⚠</div>
                <div style={{ fontSize: 12, color: "#ef4444", fontFamily: "'JetBrains Mono', monospace" }}>{error}</div>
                <button onClick={reload} style={{ marginTop: 12, padding: "6px 16px", borderRadius: 5, border: "1px solid #ef444466", background: "transparent", color: "#ef4444", cursor: "pointer", fontSize: 11 }}>Retry</button>
              </div>
            </div>
          )}
          <TradingChart
            data={data}
            showEMA9High={emaState.showEMA9High}
            showEMA9Low={emaState.showEMA9Low}
            showEMA9Close={emaState.showEMA9Close}
            onCrosshairMove={setCrosshairData}
            todayMode={todayActive}
          />
        </div>

        {/* ── Sidebar ── */}
        {sidebarOpen && (
          <div style={{ width: 240, background: "#060b14", borderLeft: "1px solid #1e2d4a", display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>

            {/* Sidebar header */}
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #1e2d4a", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: "#8899bb", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "'JetBrains Mono', monospace" }}>Signals</span>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: "#22c55e", fontFamily: "'JetBrains Mono', monospace" }}>
                  {data?.signals?.filter(s => s.type === "NEW_HIGH" || s.type === "NEW_LOW").length || 0} NH/NL · {data?.signals?.length || 0} total
                </div>
                <div style={{ fontSize: 9, color: "#4b6899", fontFamily: "'JetBrains Mono', monospace" }}>{displayDateLabel}</div>
              </div>
            </div>

            {/* Signal list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "4px 6px" }}>
              <SignalLegend signals={data?.signals} />
            </div>

            {/* EMA line legend only (no toggles) */}
            <div style={{ borderTop: "1px solid #1e2d4a", padding: "10px 14px", flexShrink: 0 }}>
              <div style={{ marginBottom: 7, color: "#8899bb", textTransform: "uppercase", letterSpacing: 1.5, fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>EMA Lines</div>
              {[
                { color: "#3b82f6", label: "EMA9H", dash: false, desc: "EMA 9 of Highs" },
                { color: "#f97316", label: "EMA9L", dash: false, desc: "EMA 9 of Lows" },
                { color: "#a855f7", label: "EMA9C", dash: true, desc: "EMA 9 of Close" },
              ].map(({ color, label, dash, desc }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <span style={{
                    width: 18, height: 2, display: "inline-block",
                    background: color, borderRadius: 1,
                    borderTop: dash ? `2px dashed ${color}` : "none",
                    flexShrink: 0,
                  }} />
                  <span style={{ color, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, minWidth: 36 }}>{label}</span>
                  <span style={{ color: "#4b6899", fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>{desc}</span>
                </div>
              ))}
            </div>

            {/* Numbering guide */}
            <div style={{ borderTop: "1px solid #1e2d4a", padding: "10px 14px", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
              <div style={{ marginBottom: 7, color: "#8899bb", textTransform: "uppercase", letterSpacing: 1.5, fontSize: 9 }}>Numbering</div>
              {[
                { dot: "●", color: "#f59e0b", abbr: "FH", label: "First Candle High" },
                { dot: "●", color: "#f59e0b", abbr: "FL", label: "First Candle Low" },
                { dot: "●", color: "#22c55e", abbr: "NH", label: "New High" },
                { dot: "●", color: "#ef4444", abbr: "NL", label: "New Low" },
                { dot: "●", color: "#f97316", abbr: "LH", label: "Last Candle High" },
                { dot: "●", color: "#f97316", abbr: "LL", label: "Last Candle Low" },
              ].map(({ dot, color, abbr, label }) => (
                <div key={abbr} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ color, fontSize: 13, lineHeight: 1 }}>{dot}</span>
                  <span style={{ color, fontWeight: 700, minWidth: 20, fontSize: 10 }}>{abbr}</span>
                  <span style={{ color: "#8899bb", fontSize: 9 }}>{abbr}1, {abbr}2… — {label}</span>
                </div>
              ))}
            </div>

            {/* Share URL */}
            <div style={{ borderTop: "1px solid #1e2d4a", padding: "8px 14px", flexShrink: 0 }}>
              <button
                onClick={handleCopyShare}
                style={{
                  width: "100%", padding: "6px 0", borderRadius: 5,
                  border: "1px solid " + (shareMsg ? "#22c55e55" : "#1e2d4a"),
                  background: shareMsg ? "#052e1622" : "transparent",
                  color: shareMsg ? "#22c55e" : "#8899bb",
                  cursor: "pointer", fontSize: 10,
                  fontFamily: "'JetBrains Mono', monospace",
                  transition: "all 0.2s",
                }}
              >
                {shareMsg ? "✓ Copied!" : "⎘ COPY SHARE URL"}
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}