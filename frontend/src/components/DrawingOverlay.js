// DrawingOverlay.js
// SVG drawing overlay for lightweight-charts.
// Tools: trendline, horizontal, fibRetracement, text, draw (freehand)
// Features:
//   - Ctrl+Z: undo last drawing
//   - Delete key on hovered drawing: delete that drawing
//   - Hover works in BOTH cursor mode and drawing mode
//   - Fib: time+price anchored, stretches with zoom/scroll like Fyers
//   - Fib drag: fully window-level so it works regardless of SVG pointerEvents state

import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useState,
  useCallback,
} from "react";
import { DRAW_COLORS } from "./TradingToolbar";

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
  { ratio: -1.618, label: "-1.618", color: "#26a69a", dash: "6 3", width: 1.2 },
  { ratio: -1.000, label: "-1", color: "#ef5350", dash: "4 3", width: 1.4 },
  { ratio: -0.236, label: "-0.236", color: "#fb8c00", dash: "4 2", width: 1.0 },
  { ratio: 0.000, label: "0", color: "#b2b5be", dash: "0", width: 1.6 },
  { ratio: 0.236, label: "0.236", color: "#fb8c00", dash: "4 2", width: 1.0 },
  { ratio: 0.382, label: "0.382", color: "#26c6da", dash: "5 3", width: 1.0 },
  { ratio: 0.500, label: "0.500", color: "#66bb6a", dash: "5 3", width: 1.2 },
  { ratio: 0.618, label: "0.618", color: "#ffca28", dash: "5 3", width: 1.4 },
  { ratio: 0.786, label: "0.786", color: "#26c6da", dash: "5 3", width: 1.0 },
  { ratio: 1.000, label: "1", color: "#b2b5be", dash: "0", width: 1.6 },
  { ratio: 1.618, label: "1.618", color: "#26a69a", dash: "6 3", width: 1.2 },
];

const FIB_ZONE_FILLS = [
  { from: -1.618, to: -1.000, color: "#26a69a", opacity: 0.10 },
  { from: -1.000, to: -0.236, color: "#ef9a9a", opacity: 0.10 },
  { from: -0.236, to: 0.000, color: "#ff9800", opacity: 0.28 },
  { from: 0.000, to: 0.236, color: "#ff9800", opacity: 0.28 },
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
  } catch { return []; }
}

function saveDrawings(drawings) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(drawings)); } catch { }
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

