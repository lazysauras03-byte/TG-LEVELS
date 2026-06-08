/**
 * prefs.js
 * ─────────────────────────────────────────────────────────────────────────────
 * localStorage helpers — previously defined inline inside ChartsPage.js.
 * Extracted here so any page can use persistence without importing from a page.
 *
 * All keys are prefixed with "tgg_" in the callers (e.g. "tgg_symbol").
 */

/**
 * Load a JSON-serialised value from localStorage.
 * Returns `fallback` if the key is absent or the value can't be parsed.
 * @param {string} key
 * @param {*} fallback
 * @returns {*}
 */
export function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem("tgg_" + key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Save a value to localStorage as JSON.
 * Silently swallows QuotaExceededError and other storage errors.
 * @param {string} key
 * @param {*} value
 */
export function savePref(key, value) {
  try {
    localStorage.setItem("tgg_" + key, JSON.stringify(value));
  } catch { }
}
