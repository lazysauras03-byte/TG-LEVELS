// DrawingOverlay.js
// SVG drawing overlay for lightweight-charts.
// Tools: trendline, horizontal, fibRetracement, text
// Features: delete on hover-click, localStorage persistence, hide/show all

import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useState,
  useCallback,
} from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const DRAW_COLOR = "#2962ff";
const HOVER_COLOR = "#5b8fff";
const FIB_COLOR = "#f0c040";
const TEXT_COLOR = "#e0e3eb";
const HANDLE_R = 5;
const HIT_SLOP = 10;
const LS_KEY = "tgg_drawings_v2";

// Fibonacci levels
const FIB_LEVELS = [
  { ratio: -1.618, label: "-1.618", color: "#26a69a", zoneColor: null, dash: "6 3", width: 1.2 },
  { ratio: -1.000, label: "-1", color: "#ef5350", zoneColor: null, dash: "4 3", width: 1.4 },
  { ratio: -0.236, label: "-0.236", color: "#fb8c00", zoneColor: "#fb8c00", dash: "4 2", width: 1.0 },
  { ratio: 0.000, label: "0", color: "#b2b5be", zoneColor: null, dash: "0", width: 1.6 },
  { ratio: 0.236, label: "0.236", color: "#fb8c00", zoneColor: null, dash: "4 2", width: 1.0 },
  { ratio: 0.382, label: "0.382", color: "#26c6da", zoneColor: "#26c6da", dash: "5 3", width: 1.0 },
  { ratio: 0.500, label: "0.500", color: "#66bb6a", zoneColor: "#66bb6a", dash: "5 3", width: 1.2 },
  { ratio: 0.618, label: "0.618", color: "#ffca28", zoneColor: "#ffca28", dash: "5 3", width: 1.4 },
  { ratio: 0.786, label: "0.786", color: "#26c6da", zoneColor: "#26c6da", dash: "5 3", width: 1.0 },
  { ratio: 1.000, label: "1", color: "#b2b5be", zoneColor: null, dash: "0", width: 1.6 },
  { ratio: 1.618, label: "1.618", color: "#26a69a", zoneColor: null, dash: "6 3", width: 1.2 },
];

const FIB_ZONE_FILLS = [
  { from: -1.618, to: -1.000, color: "#26a69a", opacity: 0.10 },
  { from: -1.000, to: -0.236, color: "#ef9a9a", opacity: 0.10 },
  { from: -0.236, to: 0.000, color: "#ff9800", opacity: 0.28 }, // Trap zone upper — vivid orange
  { from: 0.000, to: 0.236, color: "#ff9800", opacity: 0.28 }, // Trap zone lower — vivid orange
  { from: 0.236, to: 0.382, color: "#ffab91", opacity: 0.10 },
  { from: 0.382, to: 0.500, color: "#b2dfdb", opacity: 0.10 },
  { from: 0.500, to: 0.618, color: "#c8e6c9", opacity: 0.10 },
  { from: 0.618, to: 0.786, color: "#fff9c4", opacity: 0.10 },
  { from: 0.786, to: 1.000, color: "#b2dfdb", opacity: 0.10 },
  { from: 1.000, to: 1.618, color: "#cfd8dc", opacity: 0.08 },
];

// ─── Persistence helpers ──────────────────────────────────────────────────────
function loadDrawings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDrawings(drawings) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(drawings));
  } catch { }
}

// ─── Geometry ─────────────────────────────────────────────────────────────────
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// ─── UID ──────────────────────────────────────────────────────────────────────
let _uid = Date.now();
function uid() { return ++_uid; }

