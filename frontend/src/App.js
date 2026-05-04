// App.js
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import ChartsPage from "./pages/ChartsPage";
import ReportsPage from "./pages/ReportsPage";
import "./App.css";

/**
 * App — routing root
 *
 * Routes:
 *   /          → HomePage    (new landing page)
 *   /charts    → ChartsPage  (existing chart app, wrapped)
 *   /reports   → ReportsPage (placeholder)
 *   *          → redirect to /
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/charts" element={<ChartsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
