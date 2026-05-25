// useMarketStatus.js — returns live IST-based Indian market status
// NSE/BSE hours : 9:15 AM – 3:30 PM IST, Mon–Fri
// MCX hours     : 9:00 AM – 11:30 PM IST, Mon–Fri  (23:30 IST)
import { useState, useEffect } from "react";

/** Returns true if this symbol belongs to MCX (commodity exchange). */
function isMCXSymbol(symbol) {
  if (!symbol) return false;
  return String(symbol).toUpperCase().startsWith("MCX:");
}

function getMarketStatus(symbol) {
  const now = new Date();

  // Convert current time to IST (UTC+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const utc = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const ist = new Date(utc + istOffset);

  const day = ist.getDay(); // 0=Sun, 6=Sat
  const hours = ist.getHours();
  const minutes = ist.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  const marketOpen = 9 * 60 + 15;   // 9:15 AM  = 555 mins
  const nseClose = 15 * 60 + 30;  // 3:30 PM  = 930 mins
  const mcxClose = 23 * 60 + 30;  // 11:30 PM = 1410 mins

  const isWeekday = day >= 1 && day <= 5;
  const closeMin = isMCXSymbol(symbol) ? mcxClose : nseClose;
  const isWithinHours = totalMinutes >= marketOpen && totalMinutes < closeMin;

  return isWeekday && isWithinHours ? "live" : "closed";
}

/**
 * useMarketStatus(symbol)
 * Returns "live" | "closed" based on the active symbol's exchange hours.
 * Pass the current symbol so MCX commodities stay "live" until 23:30 IST.
 */
export function useMarketStatus(symbol) {
  const [status, setStatus] = useState(() => getMarketStatus(symbol));

  useEffect(() => {
    // Re-check immediately when symbol changes (e.g. switching NSE → MCX)
    setStatus(getMarketStatus(symbol));

    // Re-check every 30 seconds — lightweight, no network calls
    const interval = setInterval(() => {
      setStatus(getMarketStatus(symbol));
    }, 30_000);

    return () => clearInterval(interval);
  }, [symbol]);

  return status; // "live" | "closed"
}