// ─── Component ────────────────────────────────────────────────────────────────
const DrawingOverlay = forwardRef(function DrawingOverlay(
  { chartRef, candleSeriesRef, selectedTool, setSelectedTool, containerRef, hidden },
  ref
) {
  const svgRef = useRef(null);
  const wrapRef = useRef(null); // wrapper div for positioning text inputs

  const drawingsRef = useRef(loadDrawings());
  const [drawings, setDrawings] = useState(drawingsRef.current);

  // Pending text input: { id, x, y } — when user clicks in text mode before typing
  const [pendingText, setPendingText] = useState(null);
  const pendingTextRef = useRef(null);
  const textInputRef = useRef(null);

  const commitDrawings = useCallback((next) => {
    drawingsRef.current = next;
    saveDrawings(next);
    setDrawings([...next]);
  }, []);

  const dragRef = useRef({ active: false, tool: null, start: null, current: null });

  const [hoveredId, setHoveredId] = useState(null);
  const hoveredIdRef = useRef(null);

  // ── Coordinate helpers ───────────────────────────────────────────────────
  const coordToData = useCallback(
    (x, y) => {
      try {
        const time = chartRef.current?.timeScale().coordinateToTime(x) ?? null;
        const price = candleSeriesRef.current?.coordinateToPrice(y) ?? null;
        return { x, y, time, price };
      } catch {
        return { x, y, time: null, price: null };
      }
    },
    [chartRef, candleSeriesRef]
  );

  const dataToCoord = useCallback(
    (time, price) => {
      try {
        const x = time != null ? chartRef.current?.timeScale().timeToCoordinate(time) : null;
        const y = price != null ? candleSeriesRef.current?.priceToCoordinate(price) : null;
        return { x, y };
      } catch {
        return { x: null, y: null };
      }
    },
    [chartRef, candleSeriesRef]
  );

  // Repaint when chart scrolls/zooms
  useEffect(() => {
    if (!chartRef.current) return;
    const repaint = () => setDrawings((d) => [...d]);
    chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(repaint);
    chartRef.current.subscribeCrosshairMove(repaint);
    return () => {
      try {
        chartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(repaint);
        chartRef.current?.unsubscribeCrosshairMove(repaint);
      } catch { }
    };
  }, [chartRef]);

  // ── Imperative API ───────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    clearAll() {
      hoveredIdRef.current = null;
      setHoveredId(null);
      setPendingText(null);
      pendingTextRef.current = null;
      commitDrawings([]);
    },
    getDrawings() {
      return drawingsRef.current;
    },
    addFibDrawing({ p1Price, p2Price, p2Time = null }) {
      if (p1Price == null || p2Price == null) return;
      const newDrawing = {
        id: uid(),
        type: "fibRetracement",
        p1: { price: p1Price, time: null },
        p2: { price: p2Price, time: p2Time }, // wave origin time → left x-anchor
      };
      commitDrawings([...drawingsRef.current, newDrawing]);
    },
  }));

  // ── Helpers ──────────────────────────────────────────────────────────────
  const DRAWING_TOOLS = ["trendline", "horizontal", "fibRetracement", "text"];

  const relCoord = useCallback((e) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  const hitTest = useCallback(
    (drawing, px, py) => {
      try {
        if (drawing.type === "trendline") {
          const c1 = dataToCoord(drawing.p1.time, drawing.p1.price);
          const c2 = dataToCoord(drawing.p2.time, drawing.p2.price);
          if (c1.x == null || c2.x == null) return false;
          return distToSegment(px, py, c1.x, c1.y, c2.x, c2.y) < HIT_SLOP;
        }
        if (drawing.type === "horizontal") {
          const c = dataToCoord(null, drawing.price);
          if (c.y == null) return false;
          return Math.abs(py - c.y) < HIT_SLOP;
        }
        if (drawing.type === "fibRetracement") {
          const priceRange = drawing.p2.price - drawing.p1.price;
          for (const lvl of FIB_LEVELS) {
            const price = drawing.p1.price + priceRange * lvl.ratio;
            const c = dataToCoord(null, price);
            if (c.y != null && Math.abs(py - c.y) < HIT_SLOP) return true;
          }
          return false;
        }
        if (drawing.type === "text") {
          const c = dataToCoord(drawing.time, drawing.price);
          const cx = c.x ?? drawing.x;
          const cy = c.y ?? drawing.y;
          if (cx == null || cy == null) return false;
          // Hit area: bounding box of text label
          const textW = (drawing.content?.length ?? 4) * 8 + 16;
          const textH = 22;
          return px >= cx - 4 && px <= cx + textW && py >= cy - textH && py <= cy + 4;
        }
      } catch { }
      return false;
    },
    [dataToCoord]
  );

  // ── Delete ───────────────────────────────────────────────────────────────
  const deleteDrawing = useCallback(
    (id, e) => {
      if (e) { e.stopPropagation(); e.preventDefault(); }
      const next = drawingsRef.current.filter((d) => d.id !== id);
      hoveredIdRef.current = null;
      setHoveredId(null);
      commitDrawings(next);
    },
    [commitDrawings]
  );

  // ── Text input commit ─────────────────────────────────────────────────────
  const commitTextInput = useCallback(
    (value) => {
      const pt = pendingTextRef.current;
      if (!pt) return;
      setPendingText(null);
      pendingTextRef.current = null;
      if (!value || !value.trim()) return;
      const newDrawing = {
        id: uid(),
        type: "text",
        content: value.trim(),
        price: pt.price,
        time: pt.time,
        x: pt.x,  // fallback pixel coords
        y: pt.y,
        fontSize: 13,
        color: TEXT_COLOR,
      };
      commitDrawings([...drawingsRef.current, newDrawing]);
    },
    [commitDrawings]
  );

  // Focus the input when pendingText appears
  useEffect(() => {
    if (pendingText && textInputRef.current) {
      setTimeout(() => textInputRef.current?.focus(), 30);
    }
  }, [pendingText]);

  // ── Window mousemove for hover/delete ────────────────────────────────────
  useEffect(() => {
    function onWindowMouseMove(e) {
      if (dragRef.current.active) return;
      if (hidden) return;

      if (!DRAWING_TOOLS.includes(selectedTool)) {
        if (hoveredIdRef.current !== null) {
          hoveredIdRef.current = null;
          setHoveredId(null);
        }
        return;
      }

      const svgEl = svgRef.current;
      if (!svgEl) return;
      const r = svgEl.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;

      if (dragRef.current.active) {
        dragRef.current.current = coordToData(x, y);
        setDrawings((d) => [...d]);
        return;
      }

      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
        if (hoveredIdRef.current !== null) {
          hoveredIdRef.current = null;
          setHoveredId(null);
        }
        return;
      }

      let hitId = null;
      for (const d of drawingsRef.current) {
        if (hitTest(d, x, y)) { hitId = d.id; break; }
      }
      if (hitId !== hoveredIdRef.current) {
        hoveredIdRef.current = hitId;
        setHoveredId(hitId);
      }
    }
    window.addEventListener("mousemove", onWindowMouseMove);
    return () => window.removeEventListener("mousemove", onWindowMouseMove);
  }, [selectedTool, hidden, hitTest]); // eslint-disable-line

  // ── Pointer handlers ─────────────────────────────────────────────────────
  const onPointerDown = useCallback(
    (e) => {
      if (!DRAWING_TOOLS.includes(selectedTool)) return;
      if (e.button !== 0) return;
      e.stopPropagation();

      const { x, y } = relCoord(e);
      const pt = coordToData(x, y);

      // Text tool: single-click to place, show inline input
      if (selectedTool === "text") {
        // If there's a pending text being typed, commit it first (empty = discard)
        if (pendingTextRef.current) {
          const val = textInputRef.current?.value ?? "";
          commitTextInput(val);
        }
        const newPt = { x, y, price: pt.price, time: pt.time };
        pendingTextRef.current = newPt;
        setPendingText({ ...newPt });
        return;
      }

      try { svgRef.current?.setPointerCapture(e.pointerId); } catch { }
      dragRef.current = { active: true, tool: selectedTool, start: pt, current: { ...pt } };
    },
    [selectedTool, relCoord, coordToData, commitTextInput] // eslint-disable-line
  );

  const onPointerMove = useCallback(
    (e) => {
      const { x, y } = relCoord(e);
      const drag = dragRef.current;

      if (drag.active) {
        drag.current = coordToData(x, y);
        setDrawings((d) => [...d]);
        return;
      }

      if (!DRAWING_TOOLS.includes(selectedTool)) {
        let hitId = null;
        for (const d of drawingsRef.current) {
          if (hitTest(d, x, y)) { hitId = d.id; break; }
        }
        if (hitId !== hoveredIdRef.current) {
          hoveredIdRef.current = hitId;
          setHoveredId(hitId);
        }
      } else {
        if (hoveredIdRef.current !== null) {
          hoveredIdRef.current = null;
          setHoveredId(null);
        }
      }
    },
    [relCoord, coordToData, hitTest, selectedTool] // eslint-disable-line
  );

  const onPointerUp = useCallback(
    (e) => {
      const drag = dragRef.current;
      if (!drag.active) return;
      const { x, y } = relCoord(e);
      drag.current = coordToData(x, y);

      const d = buildDrawing(drag);
      if (d) commitDrawings([...drawingsRef.current, d]);

      dragRef.current = { active: false, tool: null, start: null, current: null };
    },
    [relCoord, coordToData, commitDrawings]
  );

  // ── Render ───────────────────────────────────────────────────────────────
  const drag = dragRef.current;
  const svgW = containerRef.current?.clientWidth ?? 800;
  const svgH = containerRef.current?.clientHeight ?? 500;
  const isDrawing = DRAWING_TOOLS.includes(selectedTool);
  const needsPointerEvents = !hidden && isDrawing;

  // Compute pixel position for pending text input
  let pendingInputX = 0, pendingInputY = 0;
  if (pendingText) {
    const c = dataToCoord(pendingText.time, pendingText.price);
    pendingInputX = c.x ?? pendingText.x ?? 100;
    pendingInputY = c.y ?? pendingText.y ?? 100;
  }

  return (
    <div
      ref={wrapRef}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 25 }}
    >
      <svg
        ref={svgRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: needsPointerEvents ? "all" : "none",
          cursor: isDrawing
            ? (selectedTool === "text" ? "text" : (hoveredId ? "pointer" : "crosshair"))
            : "default",
          overflow: "visible",
          visibility: hidden ? "hidden" : "visible",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {isDrawing && (
          <rect x={0} y={0} width={svgW} height={svgH} fill="transparent" style={{ pointerEvents: "all" }} />
        )}

        {!hidden &&
          drawings.map((d) => (
            <DrawingShape
              key={d.id}
              drawing={d}
              dataToCoord={dataToCoord}
              svgW={svgW}
              svgH={svgH}
              hovered={hoveredId === d.id}
              onDelete={deleteDrawing}
              interactive={isDrawing}
            />
          ))}

        {drag.active && drag.start && drag.current && (
          <LivePreview drag={drag} svgW={svgW} dataToCoord={dataToCoord} />
        )}
      </svg>

      {/* Inline text input — renders on top of SVG at click position */}
      {pendingText && !hidden && (
        <div
          style={{
            position: "absolute",
            left: pendingInputX,
            top: pendingInputY - 18,
            pointerEvents: "all",
            zIndex: 30,
          }}
        >
          <input
            ref={textInputRef}
            type="text"
            placeholder="Type text…"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTextInput(e.target.value);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                pendingTextRef.current = null;
                setPendingText(null);
              }
              e.stopPropagation(); // prevent toolbar shortcuts while typing
            }}
            onBlur={(e) => {
              // Commit on blur (clicked elsewhere)
              commitTextInput(e.target.value);
            }}
            style={{
              background: "#1e222d",
              border: "1px solid #2962ff",
              borderRadius: 3,
              color: TEXT_COLOR,
              fontSize: 13,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', sans-serif",
              padding: "2px 6px",
              outline: "none",
              minWidth: 120,
              boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            }}
          />
          <div style={{
            fontSize: 10,
            color: "#4a4f60",
            marginTop: 2,
            fontFamily: "sans-serif",
            pointerEvents: "none",
          }}>
            Enter to confirm · Esc to cancel
          </div>
        </div>
      )}
    </div>
  );
});