// ─── Number formatter ─────────────────────────────────────────────────────────
const numFmt = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Component ────────────────────────────────────────────────────────────────
const DrawingOverlay = forwardRef(function DrawingOverlay(
  {
    chartRef,
    candleSeriesRef,
    selectedTool,
    setSelectedTool,
    containerRef,
    hidden,
    drawColor = "white",
    drawThickness = 1,
    lastBarTime = null,
  },
  ref
) {
  const svgRef = useRef(null);
  const wrapRef = useRef(null);

  const drawingsRef = useRef(loadDrawings());
  const [drawings, setDrawings] = useState(drawingsRef.current);

  const [pendingText, setPendingText] = useState(null);
  const pendingTextRef = useRef(null);
  const textInputRef = useRef(null);

  // freehand draw state
  const freehandRef = useRef({ active: false, points: [] });
  const [freehandPreview, setFreehandPreview] = useState(null);

  // keep a ref so event handlers always see the latest color (avoids stale closure)
  const drawColorRef = useRef(drawColor);
  useEffect(() => { drawColorRef.current = drawColor; }, [drawColor]);

  // ── Arrow-key nudge for horizontal lines: fixed step of 5 ──────────────
  const NUDGE_STEP = 0.05;

  const commitDrawings = useCallback((next) => {
    drawingsRef.current = next;
    saveDrawings(next);
    setDrawings([...next]);
  }, []);

  // ── New-drawing drag (trendline / horizontal / fib while drawing) ────────
  const dragRef = useRef({ active: false, tool: null, start: null, current: null });

  // ── Edit drag: move/resize existing fib — stored entirely in a ref so
  //    window-level handlers always see the latest state without re-registering
  const editDragRef = useRef({
    active: false,
    id: null,
    mode: null,           // "move" | "p1" | "p2"
    startCoord: null,     // { price, time, x, y } at mousedown
    origP1: null,
    origP2: null,
  });

  const [hoveredId, setHoveredId] = useState(null);
  const hoveredIdRef = useRef(null);

  // ── Selected horizontal line (click-to-select, Escape/click-away deselects)
  const [selectedHLineId, setSelectedHLineId] = useState(null);
  const selectedHLineIdRef = useRef(null);
  const setSelectedHL = (id) => {
    selectedHLineIdRef.current = id;
    setSelectedHLineId(id);
  };

  // We need stable refs to coordToData / dataToCoord so window listeners
  // can call them without being registered every render.
  const coordToDataRef = useRef(null);
  const dataToCoordRef = useRef(null);
  const hitTestRef = useRef(null);
  const fibHitDetailRef = useRef(null);

  // ── Coordinate helpers ───────────────────────────────────────────────────
  const coordToData = useCallback((x, y) => {
    try {
      const time = chartRef.current?.timeScale().coordinateToTime(x) ?? null;
      const price = candleSeriesRef.current?.coordinateToPrice(y) ?? null;
      return { x, y, time, price };
    } catch { return { x, y, time: null, price: null }; }
  }, [chartRef, candleSeriesRef]);

  const dataToCoord = useCallback((time, price) => {
    try {
      const x = time != null ? chartRef.current?.timeScale().timeToCoordinate(time) : null;
      const y = price != null ? candleSeriesRef.current?.priceToCoordinate(price) : null;
      return { x, y };
    } catch { return { x: null, y: null }; }
  }, [chartRef, candleSeriesRef]);

  // Keep refs current so window handlers can always call the latest version
  useEffect(() => { coordToDataRef.current = coordToData; }, [coordToData]);
  useEffect(() => { dataToCoordRef.current = dataToCoord; }, [dataToCoord]);

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

  // ── Hit test ─────────────────────────────────────────────────────────────
  const hitTest = useCallback((drawing, px, py) => {
    const dtc = dataToCoordRef.current;
    if (!dtc) return false;
    try {
      if (drawing.type === "trendline") {
        const c1 = dtc(drawing.p1.time, drawing.p1.price);
        const c2 = dtc(drawing.p2.time, drawing.p2.price);
        if (c1.x == null || c2.x == null) return false;
        return distToSegment(px, py, c1.x, c1.y, c2.x, c2.y) < HIT_SLOP;
      }
      if (drawing.type === "horizontal") {
        const c = dtc(null, drawing.price);
        if (c.y == null) return false;
        return Math.abs(py - c.y) < HIT_SLOP;
      }
      if (drawing.type === "fibRetracement") {
        const c1 = dtc(drawing.p1.time, drawing.p1.price);
        const c2 = dtc(drawing.p2.time, drawing.p2.price);
        // Resolve X with pixel fallback for right-of-candles anchors
        const ax1 = c1.x ?? drawing.p1.px ?? null;
        const ax2 = c2.x ?? drawing.p2.px ?? null;
        if (ax1 == null || ax2 == null) return false;
        // Only hit-test inside the rectangle's X bounds
        const bx1 = Math.min(ax1, ax2);
        const bx2 = Math.max(ax1, ax2);
        if (px < bx1 || px > bx2) return false; // cursor outside rectangle — no hit
        const priceRange = drawing.p2.price - drawing.p1.price;
        for (const lvl of FIB_LEVELS) {
          const price = drawing.p1.price + priceRange * lvl.ratio;
          const c = dtc(null, price);
          if (c.y != null && Math.abs(py - c.y) < HIT_SLOP) return true;
        }
        return false;
      }
      if (drawing.type === "text") {
        const c = dtc(drawing.time, drawing.price);
        const cx = c.x ?? drawing.x;
        const cy = c.y ?? drawing.y;
        if (cx == null || cy == null) return false;
        const textW = (drawing.content?.length ?? 4) * 8 + 16;
        const textH = 22;
        return px >= cx - 4 && px <= cx + textW && py >= cy - textH && py <= cy + 4;
      }
      if (drawing.type === "freehand" && drawing.points?.length > 1) {
        for (let i = 0; i < drawing.points.length - 1; i++) {
          const p1 = drawing.points[i];
          const p2 = drawing.points[i + 1];
          if (distToSegment(px, py, p1.x, p1.y, p2.x, p2.y) < HIT_SLOP) return true;
        }
        return false;
      }
    } catch { }
    return false;
  }, []); // dataToCoordRef is a ref — no dep needed

  useEffect(() => { hitTestRef.current = hitTest; }, [hitTest]);

  // ── Fib hit detail: "p1" | "p2" | "body" | null ─────────────────────────
  const fibHitDetail = useCallback((drawing, px, py) => {
    if (drawing.type !== "fibRetracement") return null;
    const dtc = dataToCoordRef.current;
    if (!dtc) return null;
    const c1 = dtc(drawing.p1.time, drawing.p1.price);
    const c2 = dtc(drawing.p2.time, drawing.p2.price);
    // Resolve X with pixel fallback for right-side anchors
    const ax1 = c1.x ?? drawing.p1.px ?? null;
    const ax2 = c2.x ?? drawing.p2.px ?? null;
    // Check handles first (allow slight outside-box tolerance for handle grab)
    if (ax1 != null && Math.hypot(px - ax1, py - (c1.y ?? 0)) < 12) return "p1";
    if (ax2 != null && Math.hypot(px - ax2, py - (c2.y ?? 0)) < 12) return "p2";
    // Body hit — must be inside X bounds
    if (ax1 == null || ax2 == null) return null;
    const bx1 = Math.min(ax1, ax2);
    const bx2 = Math.max(ax1, ax2);
    if (px < bx1 || px > bx2) return null;
    const priceRange = drawing.p2.price - drawing.p1.price;
    for (const lvl of FIB_LEVELS) {
      const price = drawing.p1.price + priceRange * lvl.ratio;
      const c = dtc(null, price);
      if (c.y != null && Math.abs(py - c.y) < HIT_SLOP) return "body";
    }
    return null;
  }, []);

  useEffect(() => { fibHitDetailRef.current = fibHitDetail; }, [fibHitDetail]);

  // ── Delete a drawing ──────────────────────────────────────────────────────
  const deleteDrawing = useCallback((id, e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    const next = drawingsRef.current.filter((d) => d.id !== id);
    hoveredIdRef.current = null;
    setHoveredId(null);
    commitDrawings(next);
  }, [commitDrawings]);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

      // Escape — deselect horizontal line
      if (e.key === "Escape") {
        if (selectedHLineIdRef.current != null) {
          e.preventDefault();
          setSelectedHL(null);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        if (drawingsRef.current.length === 0) return;
        hoveredIdRef.current = null;
        setHoveredId(null);
        setSelectedHL(null);
        commitDrawings(drawingsRef.current.slice(0, -1));
        return;
      }

      // Delete — works on selected hline OR any hovered drawing
      if (e.key === "Delete" || e.key === "Backspace") {
        const target = selectedHLineIdRef.current ?? hoveredIdRef.current;
        if (target == null) return;
        e.preventDefault();
        setSelectedHL(null);
        deleteDrawing(target);
        return;
      }

      // ── Arrow key nudge for SELECTED horizontal line ──────────────────
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const hid = selectedHLineIdRef.current;
        if (hid == null) return;
        const sel = drawingsRef.current.find((d) => d.id === hid);
        if (!sel || sel.type !== "horizontal") return;
        e.preventDefault();
        const dir = e.key === "ArrowUp" ? 1 : -1;
        // Snap to nearest multiple of 5, then step
        const snapped = Math.round(sel.price / NUDGE_STEP) * NUDGE_STEP;
        const newPrice = snapped + NUDGE_STEP * dir;
        const next = drawingsRef.current.map((d) =>
          d.id === hid ? { ...d, price: Math.round(newPrice * 1e6) / 1e6 } : d
        );
        commitDrawings(next);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commitDrawings, deleteDrawing]);

  // ── Text commit ───────────────────────────────────────────────────────────
  const commitTextInput = useCallback((value) => {
    const pt = pendingTextRef.current;
    if (!pt) return;
    setPendingText(null);
    pendingTextRef.current = null;
    if (!value || !value.trim()) return;
    commitDrawings([...drawingsRef.current, {
      id: uid(), type: "text", content: value.trim(),
      price: pt.price, time: pt.time, x: pt.x, y: pt.y,
      fontSize: 13, color: TEXT_COLOR,
    }]);
  }, [commitDrawings]);

  useEffect(() => {
    if (pendingText && textInputRef.current) setTimeout(() => textInputRef.current?.focus(), 30);
  }, [pendingText]);

  // ── SVG-relative coords from a MouseEvent ────────────────────────────────
  const svgRelCoord = useCallback((e) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  // ────────────────────────────────────────────────────────────────────────────
  // WINDOW-LEVEL MOUSE HANDLERS
  // These run unconditionally so they work even when the SVG has
  // pointerEvents:none (cursor mode with nothing hovered).
  // ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    function onWindowMouseDown(e) {
      if (e.button !== 0) return;
      if (hidden) return;

      const selectedToolVal = selectedToolRef.current;
      if (selectedToolVal !== "cursor") return;

      const { x, y } = svgRelCoord(e);

      // ── Check every drawing for a hit at this click point ────────────
      let hitId = null;
      for (const d of drawingsRef.current) {
        if (hitTestRef.current?.(d, x, y)) { hitId = d.id; break; }
      }

      const clickedDrawing = hitId != null
        ? drawingsRef.current.find((d) => d.id === hitId)
        : null;

      // ── Horizontal line: click-to-select / click-away-to-deselect ────
      if (clickedDrawing?.type === "horizontal") {
        e.stopPropagation();
        e.preventDefault();
        // Toggle: clicking already-selected line deselects it
        const alreadySelected = selectedHLineIdRef.current === hitId;
        setSelectedHL(alreadySelected ? null : hitId);
        return;
      }

      // ── Clicking anything else deselects the horizontal line ─────────
      if (selectedHLineIdRef.current != null) {
        setSelectedHL(null);
        // Don't stop propagation — let chart pan on click-away
      }

      // ── Fib: drag to move/resize ──────────────────────────────────────
      if (clickedDrawing?.type === "fibRetracement") {
        const detail = fibHitDetailRef.current?.(clickedDrawing, x, y);
        if (!detail) return;
        e.stopPropagation();
        e.preventDefault();
        const pt = coordToDataRef.current?.(x, y) ?? { price: null, time: null };
        editDragRef.current = {
          active: true,
          id: clickedDrawing.id,
          mode: detail,
          startCoord: { price: pt.price, time: pt.time, x, y },
          origP1: { ...clickedDrawing.p1 },
          origP2: { ...clickedDrawing.p2 },
        };
        setDrawings((d) => [...d]);
      }
    }

    function onWindowMouseMove(e) {
      if (hidden) return;
      const svgEl = svgRef.current;
      if (!svgEl) return;
      const r = svgEl.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;

      // ── freehand: accumulate points ───────────────────────────────────
      if (freehandRef.current.active) {
        freehandRef.current.points.push({ x, y });
        setFreehandPreview([...freehandRef.current.points]);
        return;
      }

      // ── edit drag: move/resize committed fib ──────────────────────────
      if (editDragRef.current.active) {
        const ed = editDragRef.current;
        const cur = coordToDataRef.current?.(x, y);
        if (!cur || cur.price == null) return;

        const idx = drawingsRef.current.findIndex((d) => d.id === ed.id);
        if (idx < 0) return;
        const d = drawingsRef.current[idx];

        const dPrice = cur.price - ed.startCoord.price;
        const dTime =
          cur.time != null && ed.startCoord.time != null
            ? cur.time - ed.startCoord.time
            : 0;

        let newP1 = { ...ed.origP1 };
        let newP2 = { ...ed.origP2 };

        if (ed.mode === "move") {
          const dPx = x - ed.startCoord.x;
          newP1 = {
            price: ed.origP1.price + dPrice,
            time: ed.origP1.time != null ? ed.origP1.time + dTime : null,
            px: ed.origP1.px != null ? ed.origP1.px + dPx : null,
          };
          newP2 = {
            price: ed.origP2.price + dPrice,
            time: ed.origP2.time != null ? ed.origP2.time + dTime : null,
            px: ed.origP2.px != null ? ed.origP2.px + dPx : null,
          };
        } else if (ed.mode === "p1") {
          newP1 = { price: cur.price, time: cur.time, px: x };
        } else if (ed.mode === "p2") {
          newP2 = { price: cur.price, time: cur.time, px: x };
        }

        const updated = [...drawingsRef.current];
        updated[idx] = { ...d, p1: newP1, p2: newP2 };
        drawingsRef.current = updated;
        setDrawings([...updated]);
        return;
      }

      // ── new-drawing drag ──────────────────────────────────────────────
      if (dragRef.current.active) {
        dragRef.current.current = coordToDataRef.current?.(x, y);
        setDrawings((d) => [...d]);
        return;
      }

      // ── hover hit-test (only if cursor inside SVG) ────────────────────
      const inside =
        e.clientX >= r.left && e.clientX <= r.right &&
        e.clientY >= r.top && e.clientY <= r.bottom;

      if (!inside) {
        if (hoveredIdRef.current !== null) { hoveredIdRef.current = null; setHoveredId(null); }
        return;
      }

      let hitId = null;
      for (const drawing of drawingsRef.current) {
        if (hitTestRef.current?.(drawing, x, y)) { hitId = drawing.id; break; }
      }
      if (hitId !== hoveredIdRef.current) {
        hoveredIdRef.current = hitId;
        setHoveredId(hitId);
      }

      // Cursor style
      if (svgEl) {
        if (hitId != null) {
          const hd = drawingsRef.current.find((d) => d.id === hitId);
          if (hd?.type === "fibRetracement") {
            const detail = fibHitDetailRef.current?.(hd, x, y);
            svgEl.style.cursor = (detail === "p1" || detail === "p2") ? "ew-resize" : "move";
          } else {
            svgEl.style.cursor = "pointer";
          }
        } else {
          svgEl.style.cursor = "";
        }
      }
    }

    function onWindowMouseUp(e) {
      // commit edit drag
      if (editDragRef.current.active) {
        editDragRef.current = {
          active: false, id: null, mode: null,
          startCoord: null, origP1: null, origP2: null,
        };
        saveDrawings(drawingsRef.current);
        setDrawings((d) => [...d]); // repaint to clear cursor override
        return;
      }
    }

    // Use capture so we intercept before the chart sees mousedown
    window.addEventListener("mousedown", onWindowMouseDown, { capture: true });
    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("mouseup", onWindowMouseUp);
    return () => {
      window.removeEventListener("mousedown", onWindowMouseDown, { capture: true });
      window.removeEventListener("mousemove", onWindowMouseMove);
      window.removeEventListener("mouseup", onWindowMouseUp);
    };
  }, [hidden, svgRelCoord]);

  // Stable ref for selectedTool so the window mousedown handler
  // always sees the current value without re-registering
  const selectedToolRef = useRef(selectedTool);
  useEffect(() => { selectedToolRef.current = selectedTool; }, [selectedTool]);

  // ── Imperative API ───────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    clearAll() {
      hoveredIdRef.current = null;
      setHoveredId(null);
      setPendingText(null);
      pendingTextRef.current = null;
      freehandRef.current = { active: false, points: [] };
      setFreehandPreview(null);
      commitDrawings([]);
    },
    getDrawings() { return drawingsRef.current; },
    addFibDrawing({ p1Price, p1Time = null, p2Price, p2Time = null }) {
      if (p1Price == null || p2Price == null) return;
      commitDrawings([...drawingsRef.current, {
        id: uid(), type: "fibRetracement",
        p1: { price: p1Price, time: p1Time },
        p2: { price: p2Price, time: p2Time },
      }]);
    },
  }));

  // ── Drawing tools list ───────────────────────────────────────────────────
  const DRAWING_TOOLS = ["trendline", "horizontal", "fibRetracement", "text", "draw"];

  const relCoord = useCallback((e) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  // ── SVG pointer handlers (new drawings + freehand + text) ────────────────
  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    // Fib drag in cursor mode is handled by window mousedown above — skip here
    if (selectedToolRef.current === "cursor") return;
    if (!DRAWING_TOOLS.includes(selectedToolRef.current)) return;

    e.stopPropagation();

    const { x, y } = relCoord(e);
    const pt = coordToDataRef.current?.(x, y) ?? { x, y, time: null, price: null };

    if (selectedToolRef.current === "text") {
      if (pendingTextRef.current) commitTextInput(textInputRef.current?.value ?? "");
      const newPt = { x, y, price: pt.price, time: pt.time };
      pendingTextRef.current = newPt;
      setPendingText({ ...newPt });
      return;
    }

    if (selectedToolRef.current === "draw") {
      freehandRef.current = { active: true, points: [{ x, y }] };
      setFreehandPreview([{ x, y }]);
      try { svgRef.current?.setPointerCapture(e.pointerId); } catch { }
      return;
    }

    try { svgRef.current?.setPointerCapture(e.pointerId); } catch { }
    dragRef.current = {
      active: true,
      tool: selectedToolRef.current,
      start: pt,
      current: { ...pt },
    };
  }, [relCoord, commitTextInput]);

  const onPointerMove = useCallback((e) => {
    if (dragRef.current.active) {
      const { x, y } = relCoord(e);
      dragRef.current.current = coordToDataRef.current?.(x, y);
      setDrawings((d) => [...d]);
    }
  }, [relCoord]);

  const onPointerUp = useCallback((e) => {
    // commit freehand
    if (freehandRef.current.active) {
      const pts = freehandRef.current.points;
      freehandRef.current = { active: false, points: [] };
      setFreehandPreview(null);
      if (pts.length > 1) {
        const colorHex =
          DRAW_COLORS.find((c) => c.id === drawColorRef.current)?.hex || "#e0e3eb";
        commitDrawings([...drawingsRef.current, {
          id: uid(), type: "freehand", points: pts, color: colorHex, width: 1.8,
        }]);
      }
      return;
    }

    const drag = dragRef.current;
    if (!drag.active) return;
    const { x, y } = relCoord(e);
    drag.current = coordToDataRef.current?.(x, y);
    const d = buildDrawing(drag);
    if (d) commitDrawings([...drawingsRef.current, d]);
    dragRef.current = { active: false, tool: null, start: null, current: null };
  }, [relCoord, commitDrawings]);

  // ── Render ───────────────────────────────────────────────────────────────
  const drag = dragRef.current;
  const svgW = containerRef.current?.clientWidth ?? 800;
  const svgH = containerRef.current?.clientHeight ?? 500;
  const isDrawing = DRAWING_TOOLS.includes(selectedTool);
  const isEditDragging = editDragRef.current.active;

  // SVG needs pointer events when:
  //  - any drawing tool is active (to capture new drawings)
  //  - something is hovered (to show delete/move cursor)
  //  - we're NOT in cursor mode (drawing tools always need events)
  const needsPointerEvents =
    !hidden && (isDrawing || hoveredId != null || isEditDragging);

  let pendingInputX = 0, pendingInputY = 0;
  if (pendingText) {
    const c = dataToCoord(pendingText.time, pendingText.price);
    pendingInputX = c.x ?? pendingText.x ?? 100;
    pendingInputY = c.y ?? pendingText.y ?? 100;
  }

  const drawCursor =
    selectedTool === "draw" ? "crosshair"
      : selectedTool === "text" ? "text"
        : hoveredId ? "pointer"
          : "crosshair";

  return (
    <div
      ref={wrapRef}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 25 }}
    >
      <svg
        ref={svgRef}
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          pointerEvents: needsPointerEvents ? "all" : "none",
          cursor: isEditDragging
            ? (editDragRef.current.mode === "move" ? "move" : "ew-resize")
            : isDrawing ? drawCursor
              : hoveredId ? "pointer"
                : "default",
          overflow: "visible",
          visibility: hidden ? "hidden" : "visible",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Transparent hit surface for drawing tools */}
        {isDrawing && (
          <rect
            x={0} y={0} width={svgW} height={svgH}
            fill="transparent"
            style={{ pointerEvents: "all" }}
          />
        )}

        {/* Committed drawings */}
        {!hidden && drawings.map((d) => (
          <DrawingShape
            key={d.id}
            drawing={d}
            dataToCoord={dataToCoord}
            svgW={svgW}
            svgH={svgH}
            hovered={hoveredId === d.id}
            selected={selectedHLineId === d.id}
            interactive={true}
            lastBarTime={lastBarTime}
          />
        ))}

        {/* Live trendline / fib preview while dragging */}
        {drag.active && drag.start && drag.current && (
          <LivePreview
            drag={drag}
            svgW={svgW}
            svgH={svgH}
            dataToCoord={dataToCoord}
          />
        )}

        {/* Freehand live preview */}
        {freehandPreview && freehandPreview.length > 1 && (
          <FreehandPreview
            points={freehandPreview}
            color={
              DRAW_COLORS.find((c) => c.id === drawColorRef.current)?.hex || "#e0e3eb"
            }
            width={1.8}
          />
        )}
      </svg>

      {/* Inline text input */}
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
              if (e.key === "Enter") { e.preventDefault(); commitTextInput(e.target.value); }
              if (e.key === "Escape") {
                e.preventDefault();
                pendingTextRef.current = null;
                setPendingText(null);
              }
              e.stopPropagation();
            }}
            onBlur={(e) => { commitTextInput(e.target.value); }}
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
          <div
            style={{
              fontSize: 10, color: "#4a4f60", marginTop: 2,
              fontFamily: "sans-serif", pointerEvents: "none",
            }}
          >
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
      id: uid(), type: "trendline",
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
    // Store pixel X as fallback when time is null (right of last candle = blank area)
    return {
      id: uid(), type: "fibRetracement",
      p1: { price: start.price, time: start.time, px: start.x },
      p2: { price: current.price, time: current.time, px: current.x },
    };
  }
  return null;
}

