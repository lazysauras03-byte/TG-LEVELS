// DrawingOverlay.js
// SVG drawing overlay for lightweight-charts.
// Tools: trendline, horizontal, fibRetracement
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
const HANDLE_R = 5;
const HIT_SLOP = 10;
const LS_KEY = "tgg_drawings_v2";

// Fibonacci levels to draw — full extended set matching FibDashboardPage
// p1=drag start (origin), p2=drag end (tip). For a bull drag: p1=low, p2=high
// Level 0 = p1 (origin/start), Level 1 = p2 (tip/end)
// price = p1.price + (p2.price - p1.price) * level
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

// Zone fill bands between consecutive fib levels (colors from Image 1)
const FIB_ZONE_FILLS = [
  { from: -1.618, to: -1.000, color: "#26a69a", opacity: 0.10 }, // teal — ext target zone
  { from: -1.000, to: -0.236, color: "#ef9a9a", opacity: 0.10 }, // red — above 0 (extension)
  { from: -0.236, to: 0.000, color: "#ffcc80", opacity: 0.12 }, // orange — trap top zone
  { from: 0.000, to: 0.236, color: "#fff9c4", opacity: 0.08 }, // yellow — near 0 zone
  { from: 0.236, to: 0.382, color: "#ffab91", opacity: 0.10 }, // orange-red
  { from: 0.382, to: 0.500, color: "#b2dfdb", opacity: 0.10 }, // teal-light
  { from: 0.500, to: 0.618, color: "#c8e6c9", opacity: 0.10 }, // green-light
  { from: 0.618, to: 0.786, color: "#fff9c4", opacity: 0.10 }, // golden zone
  { from: 0.786, to: 1.000, color: "#b2dfdb", opacity: 0.10 }, // caution zone
  { from: 1.000, to: 1.618, color: "#cfd8dc", opacity: 0.08 }, // below 1 (deep retrace)
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
  const dx = x2 - x1,
    dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// ─── UID ──────────────────────────────────────────────────────────────────────
let _uid = Date.now();
function uid() {
  return ++_uid;
}

// ─── Component ────────────────────────────────────────────────────────────────
const DrawingOverlay = forwardRef(function DrawingOverlay(
  { chartRef, candleSeriesRef, selectedTool, setSelectedTool, containerRef, hidden },
  ref
) {
  const svgRef = useRef(null);

  const drawingsRef = useRef(loadDrawings());
  const [drawings, setDrawings] = useState(drawingsRef.current);

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

  // Repaint when chart scrolls/zooms so pixel positions stay accurate
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
      commitDrawings([]);
    },
    getDrawings() {
      return drawingsRef.current;
    },
    // Add a fib retracement drawing programmatically from p1Price → p2Price
    addFibDrawing({ p1Price, p2Price }) {
      if (p1Price == null || p2Price == null) return;
      const newDrawing = {
        id: uid(),
        type: "fibRetracement",
        p1: { price: p1Price, time: null },
        p2: { price: p2Price, time: null },
      };
      const updated = [...drawingsRef.current, newDrawing];
      commitDrawings(updated);
    },
  }));

  // ── Helpers ──────────────────────────────────────────────────────────────
  const DRAWING_TOOLS = ["trendline", "horizontal", "fibRetracement"];

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
          // Hit test: check if mouse Y is near any fib level line
          const priceRange = drawing.p2.price - drawing.p1.price;
          for (const lvl of FIB_LEVELS) {
            const price = drawing.p1.price + priceRange * lvl.ratio;
            const c = dataToCoord(null, price);
            if (c.y != null && Math.abs(py - c.y) < HIT_SLOP) return true;
          }
          return false;
        }
      } catch { }
      return false;
    },
    [dataToCoord]
  );

  // ── Delete ───────────────────────────────────────────────────────────────
  const deleteDrawing = useCallback(
    (id, e) => {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      const next = drawingsRef.current.filter((d) => d.id !== id);
      hoveredIdRef.current = null;
      setHoveredId(null);
      commitDrawings(next);
    },
    [commitDrawings]
  );

  // ── Window mousemove for hover/delete detection in drawing-tool mode ────────
  // Hover (and delete button) only activates when a drawing tool is selected,
  // NOT in cursor mode — in cursor mode drawings are locked and chart pans freely.
  useEffect(() => {
    function onWindowMouseMove(e) {
      if (dragRef.current.active) return;
      if (hidden) return;

      // In cursor mode: clear any hover and do nothing (drawings are locked)
      if (!DRAWING_TOOLS.includes(selectedTool)) {
        if (hoveredIdRef.current !== null) {
          hoveredIdRef.current = null;
          setHoveredId(null);
        }
        return;
      }

      // In drawing-tool mode: track active drag + detect hover for delete
      const svgEl = svgRef.current;
      if (!svgEl) return;
      const r = svgEl.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;

      // Update active drag position (handles mouse outside SVG bounds)
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
      // Capture pointer so drag tracks even when mouse leaves SVG bounds
      try { svgRef.current?.setPointerCapture(e.pointerId); } catch { }
      const { x, y } = relCoord(e);
      const pt = coordToData(x, y);
      dragRef.current = { active: true, tool: selectedTool, start: pt, current: { ...pt } };
    },
    [selectedTool, relCoord, coordToData] // eslint-disable-line
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

      // Hover detection in cursor mode — always run regardless of SVG pointer-events
      if (!DRAWING_TOOLS.includes(selectedTool)) {
        let hitId = null;
        for (const d of drawingsRef.current) {
          if (hitTest(d, x, y)) {
            hitId = d.id;
            break;
          }
        }
        if (hitId !== hoveredIdRef.current) {
          hoveredIdRef.current = hitId;
          setHoveredId(hitId);
        }
      } else {
        // In drawing mode, clear hover
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

      // Stay on selected tool — user must manually press Esc or click Cursor to switch
      dragRef.current = { active: false, tool: null, start: null, current: null };
    },
    [relCoord, coordToData, commitDrawings]
  );

  // ── Render ───────────────────────────────────────────────────────────────
  const drag = dragRef.current;
  const svgW = containerRef.current?.clientWidth ?? 800;
  const svgH = containerRef.current?.clientHeight ?? 500;
  const isDrawing = DRAWING_TOOLS.includes(selectedTool);
  // Cursor mode → pointerEvents:none on SVG → chart pans/scrolls freely, drawings locked
  // Drawing-tool mode → pointerEvents:all → capture clicks for drawing + hover for delete
  const needsPointerEvents = !hidden && isDrawing;

  return (
    <svg
      ref={svgRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 25,
        pointerEvents: needsPointerEvents ? "all" : "none",
        cursor: isDrawing ? (hoveredId ? "pointer" : "crosshair") : "default",
        overflow: "visible",
        visibility: hidden ? "hidden" : "visible",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* In drawing mode, transparent full-overlay rect captures all pointer events */}
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
    return {
      id: uid(),
      type: "fibRetracement",
      p1: { price: start.price, time: start.time },
      p2: { price: current.price, time: current.time },
    };
  }

  return null;
}