export default DrawingOverlay;

// ─── Build drawing from drag ──────────────────────────────────────────────────
function buildDrawing({ tool, start, current }) {
  if (!start || !current) return null;

  if (tool === "trendline") {
    if (Math.hypot(current.x - start.x, current.y - start.y) < 4) return null;
    return {
      id: uid(),
      type: "trendline",
      p1: { price: start.price, time: start.time },
      p2: { price: current.price, time: current.time },
    };
  }

  if (tool === "horizontal") {
    if (start.price == null) return null;
    return { id: uid(), type: "horizontal", price: start.price };
  }

  if (tool === "fibRetracement") {
    if (Math.hypot(current.x - start.x, current.y - start.y) < 4) return null;
    if (start.price == null || current.price == null) return null;
    // Convention: ratio 0 = wave TIP (drag end), ratio 1 = wave ORIGIN (drag start)
    // DrawingOverlay renders: price = p1 + (p2 - p1) * ratio → p1=ratio0, p2=ratio1
    // So: p1 = current (where you release = tip = 0), p2 = start (where you clicked = origin = 1)
    return {
      id: uid(),
      type: "fibRetracement",
      p1: { price: current.price, time: current.time }, // tip  → ratio 0
      p2: { price: start.price, time: start.time }, // origin → ratio 1
    };
  }

  return null;
}

