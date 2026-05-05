/**
 * indicatorRegistry.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for ALL indicators in the app.
 *
 * To add a new indicator in future:
 *   1. Add an entry to INDICATOR_REGISTRY
 *   2. Add its default state to buildDefaultIndicators()
 *   That's it — IndicatorPanel renders it automatically.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const INDICATOR_REGISTRY = [
  {
    id: "bubble",
    label: "Bubble",
    color: "#3d84ff",
  },
  {
    id: "waves",
    label: "Waves",
    color: "#f5a623",
  },
];

/**
 * Returns the default indicators state object.
 * Used when nothing is stored in localStorage yet.
 */
export function buildDefaultIndicators() {
  return {
    bubble: true,
    waves: false,
  };
}