// DrawingContext.js
// Module-level store for shared drawings between linked panels.
// Panels with the same linkColor share drawings in real-time.
// linkColor: null = unlinked (private drawings only)
// linkColor: "yellow"|"blue"|"green"|"red" = shared group

import { createContext, useContext, useCallback, useRef, useState, useEffect } from "react";

// ─── Module-level shared store (survives re-renders) ──────────────────────────
const _groupDrawings = {}; // { [linkColor]: drawing[] }
const _groupSubscribers = {}; // { [linkColor]: Set<fn> }

function getGroupDrawings(linkColor) {
  if (!linkColor) return [];
  return _groupDrawings[linkColor] || [];
}

function setGroupDrawings(linkColor, drawings) {
  if (!linkColor) return;
  _groupDrawings[linkColor] = drawings;
  // Notify all subscribers in this group
  const subs = _groupSubscribers[linkColor];
  if (subs) subs.forEach((fn) => fn(drawings));
}

function subscribeGroup(linkColor, fn) {
  if (!linkColor) return () => { };
  if (!_groupSubscribers[linkColor]) _groupSubscribers[linkColor] = new Set();
  _groupSubscribers[linkColor].add(fn);
  return () => _groupSubscribers[linkColor]?.delete(fn);
}

// ─── Context ──────────────────────────────────────────────────────────────────
const DrawingContext = createContext(null);

export function DrawingProvider({ children }) {
  // Panel link colors — panels register/update via usePanelLink
  return (
    <DrawingContext.Provider value={{ getGroupDrawings, setGroupDrawings, subscribeGroup }}>
      {children}
    </DrawingContext.Provider>
  );
}

export function useDrawingContext() {
  return useContext(DrawingContext);
}

// ─── Hook for a panel to participate in link sync ─────────────────────────────
// Returns { linkColor, setLinkColor, sharedDrawings, publishDrawings }
export function usePanelLink(panelId) {
  const [linkColor, setLinkColor] = useState(null);
  const linkColorRef = useRef(null);
  const [sharedDrawings, setSharedDrawings] = useState([]);

  // Keep ref in sync for use inside closures
  useEffect(() => {
    linkColorRef.current = linkColor;
  }, [linkColor]);

  // Subscribe/unsubscribe when linkColor changes
  useEffect(() => {
    if (!linkColor) {
      setSharedDrawings([]);
      return;
    }
    // On subscribe, immediately load existing shared drawings
    setSharedDrawings(getGroupDrawings(linkColor));
    const unsub = subscribeGroup(linkColor, (drawings) => {
      setSharedDrawings([...drawings]);
    });
    return unsub;
  }, [linkColor]);

  // publishDrawings — called by DrawingOverlay when local drawings change
  const publishDrawings = useCallback((drawings, linkedOnly) => {
    const lc = linkColorRef.current;
    if (!lc) return; // not linked — nothing to broadcast
    // Only publish drawings flagged as linked (or all if linkedOnly=false)
    const toShare = linkedOnly
      ? drawings.filter((d) => d.linked)
      : drawings;
    setGroupDrawings(lc, toShare);
  }, []);

  return { linkColor, setLinkColor, sharedDrawings, publishDrawings };
}

// ─── Link color palette (matches TradingView dots) ───────────────────────────
export const LINK_COLORS = [
  { id: "yellow", label: "Yellow", hex: "#f5c518", dim: "rgba(245,197,24,0.18)" },
  { id: "blue", label: "Blue", hex: "#2d7ef5", dim: "rgba(45,126,245,0.18)" },
  { id: "green", label: "Green", hex: "#26a69a", dim: "rgba(38,166,154,0.18)" },
  { id: "red", label: "Red", hex: "#ef5350", dim: "rgba(239,83,80,0.18)" },
];