import React, { useState, useRef, useEffect, useCallback } from "react";
import "./TradingToolbar.css";

// ─── SVG Icon Components ───────────────────────────────────────────────────────
const icons = {
  cursor: (
    <svg viewBox="0 0 18 18" fill="currentColor">
      <path d="M3 1l12 7-5.5 1.5L8 15 3 1z" />
    </svg>
  ),
  crosshair: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="9" y1="1" x2="9" y2="5" />
      <line x1="9" y1="13" x2="9" y2="17" />
      <line x1="1" y1="9" x2="5" y2="9" />
      <line x1="13" y1="9" x2="17" y2="9" />
      <circle cx="9" cy="9" r="3.5" />
    </svg>
  ),
  dot: (
    <svg viewBox="0 0 18 18" fill="currentColor">
      <circle cx="9" cy="9" r="2.5" />
    </svg>
  ),
  trendline: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="2" y1="15" x2="16" y2="3" strokeLinecap="round" />
      <circle cx="2" cy="15" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="16" cy="3" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  ray: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="2" y1="15" x2="16" y2="3" strokeLinecap="round" />
      <circle cx="2" cy="15" r="1.5" fill="currentColor" stroke="none" />
      <polygon points="16,3 13,4.5 14.5,6" fill="currentColor" stroke="none" />
    </svg>
  ),
  extendedline: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="1" y1="15" x2="17" y2="3" strokeLinecap="round" strokeDasharray="2,1" />
    </svg>
  ),
  infoLine: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="2" y1="14" x2="16" y2="4" strokeLinecap="round" />
      <circle cx="9" cy="9" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  trendAngle: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="2" y1="15" x2="16" y2="5" strokeLinecap="round" />
      <path d="M5,15 A5,5,0,0,1,9,11" strokeDasharray="1.5,1" />
    </svg>
  ),
  horizontal: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="1" y1="9" x2="17" y2="9" strokeLinecap="round" />
    </svg>
  ),
  hRay: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="1" y1="9" x2="17" y2="9" strokeLinecap="round" />
      <polygon points="17,9 14,7.5 14,10.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  hSegment: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="4" y1="9" x2="14" y2="9" strokeLinecap="round" />
      <circle cx="4" cy="9" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="14" cy="9" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  vertical: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="9" y1="1" x2="9" y2="17" strokeLinecap="round" />
    </svg>
  ),
  crossLine: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="1" y1="9" x2="17" y2="9" strokeLinecap="round" />
      <line x1="9" y1="1" x2="9" y2="17" strokeLinecap="round" />
    </svg>
  ),
  channel: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="2" y1="12" x2="16" y2="5" strokeLinecap="round" />
      <line x1="2" y1="16" x2="16" y2="9" strokeLinecap="round" strokeDasharray="2,1" />
      <line x1="2" y1="12" x2="2" y2="16" strokeLinecap="round" />
      <line x1="16" y1="5" x2="16" y2="9" strokeLinecap="round" />
    </svg>
  ),
  parallelChannel: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="2" y1="14" x2="16" y2="7" strokeLinecap="round" />
      <line x1="2" y1="10" x2="16" y2="3" strokeLinecap="round" />
    </svg>
  ),
  pitchfork: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="3" y1="14" x2="15" y2="4" strokeLinecap="round" />
      <line x1="3" y1="14" x2="3" y2="4" strokeLinecap="round" />
      <line x1="3" y1="9" x2="15" y2="9" strokeLinecap="round" strokeDasharray="1.5,1" />
    </svg>
  ),
  fibRetracement: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="1" y1="4" x2="17" y2="4" strokeLinecap="round" />
      <line x1="1" y1="9" x2="17" y2="9" strokeLinecap="round" strokeDasharray="2,1" />
      <line x1="1" y1="14" x2="17" y2="14" strokeLinecap="round" />
      <line x1="3" y1="4" x2="3" y2="14" strokeLinecap="round" />
    </svg>
  ),
  fibExtension: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="1" y1="2" x2="17" y2="2" strokeLinecap="round" />
      <line x1="1" y1="6" x2="17" y2="6" strokeLinecap="round" strokeDasharray="2,1" />
      <line x1="1" y1="10" x2="17" y2="10" strokeLinecap="round" strokeDasharray="2,1" />
      <line x1="1" y1="14" x2="17" y2="14" strokeLinecap="round" />
    </svg>
  ),
  fibCircle: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="9" cy="9" r="7" />
      <circle cx="9" cy="9" r="4" strokeDasharray="2,1" />
      <circle cx="9" cy="9" r="1.5" />
    </svg>
  ),
  fibTime: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="2" y1="2" x2="2" y2="16" strokeLinecap="round" />
      <line x1="6" y1="2" x2="6" y2="16" strokeLinecap="round" strokeDasharray="2,1" />
      <line x1="11" y1="2" x2="11" y2="16" strokeLinecap="round" strokeDasharray="2,1" />
      <line x1="17" y1="2" x2="17" y2="16" strokeLinecap="round" strokeDasharray="2,1" />
    </svg>
  ),
  rectangle: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="4" width="14" height="10" rx="1" />
    </svg>
  ),
  ellipse: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <ellipse cx="9" cy="9" rx="7" ry="5" />
    </svg>
  ),
  triangle: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polygon points="9,2 16,15 2,15" />
    </svg>
  ),
  polygon: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polygon points="9,2 16,7 13,15 5,15 2,7" />
    </svg>
  ),
  brush: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3,14 Q5,8 9,5 Q13,2 15,4" strokeLinecap="round" />
      <path d="M3,14 Q4,16 5,15" strokeLinecap="round" />
    </svg>
  ),
  highlighter: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4,13 Q8,5 14,4" strokeWidth="4" strokeLinecap="round" opacity="0.4" />
      <path d="M4,13 Q8,5 14,4" strokeLinecap="round" />
    </svg>
  ),
  path: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2,14 C4,8 8,6 9,9 C10,12 14,10 16,4" strokeLinecap="round" />
    </svg>
  ),
  text: (
    <svg viewBox="0 0 18 18" fill="currentColor">
      <text x="3" y="14" fontSize="13" fontWeight="700" fontFamily="serif">T</text>
    </svg>
  ),
  note: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="14" height="11" rx="1.5" />
      <line x1="5" y1="6" x2="13" y2="6" strokeLinecap="round" />
      <line x1="5" y1="9" x2="10" y2="9" strokeLinecap="round" />
      <path d="M12,13 L12,17 L16,13 Z" fill="currentColor" stroke="none" />
    </svg>
  ),
  callout: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="2" width="13" height="9" rx="1.5" />
      <path d="M5,11 L3,15 L8,11" strokeLinejoin="round" />
    </svg>
  ),
  arrow: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="3" y1="15" x2="15" y2="3" strokeLinecap="round" />
      <polygon points="15,3 10,4.5 13.5,8" fill="currentColor" stroke="none" />
    </svg>
  ),
  balloonUp: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="9" cy="7" r="5" />
      <path d="M7,12 L9,17 L11,12" strokeLinejoin="round" />
    </svg>
  ),
  price: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="6" width="11" height="6" rx="1" />
      <line x1="12" y1="9" x2="17" y2="9" strokeLinecap="round" />
      <line x1="5" y1="9" x2="7" y2="9" strokeLinecap="round" />
    </svg>
  ),
  measure: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="2" y1="9" x2="16" y2="9" strokeLinecap="round" />
      <line x1="2" y1="6" x2="2" y2="12" strokeLinecap="round" />
      <line x1="16" y1="6" x2="16" y2="12" strokeLinecap="round" />
    </svg>
  ),
  zoom: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="3" width="12" height="9" rx="1" />
      <line x1="13" y1="7" x2="17" y2="7" strokeLinecap="round" />
      <line x1="13" y1="10" x2="17" y2="10" strokeLinecap="round" />
    </svg>
  ),
  magnet: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3,9 L3,5 A6,6,0,0,1,15,5 L15,9" strokeLinecap="round" />
      <line x1="1" y1="9" x2="5" y2="9" strokeLinecap="round" />
      <line x1="13" y1="9" x2="17" y2="9" strokeLinecap="round" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="8" width="12" height="9" rx="1.5" />
      <path d="M6,8 L6,5 A3,3,0,0,1,12,5 L12,8" strokeLinecap="round" />
    </svg>
  ),
  hide: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1,9 Q4,4 9,4 Q14,4 17,9 Q14,14 9,14 Q4,14 1,9Z" />
      <circle cx="9" cy="9" r="2.5" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="2" y1="5" x2="16" y2="5" strokeLinecap="round" />
      <path d="M7,5 L7,3 L11,3 L11,5" strokeLinecap="round" />
      <path d="M4,5 L4.5,15.5 A0.5,0.5,0,0,0,5,16 L13,16 A0.5,0.5,0,0,0,13.5,15.5 L14,5" strokeLinecap="round" />
      <line x1="7" y1="8" x2="7" y2="13" strokeLinecap="round" />
      <line x1="11" y1="8" x2="11" y2="13" strokeLinecap="round" />
    </svg>
  ),
  chevronRight: (
    <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
      <polyline points="3,2 7,5 3,8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

// ─── Tool Group Definitions ────────────────────────────────────────────────────
// Each group has a primary tool and optional sub-tools in a flyout drawer
// ─── Keyboard shortcut map (TradingView-style) ────────────────────────────────
// Alt+key → tool id
export const TOOLBAR_SHORTCUTS = {
  "alt+a": "cursor",         // cursor / pan   (TradingView: Escape)
  "escape": "cursor",
  "alt+t": "trendline",      // Trend Line
  "alt+h": "horizontal",     // Horizontal Line
  "alt+j": "trendline",      // alias (TradingView alt+j = trend line)
  "alt+f": "fibRetracement", // Fib Retracement
  "alt+c": "channel",        // Channel
  "alt+r": "rectangle",      // Rectangle
  "alt+b": "text",           // Text / label
};

const TOOL_GROUPS = [
  {
    id: "cursor",
    icon: icons.cursor,
    label: "Cursor — Pan Mode  (Esc / Alt+A)",
    subtools: [],
  },
  {
    id: "trendline",
    icon: icons.trendline,
    label: "Trend Line  (Alt+T / Alt+J)",
    subtools: [
      { id: "trendline", icon: icons.trendline, label: "Trend Line" },
      { id: "ray", icon: icons.ray, label: "Ray" },
      { id: "extendedline", icon: icons.extendedline, label: "Extended Line" },
      { id: "trendAngle", icon: icons.trendAngle, label: "Trend Angle" },
      { id: "infoLine", icon: icons.infoLine, label: "Info Line" },
    ],
  },
  {
    id: "horizontal",
    icon: icons.horizontal,
    label: "Horizontal Line  (Alt+H)",
    subtools: [
      { id: "horizontal", icon: icons.horizontal, label: "Horizontal Line" },
      { id: "hRay", icon: icons.hRay, label: "Horizontal Ray" },
      { id: "hSegment", icon: icons.hSegment, label: "Horizontal Segment" },
      { id: "vertical", icon: icons.vertical, label: "Vertical Line" },
      { id: "crossLine", icon: icons.crossLine, label: "Cross Line" },
    ],
  },
  {
    id: "channel",
    icon: icons.channel,
    label: "Channel  (Alt+C)",
    subtools: [
      { id: "channel", icon: icons.channel, label: "Parallel Channel" },
      { id: "parallelChannel", icon: icons.parallelChannel, label: "Flat Top/Bottom" },
      { id: "pitchfork", icon: icons.pitchfork, label: "Pitchfork" },
    ],
  },
  {
    id: "fibRetracement",
    icon: icons.fibRetracement,
    label: "Fib Retracement  (Alt+F)",
    subtools: [
      { id: "fibRetracement", icon: icons.fibRetracement, label: "Fib Retracement" },
      { id: "fibExtension", icon: icons.fibExtension, label: "Fib Extension" },
      { id: "fibCircle", icon: icons.fibCircle, label: "Fib Circles" },
      { id: "fibTime", icon: icons.fibTime, label: "Fib Time Zones" },
    ],
  },
  // ── brush & measure removed per user request ──
  {
    id: "rectangle",
    icon: icons.rectangle,
    label: "Rectangle  (Alt+R)",
    subtools: [
      { id: "rectangle", icon: icons.rectangle, label: "Rectangle" },
      { id: "ellipse", icon: icons.ellipse, label: "Ellipse" },
      { id: "triangle", icon: icons.triangle, label: "Triangle" },
      { id: "polygon", icon: icons.polygon, label: "Polyline" },
    ],
  },
  {
    id: "text",
    icon: icons.text,
    label: "Text  (Alt+B)",
    subtools: [], // no dropdown — single text tool
  },
  { id: "divider1", divider: true },
  {
    id: "magnet",
    icon: icons.magnet,
    label: "Magnet Mode",
    toggle: true,
    subtools: [],
  },
  {
    id: "lock",
    icon: icons.lock,
    label: "Lock All Drawings",
    action: true,
    subtools: [],
  },
  {
    id: "hide",
    icon: icons.hide,
    label: "Hide All Drawings",
    toggle: true,
    subtools: [],
  },
  { id: "divider2", divider: true },
  {
    id: "trash",
    icon: icons.trash,
    label: "Remove All Drawings",
    action: true,
    danger: true,
    subtools: [],
  },
];

// ─── Sub-drawer Component ──────────────────────────────────────────────────────
function SubDrawer({ group, position, selectedTool, onSelect, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      className="tv-subdrawer"
      ref={ref}
      style={{ top: Math.max(0, position) }}
    >
      <div className="tv-subdrawer-label">{group.label}</div>
      {group.subtools.map((tool) => (
        <button
          key={tool.id}
          className={`tv-subdrawer-btn ${selectedTool === tool.id ? "active" : ""}`}
          onClick={() => {
            onSelect(tool.id);
            onClose();
          }}
          title={tool.label}
        >
          <span className="tv-subdrawer-icon">{tool.icon}</span>
          <span className="tv-subdrawer-text">{tool.label}</span>
          {selectedTool === tool.id && (
            <span className="tv-subdrawer-check">✓</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Main Toolbar ──────────────────────────────────────────────────────────────
export default function TradingToolbar({ selectedTool, setSelectedTool }) {
  const [openDrawer, setOpenDrawer] = useState(null);
  const [drawerPos, setDrawerPos] = useState(0);
  // Track which tool is "primary" for each group (shown as the group icon)
  const [groupPrimary, setGroupPrimary] = useState(() => {
    const map = {};
    TOOL_GROUPS.forEach((g) => {
      if (!g.divider && g.subtools?.length > 0) {
        map[g.id] = g.subtools[0].id;
      }
    });
    return map;
  });
  const [toggleStates, setToggleStates] = useState({
    magnet: false,
    hide: false,
    lock: false,
  });

  const btnRefs = useRef({});
  const toolbarRef = useRef(null);

  // ── Keyboard shortcuts (TradingView-style) ────────────────────────────────
  useEffect(() => {
    function onKeyDown(e) {
      // Skip if typing in an input/textarea
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

      const key = e.key.toLowerCase();
      let toolId = null;

      if (key === "escape") {
        toolId = "cursor";
      } else if (e.altKey && !e.ctrlKey && !e.shiftKey) {
        const combo = "alt+" + key;
        toolId = TOOLBAR_SHORTCUTS[combo] || null;
      }

      if (!toolId) return;
      e.preventDefault();

      // Find the group this tool belongs to
      const group = TOOL_GROUPS.find(
        (g) => !g.divider && (g.id === toolId || g.subtools?.some((s) => s.id === toolId))
      );
      if (!group) return;

      // If shortcut maps to a subtool, set that subtool as primary
      if (group.id !== toolId) {
        setGroupPrimary((prev) => ({ ...prev, [group.id]: toolId }));
      }
      setSelectedTool(toolId === group.id && group.subtools?.length > 0
        ? (groupPrimary[group.id] || group.subtools[0].id)
        : toolId
      );
      setOpenDrawer(null);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setSelectedTool, groupPrimary]); // eslint-disable-line

  // Find which group a tool belongs to
  const findGroupForTool = useCallback((toolId) => {
    return TOOL_GROUPS.find(
      (g) => !g.divider && g.subtools?.some((st) => st.id === toolId)
    );
  }, []);

  // The icon to display for a group button (last selected sub-tool)
  const getGroupIcon = useCallback(
    (group) => {
      const primaryId = groupPrimary[group.id];
      if (primaryId) {
        const st = group.subtools.find((s) => s.id === primaryId);
        if (st) return st.icon;
      }
      return group.icon;
    },
    [groupPrimary]
  );

  // Is this group's tool currently active?
  const isGroupActive = useCallback(
    (group) => {
      if (group.toggle) return toggleStates[group.id];
      // For groups with no subtools (cursor), match group.id directly
      if (!group.subtools || group.subtools.length === 0) {
        return selectedTool === group.id;
      }
      const primaryId = groupPrimary[group.id] || group.subtools?.[0]?.id;
      return selectedTool === primaryId;
    },
    [selectedTool, groupPrimary, toggleStates]
  );

  const handleMainClick = useCallback(
    (group, e) => {
      if (group.divider) return;

      // Toggle tools
      if (group.toggle) {
        setToggleStates((prev) => ({ ...prev, [group.id]: !prev[group.id] }));
        setOpenDrawer(null);
        return;
      }

      // Action tools (no sub-drawer)
      if (group.action) {
        setOpenDrawer(null);
        return;
      }

      // Tools with no subtools (like cursor) — just select them directly
      if (group.subtools.length === 0) {
        setSelectedTool(group.id);
        setOpenDrawer(null);
        return;
      }

      // Open/close sub-drawer
      if (openDrawer === group.id) {
        setOpenDrawer(null);
        return;
      }

      // Selecting main button also activates the group's current primary tool
      const primaryToolId = groupPrimary[group.id] || group.subtools?.[0]?.id;
      if (primaryToolId) setSelectedTool(primaryToolId);

      // Compute vertical position for drawer
      const btn = btnRefs.current[group.id];
      const toolbar = toolbarRef.current;
      if (btn && toolbar) {
        const btnRect = btn.getBoundingClientRect();
        const tbRect = toolbar.getBoundingClientRect();
        setDrawerPos(btnRect.top - tbRect.top);
      }
      setOpenDrawer(group.id);
    },
    [openDrawer]
  );

  const handleChevronClick = useCallback(
    (group, e) => {
      e.stopPropagation();
      if (group.subtools.length === 0) return;
      if (openDrawer === group.id) {
        setOpenDrawer(null);
        return;
      }
      const btn = btnRefs.current[group.id];
      const toolbar = toolbarRef.current;
      if (btn && toolbar) {
        const btnRect = btn.getBoundingClientRect();
        const tbRect = toolbar.getBoundingClientRect();
        setDrawerPos(btnRect.top - tbRect.top);
      }
      setOpenDrawer(group.id);
    },
    [openDrawer]
  );

  const handleSubSelect = useCallback(
    (groupId, toolId) => {
      setGroupPrimary((prev) => ({ ...prev, [groupId]: toolId }));
      setSelectedTool(toolId);
    },
    [setSelectedTool]
  );

  // Sync: if selectedTool changes externally, update group primary
  useEffect(() => {
    const group = findGroupForTool(selectedTool);
    if (group) {
      setGroupPrimary((prev) => ({ ...prev, [group.id]: selectedTool }));
    }
  }, [selectedTool, findGroupForTool]);

  const activeGroup = openDrawer
    ? TOOL_GROUPS.find((g) => g.id === openDrawer)
    : null;

  return (
    <div className="tv-toolbar" ref={toolbarRef}>
      {TOOL_GROUPS.map((group) => {
        if (group.divider) {
          return <div key={group.id} className="tv-toolbar-divider" />;
        }

        const active = isGroupActive(group);
        const hasSubtools = group.subtools && group.subtools.length > 0;
        const drawerOpen = openDrawer === group.id;

        return (
          <div
            key={group.id}
            className={`tv-tool-wrap ${active ? "active" : ""} ${drawerOpen ? "drawer-open" : ""}`}
          >
            {/* Main button */}
            <button
              ref={(el) => (btnRefs.current[group.id] = el)}
              className={`tv-tool-btn ${active ? "active" : ""} ${group.danger ? "danger" : ""}`}
              onClick={(e) => handleMainClick(group, e)}
              title={group.label}
            >
              <span className="tv-tool-icon">{getGroupIcon(group)}</span>
            </button>

            {/* Chevron arrow for groups with subtools */}
            {hasSubtools && (
              <button
                className={`tv-chevron-btn ${drawerOpen ? "open" : ""}`}
                onClick={(e) => handleChevronClick(group, e)}
                title={`${group.label} options`}
              >
                {icons.chevronRight}
              </button>
            )}
          </div>
        );
      })}

      {/* Sub-drawer flyout */}
      {activeGroup && activeGroup.subtools.length > 0 && (
        <SubDrawer
          group={activeGroup}
          position={drawerPos}
          selectedTool={selectedTool}
          onSelect={(toolId) => handleSubSelect(activeGroup.id, toolId)}
          onClose={() => setOpenDrawer(null)}
        />
      )}
    </div>
  );
}