// ─── FreehandPreview ──────────────────────────────────────────────────────────
function FreehandPreview({ points, color, width }) {
  if (!points || points.length < 2) return null;
  const d = "M" + points.map((p) => `${p.x},${p.y}`).join(" L");
  return (
    <path
      d={d}
      stroke={color}
      strokeWidth={width}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={0.85}
      style={{ pointerEvents: "none" }}
    />
  );
}

// ─── Live preview while dragging (trendline / fib) ───────────────────────────
function LivePreview({ drag, svgW, svgH, dataToCoord }) {
  const { tool, start, current } = drag;
  const color = DRAW_COLOR;

  if (tool === "trendline") {
    return (
      <g style={{ pointerEvents: "none" }}>
        <line
          x1={start.x} y1={start.y}
          x2={current.x} y2={current.y}
          stroke={color} strokeWidth={1.8}
        />
        <circle cx={start.x} cy={start.y} r={HANDLE_R} fill={color} />
        <circle cx={current.x} cy={current.y} r={HANDLE_R} fill={color} />
      </g>
    );
  }

  if (tool === "horizontal") {
    return (
      <line
        x1={0} y1={start.y} x2={svgW} y2={start.y}
        stroke={color} strokeWidth={1.8} strokeDasharray="7 4"
        style={{ pointerEvents: "none" }}
      />
    );
  }

  if (tool === "fibRetracement") {
    if (start.price == null || current.price == null) return null;
    const priceRange = current.price - start.price;
    const PRICE_SCALE_W = 70;
    const maxX = svgW - PRICE_SCALE_W;

    // Strict box — exactly anchor to anchor, clamped to visible plot area
    const rawX1 = Math.min(start.x, current.x);
    const rawX2 = Math.max(start.x, current.x);
    const boxX1 = Math.max(rawX1, 0);
    const boxX2 = Math.min(rawX2, maxX);
    if (boxX2 <= boxX1) return null;

    const previewClipId = "fib-preview-clip";
    const LABEL_PAD = 6;

    return (
      <g style={{ pointerEvents: "none" }}>
        <defs>
          <clipPath id={previewClipId}>
            <rect x={boxX1} y={0} width={boxX2 - boxX1} height={svgH} />
          </clipPath>
        </defs>

        {/* Zone fills strictly inside box */}
        <g clipPath={`url(#${previewClipId})`}>
          {FIB_ZONE_FILLS.map((zone) => {
            const prA = start.price + priceRange * zone.from;
            const prB = start.price + priceRange * zone.to;
            const cA = dataToCoord(null, prA);
            const cB = dataToCoord(null, prB);
            if (cA.y == null || cB.y == null) return null;
            const zy = Math.min(cA.y, cB.y);
            const zh = Math.abs(cB.y - cA.y);
            return (
              <rect
                key={`z${zone.from}`}
                x={boxX1} y={zy}
                width={boxX2 - boxX1} height={Math.max(zh, 1)}
                fill={zone.color} opacity={zone.opacity}
              />
            );
          })}

          {/* Level lines strictly inside box */}
          {FIB_LEVELS.map((lvl) => {
            const price = start.price + priceRange * lvl.ratio;
            const coord = dataToCoord(null, price);
            if (coord.y == null) return null;
            const isEdge = lvl.ratio === 0 || lvl.ratio === 1;
            return (
              <line
                key={lvl.ratio}
                x1={boxX1} y1={coord.y} x2={boxX2} y2={coord.y}
                stroke={lvl.color}
                strokeWidth={isEdge ? 1.8 : lvl.width}
                strokeDasharray={isEdge ? "0" : lvl.dash}
                opacity={0.85}
              />
            );
          })}
        </g>

        {/* Labels inside the right edge */}
        {FIB_LEVELS.map((lvl) => {
          const price = start.price + priceRange * lvl.ratio;
          const coord = dataToCoord(null, price);
          if (coord.y == null) return null;
          const isEdge = lvl.ratio === 0 || lvl.ratio === 1;
          return (
            <text
              key={`lbl-${lvl.ratio}`}
              x={boxX2 - LABEL_PAD} y={coord.y - 3}
              fill={lvl.color} fontSize={9}
              fontFamily="'JetBrains Mono', monospace"
              fontWeight={isEdge ? 700 : 600}
              textAnchor="end"
            >
              {lvl.label} ({numFmt.format(price)})
            </text>
          );
        })}

        <circle cx={start.x} cy={start.y} r={HANDLE_R} fill={FIB_COLOR} />
        <circle cx={current.x} cy={current.y} r={HANDLE_R} fill={FIB_COLOR} />
      </g>
    );
  }

  return null;
}