// ─── DeleteBtn ────────────────────────────────────────────────────────────────
function DeleteBtn({ cx, cy, color, drawingId, onDelete }) {
  return (
    <g
      style={{ cursor: "pointer", pointerEvents: "all" }}
      onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDelete(drawingId, e); }}
    >
      <circle cx={cx} cy={cy} r={18} fill="transparent" style={{ pointerEvents: "all" }} />
      <circle cx={cx} cy={cy} r={9} fill="#141722" stroke={color} strokeWidth={1.5} />
      <line x1={cx - 4} y1={cy - 4} x2={cx + 4} y2={cy + 4} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <line x1={cx + 4} y1={cy - 4} x2={cx - 4} y2={cy + 4} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </g>
  );
}

// ─── Number formatter ─────────────────────────────────────────────────────────
const numFmt = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Completed drawing shapes ─────────────────────────────────────────────────
function DrawingShape({ drawing, dataToCoord, svgW, svgH, hovered, onDelete, interactive }) {
  const color = hovered ? HOVER_COLOR : DRAW_COLOR;
  const strokeW = hovered ? 2.5 : 1.8;
  const pe = interactive ? "all" : "none";

  // ── Trend Line ──────────────────────────────────────────────────────────
  if (drawing.type === "trendline") {
    const c1 = dataToCoord(drawing.p1.time, drawing.p1.price);
    const c2 = dataToCoord(drawing.p2.time, drawing.p2.price);
    if (c1.x == null || c2.x == null) return null;
    const mx = (c1.x + c2.x) / 2;
    const my = (c1.y + c2.y) / 2;
    return (
      <g style={{ pointerEvents: pe }}>
        <line x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y} stroke="transparent" strokeWidth={18} style={{ pointerEvents: pe }} />
        <line x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y} stroke={color} strokeWidth={strokeW} style={{ pointerEvents: "none" }} />
        <circle cx={c1.x} cy={c1.y} r={HANDLE_R} fill={color} opacity={hovered ? 1 : 0.6} style={{ pointerEvents: "none" }} />
        <circle cx={c2.x} cy={c2.y} r={HANDLE_R} fill={color} opacity={hovered ? 1 : 0.6} style={{ pointerEvents: "none" }} />
        {hovered && <DeleteBtn cx={mx} cy={my - 16} color={color} drawingId={drawing.id} onDelete={onDelete} />}
      </g>
    );
  }

  // ── Horizontal Line ─────────────────────────────────────────────────────
  if (drawing.type === "horizontal") {
    const c = dataToCoord(null, drawing.price);
    if (c.y == null) return null;
    const label = numFmt.format(drawing.price);
    const badgeW = 72, badgeH = 18;
    const badgeX = svgW - badgeW - 2;
    return (
      <g style={{ pointerEvents: pe }}>
        <line x1={0} y1={c.y} x2={svgW} y2={c.y} stroke="transparent" strokeWidth={18} style={{ pointerEvents: pe }} />
        <line x1={0} y1={c.y} x2={svgW} y2={c.y} stroke={color} strokeWidth={strokeW} strokeDasharray={hovered ? "0" : "7 4"} style={{ pointerEvents: "none" }} />
        <rect x={badgeX} y={c.y - badgeH / 2} width={badgeW} height={badgeH} rx={3} fill={color} opacity={0.9} style={{ pointerEvents: "none" }} />
        <text x={badgeX + badgeW / 2} y={c.y + 4} textAnchor="middle" fill="#fff" fontSize={10} fontFamily="'JetBrains Mono', monospace" fontWeight={700} style={{ userSelect: "none", pointerEvents: "none" }}>
          {label}
        </text>
        {hovered && <DeleteBtn cx={badgeX - 24} cy={c.y} color={color} drawingId={drawing.id} onDelete={onDelete} />}
      </g>
    );
  }

  // ── Fibonacci Retracement ───────────────────────────────────────────────
  if (drawing.type === "fibRetracement") {
    const priceRange = drawing.p2.price - drawing.p1.price;

    const levelLines = FIB_LEVELS.map((lvl) => {
      const price = drawing.p1.price + priceRange * lvl.ratio;
      const coord = dataToCoord(null, price);
      return { ...lvl, price, y: coord.y };
    }).filter((l) => l.y != null);

    if (levelLines.length < 2) return null;

    const topY = Math.min(...levelLines.map((l) => l.y));
    const botY = Math.max(...levelLines.map((l) => l.y));

    const priceToY = (ratio) => {
      const p = drawing.p1.price + priceRange * ratio;
      const c = dataToCoord(null, p);
      return c.y;
    };

    // Layout: label on left edge, lines start from wave-origin x and extend right
    const BADGE_W = 158;
    const BADGE_H = 16;
    const LABEL_PAD = 4;
    const badgeX = LABEL_PAD;

    // Wave origin (p2) x-coordinate = where lines begin on the chart
    // Falls back to BADGE_W+8 if time is not available (shouldn't happen)
    const originCoord = dataToCoord(drawing.p2.time, drawing.p2.price);
    const lineX1 = (originCoord.x != null && originCoord.x > BADGE_W + 8)
      ? originCoord.x
      : BADGE_W + 8;

    return (
      <g style={{ pointerEvents: pe }}>
        <rect x={0} y={topY - 6} width={svgW} height={botY - topY + 12} fill="transparent" style={{ pointerEvents: pe }} />

        {FIB_ZONE_FILLS.map((zone) => {
          const y1 = priceToY(zone.from);
          const y2 = priceToY(zone.to);
          if (y1 == null || y2 == null) return null;
          const zoneTop = Math.min(y1, y2);
          const zoneBot = Math.max(y1, y2);
          return (
            <rect key={`zone-${zone.from}-${zone.to}`} x={lineX1} y={zoneTop} width={svgW - lineX1} height={Math.max(zoneBot - zoneTop, 1)} fill={zone.color} opacity={hovered ? zone.opacity * 1.6 : zone.opacity} style={{ pointerEvents: "none" }} />
          );
        })}

        {levelLines.map(({ ratio, label, color, dash, width, price, y }) => {
          const isEdge = ratio === 0 || ratio === 1;
          const labelText = `${label} (${numFmt.format(price)})`;
          const lineColor = hovered ? HOVER_COLOR : color;
          return (
            <g key={ratio} style={{ pointerEvents: "none" }}>
              {/* Label badge pinned to left edge */}
              <rect x={badgeX} y={y - BADGE_H / 2} width={BADGE_W} height={BADGE_H} rx={2} fill={lineColor} opacity={hovered ? 0.28 : 0.18} />
              <text x={badgeX + 5} y={y + 4} fill={lineColor} fontSize={9.5} fontFamily="'JetBrains Mono', monospace" fontWeight={isEdge ? 700 : 600}>
                {labelText}
              </text>
              {/* Line starts at wave-origin x and extends right to infinity */}
              <line x1={lineX1} y1={y} x2={svgW} y2={y} stroke={lineColor} strokeWidth={isEdge ? 1.8 : width} strokeDasharray={isEdge ? "0" : dash} opacity={hovered ? 1 : 0.90} />
            </g>
          );
        })}

        {hovered && <DeleteBtn cx={svgW / 2} cy={topY - 16} color={HOVER_COLOR} drawingId={drawing.id} onDelete={onDelete} />}
      </g>
    );
  }

  // ── Text Label ──────────────────────────────────────────────────────────
  if (drawing.type === "text") {
    const c = dataToCoord(drawing.time, drawing.price);
    // Use price-based Y coordinate; fall back to stored pixel Y
    const cx = c.x ?? drawing.x ?? 100;
    const cy = c.y ?? drawing.y ?? 100;
    if (cx == null || cy == null) return null;

    const textContent = drawing.content || "";
    const fontSize = drawing.fontSize || 13;
    const textCol = hovered ? HOVER_COLOR : (drawing.color || TEXT_COLOR);
    const approxW = textContent.length * (fontSize * 0.62) + 16;
    const approxH = fontSize + 8;

    return (
      <g style={{ pointerEvents: pe }}>
        {/* Invisible hit area */}
        <rect
          x={cx - 4}
          y={cy - approxH}
          width={approxW}
          height={approxH + 4}
          fill="transparent"
          style={{ pointerEvents: pe }}
        />
        {/* Background pill */}
        <rect
          x={cx - 4}
          y={cy - approxH + 2}
          width={approxW}
          height={approxH - 2}
          rx={3}
          fill={hovered ? "rgba(91,143,255,0.15)" : "rgba(30,34,45,0.75)"}
          style={{ pointerEvents: "none" }}
        />
        {/* Text */}
        <text
          x={cx + 4}
          y={cy - 4}
          fill={textCol}
          fontSize={fontSize}
          fontFamily="-apple-system, BlinkMacSystemFont, 'Trebuchet MS', sans-serif"
          fontWeight={500}
          style={{ userSelect: "none", pointerEvents: "none" }}
        >
          {textContent}
        </text>
        {/* Anchor dot */}
        <circle
          cx={cx}
          cy={cy}
          r={3}
          fill={textCol}
          opacity={hovered ? 1 : 0.5}
          style={{ pointerEvents: "none" }}
        />
        {hovered && (
          <DeleteBtn
            cx={cx + approxW / 2}
            cy={cy - approxH - 8}
            color={HOVER_COLOR}
            drawingId={drawing.id}
            onDelete={onDelete}
          />
        )}
      </g>
    );
  }

  return null;
}

