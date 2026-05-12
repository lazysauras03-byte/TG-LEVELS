// App.js
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import ChartsPage from "./pages/ChartsPage";
import ReportsPage from "./pages/ReportsPage";
import FibDashboardPage from "./pages/FibDashboardPage";
import "./App.css";

/**
 * App — routing root
 *
 * Routes:
 *   /              → HomePage
 *   /charts        → ChartsPage
 *   /reports       → ReportsPage
 *   /fib-dashboard → FibDashboardPage
 *   *              → redirect to /
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/charts" element={<ChartsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/fib-dashboard" element={<FibDashboardPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}