// ─── Completed drawing shapes ─────────────────────────────────────────────────
function DrawingShape({ drawing, dataToCoord, svgW, svgH, hovered, selected, interactive, lastBarTime }) {
  const color = hovered ? HOVER_COLOR : DRAW_COLOR;
  const strokeW = hovered ? 2.5 : 1.8;
  const pe = interactive ? "all" : "none";

  // ── Freehand ────────────────────────────────────────────────────────────
  if (drawing.type === "freehand" && drawing.points?.length > 1) {
    const pts = drawing.points;
    const d = "M" + pts.map((p) => `${p.x},${p.y}`).join(" L");
    const strokeColor = hovered ? HOVER_COLOR : (drawing.color || "#e0e3eb");
    const strokeWidth = hovered
      ? (drawing.width || 1.5) * 1.3
      : (drawing.width || 1.5);
    return (
      <g style={{ pointerEvents: pe }}>
        {/* Wide transparent strip for easy hit-testing */}
        <path
          d={d}
          stroke="transparent"
          strokeWidth={Math.max(strokeWidth + 10, 16)}
          fill="none"
          style={{ pointerEvents: pe }}
        />
        <path
          d={d}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: "none" }}
        />
      </g>
    );
  }

  // ── Trend Line ──────────────────────────────────────────────────────────
  if (drawing.type === "trendline") {
    const c1 = dataToCoord(drawing.p1.time, drawing.p1.price);
    const c2 = dataToCoord(drawing.p2.time, drawing.p2.price);
    if (c1.x == null || c2.x == null) return null;
    return (
      <g style={{ pointerEvents: pe }}>
        <line
          x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y}
          stroke="transparent" strokeWidth={18}
          style={{ pointerEvents: pe }}
        />
        <line
          x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y}
          stroke={color} strokeWidth={strokeW}
          style={{ pointerEvents: "none" }}
        />
        <circle cx={c1.x} cy={c1.y} r={HANDLE_R} fill={color} opacity={hovered ? 1 : 0.6} style={{ pointerEvents: "none" }} />
        <circle cx={c2.x} cy={c2.y} r={HANDLE_R} fill={color} opacity={hovered ? 1 : 0.6} style={{ pointerEvents: "none" }} />
      </g>
    );
  }

  // ── Horizontal Line ─────────────────────────────────────────────────────
  if (drawing.type === "horizontal") {
    const c = dataToCoord(null, drawing.price);
    if (c.y == null) return null;
    const label = numFmt.format(drawing.price);
    const isActive = selected || hovered;
    const lineColor = selected ? "#f0c040"   // gold when selected
      : hovered ? HOVER_COLOR
        : DRAW_COLOR;
    const badgeW = 80, badgeH = 20;
    const badgeX = svgW - badgeW - 2;
    return (
      <g style={{ pointerEvents: pe }}>
        {/* Wide invisible hit strip */}
        <line
          x1={0} y1={c.y} x2={svgW} y2={c.y}
          stroke="transparent" strokeWidth={18}
          style={{ pointerEvents: pe }}
        />
        {/* Visible line — solid when active, dashed otherwise */}
        <line
          x1={0} y1={c.y} x2={svgW} y2={c.y}
          stroke={lineColor}
          strokeWidth={selected ? 2.2 : strokeW}
          strokeDasharray={isActive ? "0" : "7 4"}
          style={{ pointerEvents: "none" }}
        />
        {/* Price badge */}
        <rect
          x={badgeX} y={c.y - badgeH / 2}
          width={badgeW} height={badgeH} rx={3}
          fill={lineColor} opacity={0.92}
          style={{ pointerEvents: "none" }}
        />
        <text
          x={badgeX + badgeW / 2} y={c.y + 4}
          textAnchor="middle" fill="#fff" fontSize={10}
          fontFamily="'JetBrains Mono', monospace" fontWeight={700}
          style={{ userSelect: "none", pointerEvents: "none" }}
        >
          {label}
        </text>
        {/* ↑↓ hint badge — only when selected */}
        {selected && (
          <g style={{ pointerEvents: "none" }}>
            <rect
              x={badgeX - 46} y={c.y - badgeH / 2}
              width={40} height={badgeH} rx={3}
              fill="#f0c040" opacity={0.18}
            />
            <text
              x={badgeX - 26} y={c.y + 4}
              textAnchor="middle" fill="#f0c040" fontSize={11}
              fontFamily="sans-serif" fontWeight={700}
              style={{ userSelect: "none" }}
            >
              ↑↓
            </text>
          </g>
        )}
      </g>
    );
  }

  // ── Fibonacci Retracement — time+price anchored, works on blank right side ──
  if (drawing.type === "fibRetracement") {
    const c1 = dataToCoord(drawing.p1.time, drawing.p1.price);
    const c2 = dataToCoord(drawing.p2.time, drawing.p2.price);

    // Resolve X: prefer time-derived coord, fall back to stored pixel (.px)
    // This allows fib anchors on the blank right area (no time there).
    const ax1 = c1.x ?? drawing.p1.px ?? null;
    const ax2 = c2.x ?? drawing.p2.px ?? null;
    const hasAnchors = ax1 != null && ax2 != null;

    const PRICE_SCALE_W = 70;
    const maxX = svgW - PRICE_SCALE_W;

    // The rectangle strictly spans from anchor to anchor (no expansion to edges)
    const rawX1 = hasAnchors ? Math.min(ax1, ax2) : 0;
    const rawX2 = hasAnchors ? Math.max(ax1, ax2) : maxX;

    // Clamp to visible plot area — nothing bleeds into price scale or off-screen
    const boxX1 = Math.max(rawX1, 0);
    const boxX2 = Math.min(rawX2, maxX);

    // Hide entirely if box has no visible width
    if (boxX2 <= boxX1 + 1) return null;

    // Unique clip ID per drawing so multiple fibs don't interfere
    const clipId = `fib-clip-${drawing.id}`;

    const priceRange = drawing.p2.price - drawing.p1.price;

    const levelLines = FIB_LEVELS.map((lvl) => {
      const price = drawing.p1.price + priceRange * lvl.ratio;
      const coord = dataToCoord(null, price);
      return { ...lvl, price, y: coord.y };
    }).filter((l) => l.y != null);

    if (levelLines.length < 2) return null;

    const priceToY = (ratio) => {
      const p = drawing.p1.price + priceRange * ratio;
      const c = dataToCoord(null, p);
      return c.y;
    };

    // Top and bottom Y bounds of the fib rectangle (0 = top level, 1 = bottom)
    const topY = priceToY(
      Math.min(...FIB_LEVELS.map((l) => l.ratio))
    );
    const botY = priceToY(
      Math.max(...FIB_LEVELS.map((l) => l.ratio))
    );
    const rectTop = topY != null && botY != null ? Math.min(topY, botY) : 0;
    const rectBot = topY != null && botY != null ? Math.max(topY, botY) : svgH;

    // Labels sit just inside the right edge of the box
    const LABEL_PAD = 6;
    const labelX = boxX2 - LABEL_PAD;

    return (
      <g style={{ pointerEvents: "none" }}>
        {/* clipPath — strictly the fib rectangle, not the whole chart */}
        <defs>
          <clipPath id={clipId}>
            <rect x={boxX1} y={rectTop} width={boxX2 - boxX1} height={Math.max(rectBot - rectTop, 1)} />
          </clipPath>
        </defs>

        {/* Zone fills — clipped strictly inside the rectangle */}
        <g clipPath={`url(#${clipId})`}>
          {FIB_ZONE_FILLS.map((zone) => {
            const y1 = priceToY(zone.from);
            const y2 = priceToY(zone.to);
            if (y1 == null || y2 == null) return null;
            const zy = Math.min(y1, y2), zh = Math.abs(y2 - y1);
            return (
              <rect
                key={`zone-${zone.from}`}
                x={boxX1} y={zy}
                width={boxX2 - boxX1} height={Math.max(zh, 1)}
                fill={zone.color}
                opacity={hovered ? zone.opacity * 1.6 : zone.opacity}
                style={{ pointerEvents: "none" }}
              />
            );
          })}

          {/* Level lines — clipped strictly to rectangle */}
          {levelLines.map(({ ratio, label, color: lvlColor, dash, width, price, y }) => {
            const isEdge = ratio === 0 || ratio === 1;
            const lineColor = hovered ? HOVER_COLOR : lvlColor;
            return (
              <g key={ratio}>
                <line
                  x1={boxX1} y1={y} x2={boxX2} y2={y}
                  stroke="transparent" strokeWidth={14}
                  style={{ pointerEvents: interactive ? "stroke" : "none" }}
                />
                <line
                  x1={boxX1} y1={y} x2={boxX2} y2={y}
                  stroke={lineColor}
                  strokeWidth={isEdge ? 1.8 : width}
                  strokeDasharray={isEdge ? "0" : dash}
                  opacity={hovered ? 1 : 0.90}
                  style={{ pointerEvents: "none" }}
                />
              </g>
            );
          })}
        </g>

        {/* Labels inside the right edge of the rectangle — never overflow */}
        {levelLines.map(({ ratio, label, color: lvlColor, price, y }) => {
          const isEdge = ratio === 0 || ratio === 1;
          const labelText = `${label} (${numFmt.format(price)})`;
          const lineColor = hovered ? HOVER_COLOR : lvlColor;
          if (y == null) return null;
          return (
            <text
              key={`lbl-${ratio}`}
              x={labelX} y={y - 3}
              fill={lineColor} fontSize={9.5}
              fontFamily="'JetBrains Mono', monospace"
              fontWeight={isEdge ? 700 : 600}
              textAnchor="end"
              style={{ pointerEvents: "none", clipPath: `url(#${clipId})` }}
            >
              {labelText}
            </text>
          );
        })}

        {/* Anchor handles — shown at the actual anchor pixel positions */}
        {hasAnchors && (
          <>
            <circle cx={ax1} cy={c1.y ?? priceToY(0) ?? 0} r={3} fill={FIB_COLOR}
              opacity={hovered ? 0 : 0.35} style={{ pointerEvents: "none" }} />
            <circle cx={ax2} cy={c2.y ?? priceToY(1) ?? 0} r={3} fill={FIB_COLOR}
              opacity={hovered ? 0 : 0.35} style={{ pointerEvents: "none" }} />
            {hovered && (
              <>
                <circle cx={ax1} cy={c1.y ?? priceToY(0) ?? 0} r={8} fill={FIB_COLOR} opacity={0.18} style={{ pointerEvents: "none" }} />
                <circle cx={ax1} cy={c1.y ?? priceToY(0) ?? 0} r={5} fill={FIB_COLOR} opacity={0.9} stroke="#fff" strokeWidth={1.2} style={{ pointerEvents: "none" }} />
                <circle cx={ax2} cy={c2.y ?? priceToY(1) ?? 0} r={8} fill={FIB_COLOR} opacity={0.18} style={{ pointerEvents: "none" }} />
                <circle cx={ax2} cy={c2.y ?? priceToY(1) ?? 0} r={5} fill={FIB_COLOR} opacity={0.9} stroke="#fff" strokeWidth={1.2} style={{ pointerEvents: "none" }} />
              </>
            )}
          </>
        )}
      </g>
    );
  }

  // ── Text Label ──────────────────────────────────────────────────────────
  if (drawing.type === "text") {
    const c = dataToCoord(drawing.time, drawing.price);
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
        <rect
          x={cx - 4} y={cy - approxH}
          width={approxW} height={approxH + 4}
          fill="transparent"
          style={{ pointerEvents: pe }}
        />
        <rect
          x={cx - 4} y={cy - approxH + 2}
          width={approxW} height={approxH - 2} rx={3}
          fill={hovered ? "rgba(91,143,255,0.15)" : "rgba(30,34,45,0.75)"}
          style={{ pointerEvents: "none" }}
        />
        <text
          x={cx + 4} y={cy - 4}
          fill={textCol} fontSize={fontSize}
          fontFamily="-apple-system, BlinkMacSystemFont, 'Trebuchet MS', sans-serif"
          fontWeight={500}
          style={{ userSelect: "none", pointerEvents: "none" }}
        >
          {textContent}
        </text>
        <circle cx={cx} cy={cy} r={3} fill={textCol}
          opacity={hovered ? 1 : 0.5}
          style={{ pointerEvents: "none" }} />
      </g>
    );
  }

  return null;
}