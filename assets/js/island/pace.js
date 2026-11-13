// Frame pacing for the always-on 3D scenes (home island, height stage).
// - Full rate only while something is moving (scroll, camera, pointer, a spring); the idle ambience (wind, candle
//   flicker, the kid's idle) draws at about 30 fps, or twice a second with reduced motion, where nothing animates.
// - If the device can't hold the full rate for two seconds while moving, the pixel ratio steps down (never below 1).
const IDLE_MS = 31, IDLE_STILL_MS = 500;   // just under 33.3 ms, so 60 / 120 Hz screens draw every 2nd / 4th frame
const SLOW_MS = 26, SLOW_FOR_MS = 2000;     // averaging over ~38 fps for 2 s counts as "can't keep up"

export const antialias = () => (window.devicePixelRatio || 1) < 2;   // MSAA buys little on dense screens and costs a lot

export function createPacer(renderer, { reducedMotion = false, onPixelRatio = () => {} } = {}) {
  const maxRatio = Math.min(window.devicePixelRatio || 1, 2), minRatio = Math.min(1, maxRatio);
  let ratio = maxRatio, last = 0, avg = 16.7, slowFor = 0;
  renderer.setPixelRatio(ratio);
  return {
    get pixelRatio() { return ratio; },
    // Call first thing in each animation frame. Returns the seconds to advance and draw this frame, or 0 to skip it.
    tick(now, active) {
      if (!last) { last = now; return 1 / 60; }
      const gap = now - last;
      if (!active && gap < (reducedMotion ? IDLE_STILL_MS : IDLE_MS)) return 0;
      last = now;
      if (active && gap < 250) {   // judge the device only while it is asked for full rate (and not after a pause)
        avg += (gap - avg) * 0.1;
        slowFor = avg > SLOW_MS ? slowFor + gap : 0;
        if (slowFor > SLOW_FOR_MS && ratio > minRatio) {
          ratio = Math.max(minRatio, ratio - 0.25);
          renderer.setPixelRatio(ratio);
          onPixelRatio(ratio);
          slowFor = 0; avg = 16.7;
        }
      }
      return Math.min(gap / 1000, 0.05);
    }
  };
}

// Write a DOM attribute / inline style only when its value changes: the overlays are recomputed every drawn frame,
// but mostly land on the same numbers.
export function setAttr(el, name, value) {
  const c = el.__attrs || (el.__attrs = {});
  if (c[name] !== value) { c[name] = value; el.setAttribute(name, value); }
}
export function setStyle(el, prop, value) {
  const c = el.__styles || (el.__styles = {});
  if (c[prop] !== value) { c[prop] = value; el.style[prop] = value; }
}
