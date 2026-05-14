// DrawingOverlay.js
// SVG drawing overlay for lightweight-charts.
// Tools: trendline, horizontal
// Features: delete on hover-click, localStorage persistence across refreshes

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
const HANDLE_R = 5;
const HIT_SLOP = 10;
const LS_KEY = "tgg_drawings_v1";

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
  const coordToData = useCallback((x, y) => {
    try {
      const time = chartRef.current?.timeScale().coordinateToTime(x) ?? null;
      const price = candleSeriesRef.current?.coordinateToPrice(y) ?? null;
      return { x, y, time, price };
    } catch {
      return { x, y, time: null, price: null };
    }
  }, [chartRef, candleSeriesRef]);

  const dataToCoord = useCallback((time, price) => {
    try {
      const x = time != null ? chartRef.current?.timeScale().timeToCoordinate(time) : null;
      const y = price != null ? candleSeriesRef.current?.priceToCoordinate(price) : null;
      return { x, y };
    } catch {
      return { x: null, y: null };
    }
  }, [chartRef, candleSeriesRef]);

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
    getDrawings() { return drawingsRef.current; },
  }));

  // ── Helpers ──────────────────────────────────────────────────────────────
  const DRAWING_TOOLS = ["trendline", "horizontal"];

  const relCoord = useCallback((e) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  const hitTest = useCallback((drawing, px, py) => {
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
    } catch { }
    return false;
  }, [dataToCoord]);

  // ── Delete ───────────────────────────────────────────────────────────────
  const deleteDrawing = useCallback((id, e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    const next = drawingsRef.current.filter((d) => d.id !== id);
    hoveredIdRef.current = null;
    setHoveredId(null);
    commitDrawings(next);
  }, [commitDrawings]);

  // ── Pointer handlers ─────────────────────────────────────────────────────
  const onPointerDown = useCallback((e) => {
    if (!DRAWING_TOOLS.includes(selectedTool)) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    const { x, y } = relCoord(e);
    const pt = coordToData(x, y);
    dragRef.current = { active: true, tool: selectedTool, start: pt, current: { ...pt } };
  }, [selectedTool, relCoord, coordToData]); // eslint-disable-line

  const onPointerMove = useCallback((e) => {
    const { x, y } = relCoord(e);
    const drag = dragRef.current;

    if (drag.active) {
      drag.current = coordToData(x, y);
      setDrawings((d) => [...d]);
      return;
    }

    // Hover detection
    let hitId = null;
    for (const d of drawingsRef.current) {
      if (hitTest(d, x, y)) { hitId = d.id; break; }
    }
    if (hitId !== hoveredIdRef.current) {
      hoveredIdRef.current = hitId;
      setHoveredId(hitId);
    }
  }, [relCoord, coordToData, hitTest]);

  const onPointerUp = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const { x, y } = relCoord(e);
    drag.current = coordToData(x, y);

    const d = buildDrawing(drag);
    if (d) commitDrawings([...drawingsRef.current, d]);

    dragRef.current = { active: false, tool: null, start: null, current: null };
    setSelectedTool("cursor");
  }, [relCoord, coordToData, commitDrawings, setSelectedTool]);

  // ── Render ───────────────────────────────────────────────────────────────
  const drag = dragRef.current;
  const svgW = containerRef.current?.clientWidth ?? 800;
  const svgH = containerRef.current?.clientHeight ?? 500;
  const isDrawing = DRAWING_TOOLS.includes(selectedTool);
  const needsPointerEvents = isDrawing || hoveredId != null;

  return (
    <svg
      ref={svgRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 25,
        pointerEvents: (!hidden && needsPointerEvents) ? "all" : "none",
        cursor: isDrawing ? "crosshair" : hoveredId ? "pointer" : "default",
        overflow: "visible",
        visibility: hidden ? "hidden" : "visible",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {drawings.map((d) => (
        <DrawingShape
          key={d.id}
          drawing={d}
          dataToCoord={dataToCoord}
          svgW={svgW}
          svgH={svgH}
          hovered={hoveredId === d.id}
          onDelete={deleteDrawing}
        />
      ))}

      {drag.active && drag.start && drag.current && (
        <LivePreview drag={drag} svgW={svgW} />
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

  return null;
}

// ─── DeleteBtn — inline so it closes over drawing id + onDelete ───────────────
function DeleteBtn({ cx, cy, color, drawingId, onDelete }) {
  return (
    <g
      style={{ cursor: "pointer" }}
      onClick={(e) => onDelete(drawingId, e)}
    >
      {/* Generous transparent hit area */}
      <circle cx={cx} cy={cy} r={16} fill="transparent" />
      {/* Visible ✕ circle */}
      <circle cx={cx} cy={cy} r={8} fill="#141722" stroke={color} strokeWidth={1.5} />
      <line x1={cx - 3.5} y1={cy - 3.5} x2={cx + 3.5} y2={cy + 3.5} stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      <line x1={cx + 3.5} y1={cy - 3.5} x2={cx - 3.5} y2={cy + 3.5} stroke={color} strokeWidth={1.7} strokeLinecap="round" />
    </g>
  );
}

// ─── Completed drawing shapes ─────────────────────────────────────────────────
function DrawingShape({ drawing, dataToCoord, svgW, svgH, hovered, onDelete }) {
  const color = hovered ? HOVER_COLOR : DRAW_COLOR;
  const strokeW = hovered ? 2.5 : 1.8;

  if (drawing.type === "trendline") {
    const c1 = dataToCoord(drawing.p1.time, drawing.p1.price);
    const c2 = dataToCoord(drawing.p2.time, drawing.p2.price);
    if (c1.x == null || c2.x == null) return null;
    const mx = (c1.x + c2.x) / 2;
    const my = (c1.y + c2.y) / 2;
    return (
      <g>
        {/* Fat invisible hit strip */}
        <line x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y} stroke="transparent" strokeWidth={18} />
        {/* Visible line */}
        <line x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y} stroke={color} strokeWidth={strokeW} />
        <circle cx={c1.x} cy={c1.y} r={HANDLE_R} fill={color} opacity={hovered ? 1 : 0.6} />
        <circle cx={c2.x} cy={c2.y} r={HANDLE_R} fill={color} opacity={hovered ? 1 : 0.6} />
        {hovered && (
          <DeleteBtn cx={mx} cy={my} color={color} drawingId={drawing.id} onDelete={onDelete} />
        )}
      </g>
    );
  }

  if (drawing.type === "horizontal") {
    const c = dataToCoord(null, drawing.price);
    if (c.y == null) return null;

    const numFmt = new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const label = numFmt.format(drawing.price);
    const badgeW = 72, badgeH = 18;
    const badgeX = svgW - badgeW - 2;

    return (
      <g>
        {/* Fat invisible hit strip */}
        <line x1={0} y1={c.y} x2={svgW} y2={c.y} stroke="transparent" strokeWidth={18} />
        {/* Visible line */}
        <line
          x1={0} y1={c.y} x2={svgW} y2={c.y}
          stroke={color}
          strokeWidth={strokeW}
          strokeDasharray={hovered ? "0" : "7 4"}
        />
        {/* Price badge */}
        <rect x={badgeX} y={c.y - badgeH / 2} width={badgeW} height={badgeH} rx={3} fill={color} opacity={0.9} />
        <text
          x={badgeX + badgeW / 2} y={c.y + 4}
          textAnchor="middle" fill="#fff"
          fontSize={10} fontFamily="'JetBrains Mono', monospace" fontWeight={700}
          style={{ userSelect: "none", pointerEvents: "none" }}
        >
          {label}
        </text>
        {hovered && (
          <DeleteBtn cx={badgeX - 20} cy={c.y} color={color} drawingId={drawing.id} onDelete={onDelete} />
        )}
      </g>
    );
  }

  return null;
}

// ─── Live preview while dragging ──────────────────────────────────────────────
function LivePreview({ drag, svgW }) {
  const { tool, start, current } = drag;
  const color = DRAW_COLOR;

  if (tool === "trendline") {
    return (
      <g>
        <line x1={start.x} y1={start.y} x2={current.x} y2={current.y} stroke={color} strokeWidth={1.8} />
        <circle cx={start.x} cy={start.y} r={HANDLE_R} fill={color} />
        <circle cx={current.x} cy={current.y} r={HANDLE_R} fill={color} />
      </g>
    );
  }

  if (tool === "horizontal") {
    return (
      <line x1={0} y1={start.y} x2={svgW} y2={start.y} stroke={color} strokeWidth={1.8} strokeDasharray="7 4" />
    );
  }

  return null;
}