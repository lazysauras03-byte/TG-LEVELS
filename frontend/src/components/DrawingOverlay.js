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

// Fibonacci levels to draw
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

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
          for (const level of FIB_LEVELS) {
            const price = drawing.p1.price + priceRange * level;
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
function DrawingShape({ drawing, dataToCoord, svgW, svgH, hovered, onDelete }) {
  const color = hovered ? HOVER_COLOR : DRAW_COLOR;
  const strokeW = hovered ? 2.5 : 1.8;

  // ── Trend Line ──────────────────────────────────────────────────────────
  if (drawing.type === "trendline") {
    const c1 = dataToCoord(drawing.p1.time, drawing.p1.price);
    const c2 = dataToCoord(drawing.p2.time, drawing.p2.price);
    if (c1.x == null || c2.x == null) return null;
    const mx = (c1.x + c2.x) / 2;
    const my = (c1.y + c2.y) / 2;
    return (
      <g style={{ pointerEvents: "all" }}>
        {/* Fat invisible hit strip */}
        <line
          x1={c1.x}
          y1={c1.y}
          x2={c2.x}
          y2={c2.y}
          stroke="transparent"
          strokeWidth={18}
          style={{ pointerEvents: "all" }}
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
      <g style={{ pointerEvents: "all" }}>
        {/* Fat invisible hit strip */}
        <line
          x1={0}
          y1={c.y}
          x2={svgW}
          y2={c.y}
          stroke="transparent"
          strokeWidth={18}
          style={{ pointerEvents: "all" }}
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
    // p1 = drag start, p2 = drag end
    // Price Y coords: convert each fib level price directly via priceToCoordinate
    const priceRange = drawing.p2.price - drawing.p1.price;

    const levelLines = FIB_LEVELS.map((level) => {
      const price = drawing.p1.price + priceRange * level;
      // Use null time so it only converts price → Y
      const coord = dataToCoord(null, price);
      return { level, price, y: coord.y };
    }).filter((l) => l.y != null);

    if (levelLines.length < 2) return null;

    const lineColor = hovered ? HOVER_COLOR : FIB_COLOR;
    const topY = Math.min(...levelLines.map((l) => l.y));
    const botY = Math.max(...levelLines.map((l) => l.y));

    // Label badge width: "0.786 (23,808.65)" ~ 140px
    const BADGE_W = 145;
    const BADGE_H = 16;
    // Lines span full chart width; label pinned to right edge
    const lineX1 = 0;
    const lineX2 = svgW - BADGE_W - 4;
    const badgeX = svgW - BADGE_W - 2;

    // Hit strip: full width invisible rect covering the whole fib zone
    // (for delete — placed first so drawings render on top)
    return (
      <g style={{ pointerEvents: "all" }}>
        {/* Full-width invisible hit area */}
        <rect
          x={0} y={topY - 6}
          width={svgW} height={botY - topY + 12}
          fill="transparent"
          style={{ pointerEvents: "all" }}
        />

        {/* Subtle fill between 0% and 100% */}
        <rect
          x={0} y={Math.min(levelLines[0].y, levelLines[levelLines.length - 1].y)}
          width={svgW - BADGE_W - 4}
          height={Math.abs(levelLines[0].y - levelLines[levelLines.length - 1].y)}
          fill={lineColor}
          opacity={0.04}
          style={{ pointerEvents: "none" }}
        />

        {levelLines.map(({ level, price, y }) => {
          const isEdge = level === 0 || level === 1;
          const labelText = `${level === 0 ? "0" : level === 1 ? "1" : level.toFixed(3).replace(/^0/, "")} (${numFmt.format(price)})`;
          return (
            <g key={level} style={{ pointerEvents: "none" }}>
              {/* Full-width horizontal line */}
              <line
                x1={lineX1} y1={y}
                x2={lineX2} y2={y}
                stroke={lineColor}
                strokeWidth={isEdge ? 1.6 : 0.9}
                strokeDasharray={isEdge ? "0" : "5 3"}
                opacity={hovered ? 1 : 0.85}
              />
              {/* Label badge pinned to right */}
              <rect
                x={badgeX} y={y - BADGE_H / 2}
                width={BADGE_W} height={BADGE_H}
                rx={2}
                fill={lineColor}
                opacity={hovered ? 0.25 : 0.15}
              />
              <text
                x={badgeX + 5} y={y + 4}
                fill={lineColor}
                fontSize={9.5}
                fontFamily="'JetBrains Mono', monospace"
                fontWeight={600}
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
    const BADGE_W = 145;
    const lineX2 = svgW - BADGE_W - 4;

    return (
      <g style={{ pointerEvents: "none" }}>
        {FIB_LEVELS.map((level) => {
          const price = start.price + priceRange * level;
          const coord = dataToCoord(null, price);
          if (coord.y == null) return null;
          const isEdge = level === 0 || level === 1;
          return (
            <line
              key={level}
              x1={0}
              y1={coord.y}
              x2={lineX2}
              y2={coord.y}
              stroke={FIB_COLOR}
              strokeWidth={isEdge ? 1.6 : 0.9}
              strokeDasharray={isEdge ? "0" : "5 3"}
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