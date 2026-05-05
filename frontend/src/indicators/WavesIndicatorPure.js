/**
 * WavesIndicatorPure.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure (DOM-free) version of the wave pivot calculation logic.
 * Mirrors WavesIndicator.js bar-by-bar logic exactly, but returns the
 * enrichedPivots array instead of drawing anything on a chart.
 *
 * Used by ReportsPage to compute wave data from raw candle data.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Re-export from WavesIndicator so both import paths work:
//   import { updateWavesIndicatorPure } from '../indicators/WavesIndicatorPure'  ← ReportsPage
//   import { ... } from '../indicators/WavesIndicator'                           ← CandleChart
export { updateWavesIndicatorPure } from "./WavesIndicator";
