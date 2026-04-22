// App.js
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ChartPage from "./pages/ChartPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/chart/:symbol" element={<ChartPage />} />
        <Route path="/chart" element={<ChartPage />} />
        <Route path="/" element={<Navigate to="/chart" replace />} />
        <Route path="*" element={<Navigate to="/chart" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
