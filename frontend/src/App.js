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
import "./App.css";

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
          <Route path="/" element={<HomePage />} />
          <Route path="/charts" element={<ChartsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/fib-dashboard" element={<FibDashboardPage />} />
          <Route path="/scanner" element={<ScannerPage />} />
          <Route path="/strategies" element={<StrategiesPage />} />
          <Route path="/strategies/:id" element={<StrategiesPage />} />
          <Route path="/backtest" element={<BacktestPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeContext.Provider>
  );
}