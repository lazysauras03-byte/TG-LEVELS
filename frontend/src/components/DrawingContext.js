// DrawingContext.js
// Symbol-based drawing sync between linked panels.
// Each panel can toggle "linked" ON/OFF.
// When ON, any drawing added/changed is mirrored to ALL other panels
// that share the same symbol AND also have linking ON.
// No more color groups — just a simple boolean link per panel.

import { createContext, useContext, useCallback, useRef, useState, useEffect } from "react";

// ─── Module-level registry (survives re-renders) ──────────────────────────────
// _panels: Map<panelId, { symbol: string, linked: boolean, notify: fn }>
const _panels = new Map();

// Broadcast drawings to all panels sharing the same symbol (except the sender)
function broadcastDrawings(senderId, symbol, drawings) {
  _panels.forEach((entry, id) => {
    if (id === senderId) return;
    if (!entry.linked) return;
    if (entry.symbol !== symbol) return;
    entry.notify([...drawings]);
  });
}

// ─── Context ──────────────────────────────────────────────────────────────────
const DrawingContext = createContext(null);

export function DrawingProvider({ children }) {
  return (
    <DrawingContext.Provider value={{}}>
      {children}
    </DrawingContext.Provider>
  );
}

export function useDrawingContext() {
  return useContext(DrawingContext);
}

// ─── Hook for a panel to participate in symbol-based link sync ────────────────
// panelId  : unique string e.g. "panel_0"
// symbol   : current symbol this panel is showing
// Returns  : { linked, setLinked, sharedDrawings, publishDrawings }
export function usePanelLink(panelId, symbol) {
  // Persist linked state per panel across reloads
  const storageKey = "tgg_linked_" + panelId;
  const [linked, setLinkedState] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey)) === true; } catch { return false; }
  });
  // sharedDrawings — last set received from another panel; stable array (never null)
  const [sharedDrawings, setSharedDrawings] = useState([]);
  const linkedRef = useRef(linked);
  const symbolRef = useRef(symbol);

  // Keep refs in sync
  useEffect(() => { symbolRef.current = symbol; }, [symbol]);
  useEffect(() => { linkedRef.current = linked; }, [linked]);

  // Register / update this panel in the global registry
  useEffect(() => {
    _panels.set(panelId, {
      symbol,
      linked,
      notify: (drawings) => setSharedDrawings(drawings),
    });
    return () => { _panels.delete(panelId); };
  }, [panelId, symbol, linked]);

  // When we unlink, clear shared drawings so they don't linger on screen
  useEffect(() => {
    if (!linked) setSharedDrawings([]);
  }, [linked]);

  // Toggle linked state
  const setLinked = useCallback((val) => {
    setLinkedState(val);
    linkedRef.current = val;
    // Persist across reloads
    try { localStorage.setItem(storageKey, JSON.stringify(val)); } catch { }
    // Update registry immediately so next broadcast sees the new value
    const existing = _panels.get(panelId);
    if (existing) _panels.set(panelId, { ...existing, linked: val });
  }, [panelId, storageKey]);

  // Call when local drawings change — broadcasts to matching symbol panels
  const publishDrawings = useCallback((drawings) => {
    if (!linkedRef.current) return;
    broadcastDrawings(panelId, symbolRef.current, drawings);
  }, [panelId]);

  return { linked, setLinked, sharedDrawings, publishDrawings };
}