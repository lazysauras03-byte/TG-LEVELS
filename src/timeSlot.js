/**
 * timeSlot.js
 * Classifies a trade's entry time into one of four intraday sessions.
 */

const moment = require("moment");

const TIME_SLOTS = [
  { label: "9:15–10:30",  start: "09:15", end: "10:30" },
  { label: "10:30–12:00", start: "10:30", end: "12:00" },
  { label: "12:00–1:30",  start: "12:00", end: "13:30" },
  { label: "1:30–3:30",   start: "13:30", end: "15:30" },
];

/**
 * Given a moment object or time string, return the slot label.
 * Returns "Unknown" if outside market hours.
 */
function getTimeSlot(entryTimeMoment) {
  if (!entryTimeMoment) return "Unknown";

  const m = moment.isMoment(entryTimeMoment)
    ? entryTimeMoment
    : moment(entryTimeMoment);

  // Extract just HH:mm for comparison
  const hhmm = m.format("HH:mm");

  for (const slot of TIME_SLOTS) {
    if (hhmm >= slot.start && hhmm < slot.end) {
      return slot.label;
    }
  }

  return "Unknown";
}

/**
 * Returns all slot labels in order (useful for chart axis ordering).
 */
function getSlotOrder() {
  return TIME_SLOTS.map((s) => s.label);
}

/**
 * Maps a time to a candle slot identifier (for grouping).
 * Returns 0-3 for the four slots, or -1 for unknown.
 */
function getCandleSlot(entryTimeMoment) {
  if (!entryTimeMoment) return -1;

  const m = moment.isMoment(entryTimeMoment)
    ? entryTimeMoment
    : moment(entryTimeMoment);

  const hhmm = m.format("HH:mm");

  for (let i = 0; i < TIME_SLOTS.length; i++) {
    const slot = TIME_SLOTS[i];
    if (hhmm >= slot.start && hhmm < slot.end) {
      return i;
    }
  }

  return -1;
}

module.exports = { getTimeSlot, getSlotOrder, getCandleSlot, TIME_SLOTS };
