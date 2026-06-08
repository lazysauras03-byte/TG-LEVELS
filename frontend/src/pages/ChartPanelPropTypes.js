/**
 * ChartPanelPropTypes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PropTypes declaration for ChartPanel's 26 props.
 *
 * Kept in a separate file so ChartsPage.js doesn't grow further.
 * Import and attach in ChartsPage.js after the ChartPanel definition:
 *
 *   import { ChartPanelPropTypes } from "./ChartPanelPropTypes";
 *   ChartPanel.propTypes = ChartPanelPropTypes;        // after memo wrapping
 *
 * In development, React will log a console.error for any wrong prop type.
 * In production builds prop-types is stripped automatically (react-scripts
 * replaces it with an empty module via dead-code elimination).
 */
import PropTypes from "prop-types";

export const ChartPanelPropTypes = {
  // ── Panel identity ────────────────────────────────────────────────────────
  /** localStorage namespace prefix, e.g. "" for panel 0, "p2_" for panel 1 */
  pfx:         PropTypes.string.isRequired,
  /** Whether this panel shows the right-side indicator sidebar */
  showSidebar: PropTypes.bool.isRequired,
  /** 0-based index of this panel in the layout */
  panelIdx:    PropTypes.number.isRequired,
  /** Total number of panels in the current layout (1/2/3/4) */
  panelCount:  PropTypes.number.isRequired,

  // ── Layout ────────────────────────────────────────────────────────────────
  /** Current layout ID, e.g. "1" | "2h" | "2v" | "3" | "4". Only on primary panel. */
  layoutId:       PropTypes.string,
  /** Callback to change layout. Only on primary panel. */
  onLayoutChange: PropTypes.func,

  // ── URL params (panel 0 only; others receive null/undefined) ─────────────
  urlSymbol:     PropTypes.string,
  urlResolution: PropTypes.number,
  urlWaveTarget: PropTypes.object,
  urlFibDrawing: PropTypes.object,
  urlSrLines:    PropTypes.arrayOf(PropTypes.object),

  // ── Global toolbar state ──────────────────────────────────────────────────
  /** Drawing tool currently selected: "cursor" | "trendline" | "horizontal" | "fibRetracement" | "freehand" | "text" */
  selectedTool:    PropTypes.string.isRequired,
  setSelectedTool: PropTypes.func.isRequired,
  /** Active drawing colour key */
  drawColor:       PropTypes.string.isRequired,

  // ── Panel activation ──────────────────────────────────────────────────────
  isActivePanel:   PropTypes.bool.isRequired,
  onPanelActivate: PropTypes.func.isRequired,

  // ── Drawing action refs (stable React refs, not validated by PropTypes) ───
  panelActionsRef:    PropTypes.object,
  setActivePanelHidden: PropTypes.func,
  panelLinkRef:       PropTypes.object,
  setToolbarLinked:   PropTypes.func,

  // ── Synced crosshair ──────────────────────────────────────────────────────
  /** Price broadcast by whichever panel the mouse is on, or null */
  syncedCrosshairPrice:  PropTypes.number,
  /** Symbol that produced the synced price, or null */
  syncedCrosshairSymbol: PropTypes.string,
  /** Callback: (price: number|null, symbol: string) => void */
  onSyncCrosshair: PropTypes.func.isRequired,
};