// ─── Live preview while dragging ──────────────────────────────────────────────
function LivePreview({ drag, svgW, dataToCoord }) {
  const { tool, start, current } = drag;
  const color = DRAW_COLOR;

  if (tool === "trendline") {
    return (
      <g style={{ pointerEvents: "none" }}>
        <line x1={start.x} y1={start.y} x2={current.x} y2={current.y} stroke={color} strokeWidth={1.8} />
        <circle cx={start.x} cy={start.y} r={HANDLE_R} fill={color} />
        <circle cx={current.x} cy={current.y} r={HANDLE_R} fill={color} />
      </g>
    );
  }

  if (tool === "horizontal") {
    return (
      <line x1={0} y1={start.y} x2={svgW} y2={start.y} stroke={color} strokeWidth={1.8} strokeDasharray="7 4" style={{ pointerEvents: "none" }} />
    );
  }

  if (tool === "fibRetracement") {
    if (start.price == null || current.price == null) return null;
    // Preview: p1=current(tip=0), p2=start(origin=1) — matches buildDrawing convention
    const priceRange = start.price - current.price; // p2 - p1 = start - current
    // Lines start from drag-start x (= wave origin), extend right
    const lineX1 = Math.min(start.x, svgW - 10);

    return (
      <g style={{ pointerEvents: "none" }}>
        {FIB_LEVELS.map((lvl) => {
          const price = current.price + priceRange * lvl.ratio; // p1(tip) + (p2-p1)*ratio
          const coord = dataToCoord(null, price);
          if (coord.y == null) return null;
          const isEdge = lvl.ratio === 0 || lvl.ratio === 1;
          return (
            <line key={lvl.ratio} x1={lineX1} y1={coord.y} x2={svgW} y2={coord.y} stroke={lvl.color} strokeWidth={isEdge ? 1.8 : lvl.width} strokeDasharray={isEdge ? "0" : lvl.dash} opacity={0.75} />
          );
        })}
        <circle cx={start.x} cy={start.y} r={HANDLE_R} fill={FIB_COLOR} />
        <circle cx={current.x} cy={current.y} r={HANDLE_R} fill={FIB_COLOR} />
      </g>
    );
  }

  return null;
}