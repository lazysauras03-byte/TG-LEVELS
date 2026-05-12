import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useMarketStatus } from "../hooks/useMarketStatus";
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
    tagColor: "green",
    stats: ["NH / NL signals", "Indicators"],
    dynamic: true, // market-status driven
  },
  {
    id: "fib-dashboard",
    path: "/fib-dashboard",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="12" y1="2" x2="12" y2="22" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
    label: "Fib Dashboard",
    description: "Wave · Fib · Entry — multi-timeframe Fibonacci analysis",
    tagColor: "blue",
    stats: ["Motherwave detection", "Fib levels", "Entry signals"],
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
    tagColor: "yellow",
    stats: ["Signal accuracy", "Drawdown stats"],
  },
];

export default function HomePage() {
  const navigate = useNavigate();
  const cardRefs = useRef([]);
  const marketStatus = useMarketStatus();
  const isLive = marketStatus === "live";

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
          <img src="/tg-icon.png" alt="TG Levels" className="home-logo-img" />
          <h1> Dashboard </h1>
        </div>
        <div className="home-header-tag">
          <span className={`home-dot ${isLive ? "green" : "red"}`} />
          {isLive ? "Market Live" : "Market Closed"}
        </div>
      </header>

      {/* Hero */}
      <main className="home-main">

        <div className="home-hero">
          <img src="/tg-icon.png" alt="TG" className="home-hero-icon" />
          <div className="home-hero-text">
            <p className="home-subtitle">Tushar Ghone SEBI Registered Research Analyst</p>
            <div className="home-hero-inner">
              <p className="home-welcome">Welcome to</p>
            </div>
            <center><h1 className="home-title"><span className="home-title-accent"> TG Levels</span></h1></center>
          </div>
          <p className="home-subtitle">Real-time market analysis</p>
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
                  {item.dynamic ? (isLive ? "Market Live" : "Market Closed") : item.tag}
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
      </main >

      {/* Footer */}
      < footer className="home-footer" >
        <span className="home-footer-text">Real-time stock insights at your fingertips</span>
      </footer >
    </div >
  );
}