// ─── DeleteBtn ────────────────────────────────────────────────────────────────
function DeleteBtn({ cx, cy, color, drawingId, onDelete }) {
  return (
    <g
      style={{ cursor: "pointer", pointerEvents: "all" }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onDelete(drawingId, e);
      }}
    >
      {/* Generous transparent hit area */}
      <circle cx={cx} cy={cy} r={18} fill="transparent" style={{ pointerEvents: "all" }} />
      {/* Visible ✕ circle */}
      <circle cx={cx} cy={cy} r={9} fill="#141722" stroke={color} strokeWidth={1.5} />
      <line
        x1={cx - 4}
        y1={cy - 4}
        x2={cx + 4}
        y2={cy + 4}
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <line
        x1={cx + 4}
        y1={cy - 4}
        x2={cx - 4}
        y2={cy + 4}
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
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
  // In cursor mode (interactive=false) all hit areas are disabled so chart pans freely
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
        {/* Fat invisible hit strip */}
        <line
          x1={c1.x}
          y1={c1.y}
          x2={c2.x}
          y2={c2.y}
          stroke="transparent"
          strokeWidth={18}
          style={{ pointerEvents: pe }}
        />
        {/* Visible line */}
        <line
          x1={c1.x}
          y1={c1.y}
          x2={c2.x}
          y2={c2.y}
          stroke={color}
          strokeWidth={strokeW}
          style={{ pointerEvents: "none" }}
        />
        <circle cx={c1.x} cy={c1.y} r={HANDLE_R} fill={color} opacity={hovered ? 1 : 0.6} style={{ pointerEvents: "none" }} />
        <circle cx={c2.x} cy={c2.y} r={HANDLE_R} fill={color} opacity={hovered ? 1 : 0.6} style={{ pointerEvents: "none" }} />
        {hovered && (
          <DeleteBtn
            cx={mx}
            cy={my - 16}
            color={color}
            drawingId={drawing.id}
            onDelete={onDelete}
          />
        )}
      </g>
    );
  }

  // ── Horizontal Line ─────────────────────────────────────────────────────
  if (drawing.type === "horizontal") {
    const c = dataToCoord(null, drawing.price);
    if (c.y == null) return null;

    const label = numFmt.format(drawing.price);
    const badgeW = 72,
      badgeH = 18;
    const badgeX = svgW - badgeW - 2;

    return (
      <g style={{ pointerEvents: pe }}>
        {/* Fat invisible hit strip */}
        <line
          x1={0}
          y1={c.y}
          x2={svgW}
          y2={c.y}
          stroke="transparent"
          strokeWidth={18}
          style={{ pointerEvents: pe }}
        />
        {/* Visible line */}
        <line
          x1={0}
          y1={c.y}
          x2={svgW}
          y2={c.y}
          stroke={color}
          strokeWidth={strokeW}
          strokeDasharray={hovered ? "0" : "7 4"}
          style={{ pointerEvents: "none" }}
        />
        {/* Price badge */}
        <rect
          x={badgeX}
          y={c.y - badgeH / 2}
          width={badgeW}
          height={badgeH}
          rx={3}
          fill={color}
          opacity={0.9}
          style={{ pointerEvents: "none" }}
        />
        <text
          x={badgeX + badgeW / 2}
          y={c.y + 4}
          textAnchor="middle"
          fill="#fff"
          fontSize={10}
          fontFamily="'JetBrains Mono', monospace"
          fontWeight={700}
          style={{ userSelect: "none", pointerEvents: "none" }}
        >
          {label}
        </text>
        {hovered && (
          <DeleteBtn
            cx={badgeX - 24}
            cy={c.y}
            color={color}
            drawingId={drawing.id}
            onDelete={onDelete}
          />
        )}
      </g>
    );
  }

  // ── Fibonacci Retracement ───────────────────────────────────────────────
  if (drawing.type === "fibRetracement") {
    // p1 = origin (drag start), p2 = tip (drag end)
    // price at ratio = p1.price + (p2.price - p1.price) * ratio
    const priceRange = drawing.p2.price - drawing.p1.price;

    const levelLines = FIB_LEVELS.map((lvl) => {
      const price = drawing.p1.price + priceRange * lvl.ratio;
      const coord = dataToCoord(null, price);
      return { ...lvl, price, y: coord.y };
    }).filter((l) => l.y != null);

    if (levelLines.length < 2) return null;

    const topY = Math.min(...levelLines.map((l) => l.y));
    const botY = Math.max(...levelLines.map((l) => l.y));

    // Build a price→Y lookup for zone fills
    const priceToY = (ratio) => {
      const p = drawing.p1.price + priceRange * ratio;
      const c = dataToCoord(null, p);
      return c.y;
    };

    // Label badge width
    const BADGE_W = 158;
    const BADGE_H = 16;
    const lineX2 = svgW - BADGE_W - 4;
    const badgeX = svgW - BADGE_W - 2;

    return (
      <g style={{ pointerEvents: pe }}>
        {/* Full-width invisible hit area */}
        <rect
          x={0} y={topY - 6}
          width={svgW} height={botY - topY + 12}
          fill="transparent"
          style={{ pointerEvents: pe }}
        />

        {/* Zone fills between consecutive levels */}
        {FIB_ZONE_FILLS.map((zone) => {
          const y1 = priceToY(zone.from);
          const y2 = priceToY(zone.to);
          if (y1 == null || y2 == null) return null;
          const zoneTop = Math.min(y1, y2);
          const zoneBot = Math.max(y1, y2);
          return (
            <rect
              key={`zone-${zone.from}-${zone.to}`}
              x={0} y={zoneTop}
              width={lineX2}
              height={Math.max(zoneBot - zoneTop, 1)}
              fill={zone.color}
              opacity={hovered ? zone.opacity * 1.6 : zone.opacity}
              style={{ pointerEvents: "none" }}
            />
          );
        })}

        {/* Level lines and labels */}
        {levelLines.map(({ ratio, label, color, dash, width, price, y }) => {
          const isEdge = ratio === 0 || ratio === 1;
          const labelText = `${label} (${numFmt.format(price)})`;
          const lineColor = hovered ? HOVER_COLOR : color;
          return (
            <g key={ratio} style={{ pointerEvents: "none" }}>
              <line
                x1={0} y1={y}
                x2={lineX2} y2={y}
                stroke={lineColor}
                strokeWidth={isEdge ? 1.8 : width}
                strokeDasharray={isEdge ? "0" : dash}
                opacity={hovered ? 1 : 0.90}
              />
              {/* Label badge */}
              <rect
                x={badgeX} y={y - BADGE_H / 2}
                width={BADGE_W} height={BADGE_H}
                rx={2}
                fill={lineColor}
                opacity={hovered ? 0.28 : 0.18}
              />
              <text
                x={badgeX + 5} y={y + 4}
                fill={lineColor}
                fontSize={9.5}
                fontFamily="'JetBrains Mono', monospace"
                fontWeight={isEdge ? 700 : 600}
              >
                {labelText}
              </text>
            </g>
          );
        })}

        {hovered && (
          <DeleteBtn
            cx={svgW / 2}
            cy={topY - 16}
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
        <line
          x1={start.x}
          y1={start.y}
          x2={current.x}
          y2={current.y}
          stroke={color}
          strokeWidth={1.8}
        />
        <circle cx={start.x} cy={start.y} r={HANDLE_R} fill={color} />
        <circle cx={current.x} cy={current.y} r={HANDLE_R} fill={color} />
      </g>
    );
  }

  if (tool === "horizontal") {
    return (
      <line
        x1={0}
        y1={start.y}
        x2={svgW}
        y2={start.y}
        stroke={color}
        strokeWidth={1.8}
        strokeDasharray="7 4"
        style={{ pointerEvents: "none" }}
      />
    );
  }

  if (tool === "fibRetracement") {
    if (start.price == null || current.price == null) return null;
    const priceRange = current.price - start.price;
    const BADGE_W = 158;
    const lineX2 = svgW - BADGE_W - 4;

    return (
      <g style={{ pointerEvents: "none" }}>
        {FIB_LEVELS.map((lvl) => {
          const price = start.price + priceRange * lvl.ratio;
          const coord = dataToCoord(null, price);
          if (coord.y == null) return null;
          const isEdge = lvl.ratio === 0 || lvl.ratio === 1;
          return (
            <line
              key={lvl.ratio}
              x1={0}
              y1={coord.y}
              x2={lineX2}
              y2={coord.y}
              stroke={lvl.color}
              strokeWidth={isEdge ? 1.8 : lvl.width}
              strokeDasharray={isEdge ? "0" : lvl.dash}
              opacity={0.75}
            />
          );
        })}
        <circle cx={start.x} cy={start.y} r={HANDLE_R} fill={FIB_COLOR} />
        <circle cx={current.x} cy={current.y} r={HANDLE_R} fill={FIB_COLOR} />
      </g>
    );
  }

  return null;
}