/**
 * detectMotherWave.js
 * ─────────────────────────────────────────────────────────────────
 * Shared Mother Wave detection utility for all frontend pages.
 * Single source of truth — ReportsPage, FibDashboardPage, ScannerPage
 * all import from here. Never duplicate this logic in individual pages.
 *
 * ── ALGORITHM (exact sequential walk) ────────────────────────────
 *
 *   waves = all wave rows sorted chronologically (oldest first)
 *   i = 0
 *
 *   while i < waves.length:
 *     candidate = waves[i]
 *     nextWave  = waves[i + 1]   ← IMMEDIATELY next wave in time
 *
 *     if no nextWave → candidate is MW (nothing challenged it)
 *
 *     RATIO CHECK:
 *       candidate.delta / nextWave.delta >= 2.5 ?
 *         FAIL → i += 1  (move one step forward, NOT to largest)
 *         PASS → check fib invalidation
 *
 *     FIB INVALIDATION:
 *       BULL MW inv = col2Price + 0.618 × span  (above tip)
 *       BEAR MW inv = col2Price − 0.618 × span  (below tip)
 *
 *       Invalidated when any subsequent wave:
 *         BULL candidate: BULL wave col2Price > inv
 *                      OR BEAR wave col2Price < col1Price (origin)
 *         BEAR candidate: BEAR wave col2Price < inv
 *                      OR BULL wave col2Price > col1Price (origin)
 *
 *       No breach → MW confirmed (return candidate)
 *       Breach found:
 *         i = index of breaking wave in chronological array
 *         continue (restart from breaking wave)
 *
 * ── Input wave row shape ─────────────────────────────────────────
 *   Each wave row must have:
 *     col1Time  : number (ms) — wave start time
 *     col1Price : number      — wave start price (origin)
 *     col2Time  : number (ms) — wave end time
 *     col2Price : number      — wave end price (tip)
 *     delta     : number      — abs(col2Price - col1Price)
 *     dir       : "bull" | "bear"
 *
 * ── Return value ─────────────────────────────────────────────────
 *   null if no waves, otherwise:
 *   {
 *     wave      : the winning wave row (as passed in)
 *     fibLevels : { "-0.618": price, "0.0": price, ..., "1.0": price }
 *     invalidation : price  (the -0.618 level)
 *   }
 * ─────────────────────────────────────────────────────────────────
 */

/**
 * Convert raw segments (from updateWavesIndicatorPure) into wave rows
 * compatible with detectMotherWaveFromRows.
 */
export function segmentsToWaveRows(segments) {
  return segments.map((seg, i) => {
    const isBull = seg.toSide === "high";
    return {
      id:        `seg-${i}`,
      dir:       isBull ? "bull" : "bear",
      col1Time:  seg.fromTime,
      col1Price: seg.fromPrice,
      col2Time:  seg.toTime,
      col2Price: seg.toPrice,
      delta:     +Math.abs(seg.toPrice - seg.fromPrice).toFixed(2),
      waveNum:   seg.waveNum,
      // keep original fields for callers that need them
      fromTime:  seg.fromTime,
      toTime:    seg.toTime,
      fromPrice: seg.fromPrice,
      toPrice:   seg.toPrice,
      toSide:    seg.toSide,
      label:     seg.prevWaveType && seg.currWaveType
                   ? `${seg.prevWaveType}\u2192${seg.currWaveType}`
                   : "—",
    };
  });
}

/**
 * Core Mother Wave detection.
 * Accepts an array of wave rows (see shape above).
 * Returns { wave, fibLevels, invalidation } or null.
 */
