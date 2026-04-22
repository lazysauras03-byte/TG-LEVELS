// // hooks/useChartData.js
// import { useState, useEffect, useCallback, useRef } from "react";
// import { fetchChartData } from "../utils/api";

// export function useChartData(symbol, resolution, timeframe, date) {
//   const [data, setData] = useState(null);
//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState(null);
//   const abortRef = useRef(null);

//   const load = useCallback(async () => {
//     if (!symbol) return;
//     if (abortRef.current) abortRef.current.abort();
//     abortRef.current = new AbortController();
//     setLoading(true);
//     setError(null);
//     try {
//       const result = await fetchChartData(symbol, resolution, timeframe, date);
//       setData(result);
//     } catch (err) {
//       if (err.name !== "AbortError") setError(err.message);
//     } finally {
//       setLoading(false);
//     }
//   }, [symbol, resolution, timeframe, date]);

//   useEffect(() => { load(); }, [load]);

//   return { data, loading, error, reload: load };
// }


// hooks/useChartData.js

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchChartData, fetchChartRangeData } from "../utils/api";

/**
 * Unified chart data hook.
 *
 * Mode 1 — single date:   pass date, leave fromDate/toDate null
 * Mode 2 — date range:    pass fromDate + toDate, leave date null
 *
 * When both fromDate and toDate are provided the hook uses /api/chart-range.
 * Otherwise it falls back to /api/chart with the single date.
 */
export function useChartData(symbol, resolution, timeframe, date, fromDate, toDate) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const isRangeMode = !!(fromDate && toDate);

  const load = useCallback(async () => {
    if (!symbol) return;
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);
    try {
      let result;
      if (isRangeMode) {
        result = await fetchChartRangeData(symbol, resolution, fromDate, toDate);
      } else {
        result = await fetchChartData(symbol, resolution, timeframe, date);
      }
      setData(result);
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [symbol, resolution, timeframe, date, fromDate, toDate, isRangeMode]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
}
