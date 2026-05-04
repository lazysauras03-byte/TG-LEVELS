/**
 * indicators.js — Indicator Registry
 *
 * This is the SINGLE place to register indicators.
 * To add a new indicator later, just add an entry here.
 *
 * Each entry:
 *   id       — unique key, used in state & storage
 *   label    — display name shown in the panel
 *   desc     — short description shown in tooltip
 *   color    — badge/dot color
 *   default  — whether it starts enabled
 */

export const INDICATOR_REGISTRY = [
  {
    id: "bubble",
    label: "Bubble Indicator",
    desc: "NH / NL / BC High / BC Low signal markers on chart bars",
    color: "#ffc135",
    default: true,
  },
  // ── Add future indicators below ────────────────────────
  // {
  //   id: "ema",
  //   label: "EMA Ribbon",
  //   desc: "Exponential moving average ribbon overlay",
  //   color: "#3d84ff",
  //   default: false,
  // },
  // {
  //   id: "rsi",
  //   label: "RSI",
  //   desc: "Relative Strength Index panel below chart",
  //   color: "#7c5cfc",
  //   default: false,
  // },
];

/**
 * Build a default indicators state object from the registry.
 * Shape: { bubble: true, ema: false, ... }
 */
export function buildDefaultIndicators() {
  return Object.fromEntries(
    INDICATOR_REGISTRY.map((ind) => [ind.id, ind.default])
  );
}