export function detectMotherWaveFromRows(waves) {
  if (!waves || waves.length === 0) return null;

  // Sort chronologically — oldest first
  const byTime = [...waves].sort((a, b) => a.col1Time - b.col1Time);

  // -0.618 invalidation level beyond the tip
  function fibInvalidation(w) {
    const sp = Math.abs(w.col2Price - w.col1Price);
    return w.dir === "bull"
      ? w.col2Price + 0.618 * sp   // above HIGH tip (bull invalidation)
      : w.col2Price - 0.618 * sp;  // below LOW tip  (bear invalidation)
  }

  // Returns true if `wave` breaches the candidate's fib bounds
  function breachesFib(candidate, inv, wave) {
    if (wave.col1Time <= candidate.col2Time) return false;
    if (candidate.dir === "bull") {
      if (wave.dir === "bull"  && wave.col2Price > inv)               return true; // -0.618 breach
      if (wave.dir === "bear"  && wave.col2Price < candidate.col1Price) return true; // origin breach
    } else {
      if (wave.dir === "bear"  && wave.col2Price < inv)               return true; // -0.618 breach
      if (wave.dir === "bull"  && wave.col2Price > candidate.col1Price) return true; // origin breach
    }
    return false;
  }

  let i = 0;

  while (i < byTime.length) {
    const candidate = byTime[i];
    const nextWave  = byTime[i + 1]; // immediately next chronological wave

    // No next wave → nothing challenged the candidate → MW confirmed
    if (!nextWave) break;

    // ── Ratio check: candidate.delta / nextWave.delta >= 2.5 ─────────────
    const ratio = candidate.delta / nextWave.delta;
    if (ratio < 2.5) {
      // FAIL — move one step forward (not to largest, just +1)
      i += 1;
      continue;
    }

    // ── Ratio passed — check fib invalidation against all waves after candidate
    const inv = fibInvalidation(candidate);
    const afterCandidate = byTime.slice(i + 1);
    const breakingWave   = afterCandidate.find(w => breachesFib(candidate, inv, w));

    if (!breakingWave) break; // No breach → MW confirmed

    // Invalidated — restart from the breaking wave's index
    const breakIdx = byTime.indexOf(breakingWave);
    i = breakIdx;
  }

  const candidate = byTime[i];
  if (!candidate) return null;

  const span   = Math.abs(candidate.col2Price - candidate.col1Price);
  const isBull = candidate.dir === "bull";
  const origin = candidate.col1Price; // wave start (1.0 end)
  const end    = candidate.col2Price; // wave tip   (0.0 end)

  // ── Fibonacci levels ───────────────────────────────────────────────────────
  // BULL wave (col1=low origin, col2=high tip):
  //   0.0  = end (tip, the high)        ← top anchor
  //   1.0  = origin (the low)           ← bottom anchor
  //   -0.618 = end + 0.618×span         ← above the high (invalidation)
  //
  // BEAR wave (col1=high origin, col2=low tip):
  //   1.0  = origin (the high)          ← top anchor
  //   0.0  = end (tip, the low)         ← bottom anchor
  //   -0.618 = end - 0.618×span         ← below the low (invalidation)

  const fibLevels = isBull
    ? {
        "-0.618": end + 0.618 * span,   // above the HIGH (invalidation)
        "0.0":    end,                  // wave END = high
        "0.236":  end - 0.236 * span,
        "0.382":  end - 0.382 * span,
        "0.5":    end - 0.5   * span,
        "0.618":  end - 0.618 * span,
        "0.786":  end - 0.786 * span,
        "1.0":    origin,               // wave START = low
      }
    : {
        "1.0":    origin,               // wave START = high
        "0.786":  origin - 0.214 * span,
        "0.618":  origin - 0.382 * span,
        "0.5":    origin - 0.5   * span,
        "0.382":  origin - 0.618 * span,
        "0.236":  origin - 0.764 * span,
        "0.0":    end,                  // wave END = low
        "-0.618": end   - 0.618 * span, // below the LOW (invalidation)
      };

  return {
    wave:         candidate,
    fibLevels,
    invalidation: fibLevels["-0.618"],
  };
}

/**
 * Convenience: run MW detection from raw segments array
 * (output of updateWavesIndicatorPure).
 * Returns the same { wave, fibLevels, invalidation } shape.
 */
export function detectMotherWaveFromSegments(segments) {
  if (!segments || segments.length === 0) return null;
  const rows = segmentsToWaveRows(segments);
  return detectMotherWaveFromRows(rows);
}

/**
 * Convert a detected MW result's `wave` row back to a segment-compatible
 * object (for FibDashboardPage's WaveCard / computeFibLevels which expect
 * fromPrice / toPrice / toSide fields).
 */
export function mwWaveToSegment(wave) {
  if (!wave) return null;
  return {
    fromPrice: wave.col1Price,
    toPrice:   wave.col2Price,
    toSide:    wave.dir === "bull" ? "high" : "low",
    waveNum:   wave.waveNum,
    fromTime:  wave.col1Time,
    toTime:    wave.col2Time,
  };
}
