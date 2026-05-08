// useMarketStatus.js — returns live IST-based Indian market status
// Market hours: 9:15 AM – 3:30 PM IST, Mon–Fri
import { useState, useEffect } from "react";

function getMarketStatus() {
  const now = new Date();

  // Convert current time to IST (UTC+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000; // 5h 30m in ms
  const utc = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const ist = new Date(utc + istOffset);

  const day = ist.getDay(); // 0=Sun, 6=Sat
  const hours = ist.getHours();
  const minutes = ist.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  const marketOpen = 9 * 60 + 15;  // 9:15 AM = 555 mins
  const marketClose = 15 * 60 + 30; // 3:30 PM = 930 mins

  const isWeekday = day >= 1 && day <= 5;
  const isWithinHours = totalMinutes >= marketOpen && totalMinutes < marketClose;

  return isWeekday && isWithinHours ? "live" : "closed";
}

export function useMarketStatus() {
  const [status, setStatus] = useState(getMarketStatus);

  useEffect(() => {
    // Re-check every 30 seconds — lightweight, no network calls
    const interval = setInterval(() => {
      setStatus(getMarketStatus());
    }, 30_000);

    return () => clearInterval(interval);
  }, []);

  return status; // "live" | "closed"
}
