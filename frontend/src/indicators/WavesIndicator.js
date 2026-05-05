/**
 * WavesIndicator.js
 */

const MAX_WAVES = 50;

function calcEMA(prices, period) {
  const k = 2 / (period + 1);
  const result = new Array(prices.length).fill(null);
  let ema = null;
  for (let i = 0; i < prices.length; i++) {
    const p = prices[i];
    if (p == null || isNaN(p)) continue;
    ema = ema === null ? p : p * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

export function updateWavesIndicatorPure(candles, emaHighs, emaLows) {
  if (!candles?.length) return [];

  const eH =
    emaHighs?.length === candles.length
      ? emaHighs
      : calcEMA(candles.map((c) => c.high), 9);
  const eL =
    emaLows?.length === candles.length
      ? emaLows
      : calcEMA(candles.map((c) => c.low), 9);

  let state = 0;
  let bestPrice = null;
  let bestBar = null;
  let legTouchedEMA = false;

  let lastPrice = null;
  let lastBar = null;

  let prevHigh = null;
  let prevLow = null;
  let prevWaveType = "";
  let currWaveType = "";

  const pivots = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const emaH = eH[i];
    const emaL = eL[i];
    if (emaH == null || emaL == null) continue;

    const isGreen = c.close > c.open;
    const isRed = c.close < c.open;

    // Match Pine Script exactly:
    // hhTouch = (isGreen and close > ema9High) or (isRed and open > ema9High)
    // llTouch = (isGreen and open < ema9Low)  or (isRed and close < ema9Low)
    const touchHigh = (isGreen && c.close > emaH) || (isRed && c.open > emaH);
    const touchLow = (isGreen && c.open < emaL) || (isRed && c.close < emaL);

    if (state === 0) {
      if (touchHigh) {
        state = 1;
        bestPrice = c.high;
        bestBar = i;
        legTouchedEMA = true;
      } else if (touchLow) {
        state = -1;
        bestPrice = c.low;
        bestBar = i;
        legTouchedEMA = true;
      }
      continue;
    }

    if (state === 1) {
      if (bestPrice === null || c.high > bestPrice) {
        bestPrice = c.high;
        bestBar = i;
      }
      if (touchHigh) legTouchedEMA = true;

      if (touchLow && legTouchedEMA) {
        const lockPrice = bestPrice;
        const lockBar = bestBar;

        currWaveType = prevHigh === null ? "HH" : lockPrice > prevHigh ? "HH" : "LH";
        prevHigh = lockPrice;

        pivots.push({ barIndex: lockBar, price: lockPrice, side: "high", waveType: currWaveType });

        prevWaveType = currWaveType; // eslint-disable-line no-unused-vars
        lastPrice = lockPrice;
        lastBar = lockBar;

        state = -1;
        bestPrice = c.low;
        bestBar = i;
        legTouchedEMA = touchLow;   // Pine: legTouchedEMA := llTouch
      }
      continue;
    }

    if (state === -1) {
      if (bestPrice === null || c.low < bestPrice) {
        bestPrice = c.low;
        bestBar = i;
      }
      if (touchLow) legTouchedEMA = true;

      if (touchHigh && legTouchedEMA) {
        const lockPrice = bestPrice;
        const lockBar = bestBar;

        currWaveType = prevLow === null ? "LL" : lockPrice < prevLow ? "LL" : "HL";
        prevLow = lockPrice;

        pivots.push({ barIndex: lockBar, price: lockPrice, side: "low", waveType: currWaveType });

        prevWaveType = currWaveType; // eslint-disable-line no-unused-vars
        lastPrice = lockPrice;
        lastBar = lockBar;

        state = 1;
        bestPrice = c.high;
        bestBar = i;
        legTouchedEMA = touchHigh;  // Pine: legTouchedEMA := hhTouch
      }
      continue;
    }
  }

  const trimmed = pivots.slice(-MAX_WAVES);
  const total = trimmed.length;
  return trimmed.map((piv, i) => ({
    ...piv,
    waveNum: -(total - i),
    time: candles[piv.barIndex].time,
  }));
}

// ─── Chart overlay ────────────────────────────────────────────────────────────

let _chart = null;
let _container = null;
let _onWaveData = null;
let _lines = [];
let _labels = [];

export function createWavesIndicator(chart, container, onWaveData) {
  _chart = chart;
  _container = container;
  _onWaveData = onWaveData ?? null;
  _lines = [];
  _labels = [];
}

export function updateWavesIndicator(candles, emaHighs, emaLows) {
  if (!_chart || !candles?.length) return;

  _clearOverlay();

  const pivots = updateWavesIndicatorPure(candles, emaHighs, emaLows);
  if (!pivots.length) {
    if (_onWaveData) _onWaveData([], []);
    return;
  }

  const segments = [];
  for (let i = 1; i < pivots.length; i++) {
    segments.push({ from: pivots[i - 1], to: pivots[i] });
  }

  segments.forEach(({ from, to }) => {
    try {
      const color = to.side === "high"
        ? "rgba(0,217,126,0.85)"
        : "rgba(255,69,96,0.85)";

      const lineSeries = _chart.addLineSeries({
        color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

      lineSeries.setData([
        { time: Math.floor(from.time / 1000), value: from.price },
        { time: Math.floor(to.time / 1000), value: to.price },
      ]);

      _lines.push(lineSeries);
    } catch (_) { }
  });

  if (_container) {
    pivots.forEach((piv) => {
      const label = document.createElement("div");
      // Display: WaveType + Wave Number (e.g., "HH(-1)", "LL(-2)", etc.)
      label.textContent = `${piv.waveType}(${piv.waveNum})`;
      label.style.cssText = [
        "position:absolute",
        "font-size:11px",
        "font-weight:700",
        "pointer-events:none",
        "white-space:nowrap",
        `color:${piv.side === "high" ? "#00d97e" : "#ff4560"}`,
        "background:rgba(0,0,0,0.75)",
        "padding:2px 6px",
        "border-radius:4px",
        "z-index:10",
        "letter-spacing:0.5px",
      ].join(";");

      try {
        const unixSec = Math.floor(piv.time / 1000);
        const x = _chart.timeScale().timeToCoordinate(unixSec);
        const y = _chart.priceScale("right").priceToCoordinate(piv.price);

        if (x != null && y != null) {
          label.style.left = `${x + 4}px`;
          label.style.top = `${piv.side === "high" ? y - 20 : y + 6}px`;
          _container.appendChild(label);
          _labels.push(label);
        }
      } catch (_) { }
    });
  }

  if (_onWaveData) _onWaveData(pivots, segments);
}

/**
 * removeWavesIndicator — clears overlay drawings but keeps _chart reference
 * so waves can be re-enabled without needing createWavesIndicator again.
 * Pass `fullTeardown = true` only when the chart itself is being destroyed.
 */
export function removeWavesIndicator(fullTeardown = false) {
  _clearOverlay();
  if (fullTeardown) {
    _chart = null;
    _container = null;
    _onWaveData = null;
  }
  // When fullTeardown is false (user toggled waves OFF), keep _chart/_container
  // so updateWavesIndicator works again when user toggles back ON.
  if (_onWaveData) _onWaveData([], []);
}

function _clearOverlay() {
  if (_chart) {
    _lines.forEach((series) => {
      try { _chart.removeSeries(series); } catch (_) { }
    });
  }
  _lines = [];

  _labels.forEach((el) => {
    try { el.parentNode?.removeChild(el); } catch (_) { }
  });
  _labels = [];
}
