import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import "./HomePage.css";

const NAV_ITEMS = [
  {
    id: "charts",
    path: "/charts",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    label: "Charts",
    description: "Live candlestick charts with EMA indicators and signal overlays",
    tag: "LIVE",
    tagColor: "green",
    stats: ["NH / NL signals", "Indicators"],
  },
  {
    id: "reports",
    path: "/reports",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
    label: "Reports",
    description: "Performance analytics, Trade statistics",
    tag: "SOON",
    tagColor: "yellow",
    stats: ["Signal accuracy", "Drawdown stats"],
  },
];

export default function HomePage() {
  const navigate = useNavigate();
  const cardRefs = useRef([]);

  useEffect(() => {
    // Staggered entrance
    cardRefs.current.forEach((el, i) => {
      if (!el) return;
      el.style.opacity = "0";
      el.style.transform = "translateY(28px)";
      setTimeout(() => {
        el.style.transition = "opacity 0.5s ease, transform 0.5s ease";
        el.style.opacity = "1";
        el.style.transform = "translateY(0)";
      }, 120 + i * 100);
    });
  }, []);

  return (
    <div className="home-page">
      {/* Background grid */}
      <div className="home-grid-bg" aria-hidden="true" />

      {/* Header */}
      <header className="home-header">
        <div className="home-logo">
          <span className="home-logo-mark">◈</span>
          <span className="home-logo-text">TG</span>
          <span className="home-logo-version">DASHBOARD</span>
        </div>
        <div className="home-header-tag">
          <span className="home-dot green" /> Live
        </div>
      </header>

      {/* Hero */}
      <main className="home-main">
        <div className="home-hero">
          <p className="home-eyebrow">Trading Signal Platform</p>
          <h1 className="home-title">
            TG.<br />
            <span className="home-title-accent">LEVELS.</span>
          </h1>
          <p className="home-subtitle">
            Real-time market signals
          </p>
        </div>

        {/* Nav cards */}
        <div className="home-cards">
          {NAV_ITEMS.map((item, i) => (
            <button
              key={item.id}
              className={`home-card home-card--${item.tagColor}`}
              onClick={() => navigate(item.path)}
              ref={(el) => (cardRefs.current[i] = el)}
            >
              <div className="home-card-top">
                <div className="home-card-icon">{item.icon}</div>
                <span className={`home-card-tag home-card-tag--${item.tagColor}`}>
                  {item.tag}
                </span>
              </div>

              <div className="home-card-body">
                <h2 className="home-card-label">{item.label}</h2>
                <p className="home-card-desc">{item.description}</p>
              </div>

              <div className="home-card-stats">
                {item.stats.map((s) => (
                  <span key={s} className="home-card-stat">
                    <span className="home-card-stat-dot" />
                    {s}
                  </span>
                ))}
              </div>

              <div className="home-card-arrow">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="home-footer">
        <span className="home-footer-text">Fyers · NSE/BSE · IST</span>
        <span className="home-footer-sep">·</span>
        <span className="home-footer-text">LAZYSARURAS</span>
        <span className="home-footer-sep">·</span>
        <span className="home-footer-text">NH / NL / BC Logic</span>
      </footer>
    </div>
  );
}
