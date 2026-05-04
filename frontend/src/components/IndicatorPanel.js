// IndicatorPanel.js
import React, { useState } from "react";
import { INDICATOR_REGISTRY } from "../indicators/indicatorRegistry";
import "./IndicatorPanel.css";

/**
 * IndicatorPanel
 *
 * Reads INDICATOR_REGISTRY for the list of indicators.
 * Adding a new indicator = only edit indicatorRegistry.js.
 * No changes needed here.
 *
 * Props:
 *   indicators  — { [id]: boolean }   current enabled/disabled state
 *   onChange    — (id, enabled) => void
 */
export default function IndicatorPanel({ indicators, onChange }) {
  const [open, setOpen] = useState(false);

  const enabledCount = Object.values(indicators).filter(Boolean).length;

  return (
    <div className="ind-panel">

      {/* Trigger button */}
      <button
        className={`ind-trigger ${open ? "ind-trigger--open" : ""}`}
        onClick={() => setOpen((p) => !p)}
        title="Indicators"
      >
        <svg
          className="ind-trigger-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="14" y2="18" />
        </svg>
        <span className="ind-trigger-label">Indicators</span>
        {enabledCount > 0 && (
          <span className="ind-trigger-badge">{enabledCount}</span>
        )}
        <svg
          className={`ind-trigger-caret ${open ? "ind-trigger-caret--open" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="ind-dropdown">
          <div className="ind-dropdown-header">
            <span className="ind-dropdown-title">Indicators</span>
            <span className="ind-dropdown-count">
              {enabledCount} / {INDICATOR_REGISTRY.length} active
            </span>
          </div>

          <div className="ind-list">
            {INDICATOR_REGISTRY.map((ind) => {
              const enabled = !!indicators[ind.id];
              return (
                <label
                  key={ind.id}
                  className={`ind-row ${enabled ? "ind-row--on" : ""}`}
                >
                  <span className="ind-row-left">
                    <span
                      className="ind-color-dot"
                      style={{ background: ind.color, opacity: enabled ? 1 : 0.3 }}
                    />
                    <span className="ind-row-info">
                      <span className="ind-row-label">{ind.label}</span>
                      <span className="ind-row-desc">{ind.desc}</span>
                    </span>
                  </span>
                  <span
                    className={`ind-toggle ${enabled ? "ind-toggle--on" : ""}`}
                    role="switch"
                    aria-checked={enabled}
                    onClick={() => onChange(ind.id, !enabled)}
                  >
                    <span className="ind-toggle-thumb" />
                  </span>
                </label>
              );
            })}
          </div>

          <div className="ind-dropdown-footer">
            Right-click on chart to reset view
          </div>
        </div>
      )}
    </div>
  );
}