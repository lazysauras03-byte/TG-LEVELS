import React from "react";
import { useNavigate } from "react-router-dom";
import "./ReportsPage.css";

const PLACEHOLDER_SECTIONS = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="12" y1="20" x2="12" y2="10" />
        <line x1="18" y1="20" x2="18" y2="4" />
        <line x1="6" y1="20" x2="6" y2="16" />
      </svg>
    ),
    title: "P&L Summary",
    desc: "Cumulative profit/loss across all signals",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    title: "Signal History",
    desc: "Full log of NH, NL, and BC signals over time",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
    title: "Accuracy Metrics",
    desc: "Win rate, precision and recall per signal type",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
    title: "Drawdown Analysis",
    desc: "Max drawdown, recovery time and risk metrics",
  },
];

export default function ReportsPage() {
  const navigate = useNavigate();

  return (
    <div className="reports-page">
      {/* Top bar */}
      <div className="reports-topbar">
        <button className="reports-back" onClick={() => navigate("/")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Home
        </button>
        <span className="reports-topbar-title">
          <span className="reports-topbar-logo">◈</span> Reports
        </span>
        <span className="reports-coming-badge">Coming Soon</span>
      </div>

      <main className="reports-main">
        <div className="reports-hero">
          <div className="reports-hero-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </div>
          <h1 className="reports-title">Reports</h1>
          <p className="reports-subtitle">
            Advanced analytics and performance reporting is under development.<br />
            Below is a preview of what's coming.
          </p>
        </div>

        <div className="reports-grid">
          {PLACEHOLDER_SECTIONS.map((sec) => (
            <div key={sec.title} className="reports-card">
              <div className="reports-card-icon">{sec.icon}</div>
              <div>
                <h3 className="reports-card-title">{sec.title}</h3>
                <p className="reports-card-desc">{sec.desc}</p>
              </div>
              <div className="reports-card-placeholder">
                <div className="reports-bar-row">
                  {[60, 85, 40, 72, 55, 90, 48].map((h, i) => (
                    <div
                      key={i}
                      className="reports-bar"
                      style={{ height: `${h}%`, animationDelay: `${i * 0.08}s` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
