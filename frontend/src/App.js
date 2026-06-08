// App.js
import React, { useState, useEffect, createContext, useContext } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import ChartsPage from "./pages/ChartsPage";
import ReportsPage from "./pages/ReportsPage";
import FibDashboardPage from "./pages/FibDashboardPage";
import ScannerPage from "./pages/ScannerPage";
import StrategiesPage from "./pages/StrategiesPage";
import BacktestPage from "./pages/BacktestPage";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles/App.css";

// ─── Theme context shared across all pages ────────────────────────
export const ThemeContext = createContext({ theme: "dark", toggleTheme: () => { } });
export function useTheme() { return useContext(ThemeContext); }

export default function App() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("tgg_theme") || "dark"; } catch { return "dark"; }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("tgg_theme", theme); } catch { }
  }, [theme]);

  function toggleTheme() {
    setTheme(t => t === "dark" ? "light" : "dark");
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ErrorBoundary label="Home"><HomePage /></ErrorBoundary>} />
          <Route path="/charts" element={<ErrorBoundary label="Charts"><ChartsPage /></ErrorBoundary>} />
          <Route path="/reports" element={<ErrorBoundary label="Reports"><ReportsPage /></ErrorBoundary>} />
          <Route path="/fib-dashboard" element={<ErrorBoundary label="Fib Dashboard"><FibDashboardPage /></ErrorBoundary>} />
          <Route path="/scanner" element={<ErrorBoundary label="Scanner"><ScannerPage /></ErrorBoundary>} />
          <Route path="/strategies" element={<ErrorBoundary label="Strategies"><StrategiesPage /></ErrorBoundary>} />
          <Route path="/strategies/:id" element={<ErrorBoundary label="Strategies"><StrategiesPage /></ErrorBoundary>} />
          <Route path="/backtest" element={<ErrorBoundary label="Backtest"><BacktestPage /></ErrorBoundary>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeContext.Provider>
  );
}