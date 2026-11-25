// Pure gesture -> playback-speed logic. No DOM access, no globals touched.
//
// Safari reports a trackpad pinch as GestureEvents whose `scale` starts at 1
// and moves continuously (>1 pinch-out, <1 pinch-in). We convert that into
// DISCRETE speed steps: work in log space (so zooming in and out are
// symmetric), keep a baseline, and every time the log-scale has moved by
// `threshold` since the baseline, change speed by one `step`.
//
// All functions are immutable: they take a state and return a new one.
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api; // node tests
  } else {
    root.YTE_GestureSpeed = api; // content script (isolated world)
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DEFAULTS = Object.freeze({
    step: 0.25, // speed change per step
    threshold: 0.15, // |ln(scale)| movement needed per step
    min: 0.25,
    max: 4,
    maxStepsPerEvent: 8, // bounds work + damage from one huge jump
    wheelUnit: 0.01, // ctrl+wheel: ln-units per deltaY pixel
  });

  // HTMLMediaElement.playbackRate limits we ever allow, whatever the config.
  var HARD_MIN = 0.0625;
  var HARD_MAX = 16;
  var EPS = 1e-9;

  function isNum(v) {
    return typeof v === "number" && isFinite(v);
  }

  function positive(v, fallback) {
    return isNum(v) && v > 0 ? v : fallback;
  }

  function roundSpeed(v) {
    return Math.round(v * 1000) / 1000;
  }

  function normalizeConfig(cfg) {
    var c = cfg && typeof cfg === "object" ? cfg : {};
    var min = positive(c.min, DEFAULTS.min);
    var max = positive(c.max, DEFAULTS.max);
    if (min > max) {
      var t = min;
      min = max;
      max = t;
    }
    min = Math.max(min, HARD_MIN);
    max = Math.min(max, HARD_MAX);
    if (min > max) min = max;
    return {
      step: positive(c.step, DEFAULTS.step),
      threshold: positive(c.threshold, DEFAULTS.threshold),
      min: min,
      max: max,
      maxStepsPerEvent: Math.max(
        1,
        Math.floor(positive(c.maxStepsPerEvent, DEFAULTS.maxStepsPerEvent))
      ),
      wheelUnit: positive(c.wheelUnit, DEFAULTS.wheelUnit),
    };
  }

  // Clamp a computed target into [min, max]. Non-numbers fall back to 1x.
  // (A finite value <= 0 is a legitimate overshoot from a pinch-in and clamps
  // to min; only a non-number is "garbage".)
  function clampTarget(speed, cfg) {
    var s = isNum(speed) ? speed : 1;
    return roundSpeed(Math.min(cfg.max, Math.max(cfg.min, s)));
  }

  // Clamp a speed read from the outside world (video.playbackRate, state).
  // 0 / negative / non-numbers are not real speeds: treat as 1x.
  function clampSpeed(speed, cfg) {
    return clampTarget(isNum(speed) && speed > 0 ? speed : 1, cfg);
  }

  // state: { speed, baseline, wheelAcc, changed }
  function createState(currentSpeed, config) {
    var cfg = normalizeConfig(config);
    return {
      speed: clampSpeed(currentSpeed, cfg),
      baseline: 0,
      wheelAcc: 0,
      changed: false,
    };
  }

  function sanitizeState(state, cfg) {
    var s = state && typeof state === "object" ? state : {};
    return {
      speed: clampSpeed(s.speed, cfg),
      baseline: isNum(s.baseline) ? s.baseline : 0,
      wheelAcc: isNum(s.wheelAcc) ? s.wheelAcc : 0,
      changed: false,
    };
  }

  // Whole steps contained in `amount` (truncated toward zero), bounded.
  function wholeSteps(amount, cfg) {
    var raw = amount / cfg.threshold;
    if (!isFinite(raw)) return 0;
    var n = raw >= 0 ? Math.floor(raw + EPS) : Math.ceil(raw - EPS);
    if (n > cfg.maxStepsPerEvent) n = cfg.maxStepsPerEvent;
    if (n < -cfg.maxStepsPerEvent) n = -cfg.maxStepsPerEvent;
    return n;
  }

  // scale: GestureEvent.scale. Returns a new state; `changed` says whether
  // the speed moved. Invalid scale values are ignored (state unchanged).
  function update(state, config, scale) {
    var cfg = normalizeConfig(config);
    var s = sanitizeState(state, cfg);
    if (!isNum(scale) || scale <= 0) return s;
    var x = Math.log(scale);
    if (!isNum(x)) return s;

    var n = wholeSteps(x - s.baseline, cfg);
    if (n === 0) return s;

    var target = s.speed + n * cfg.step;
    var next = clampTarget(target, cfg);
    var hitLimit = roundSpeed(target) !== next;
    return {
      speed: next,
      // Normal: consume exactly the movement we turned into steps, keep the
      // remainder. At a limit: forget the overshoot so reversing responds
      // immediately instead of first "paying back" a hidden debt.
      baseline: hitLimit ? x : s.baseline + n * cfg.threshold,
      wheelAcc: s.wheelAcc,
      changed: next !== s.speed,
    };
  }

  // ctrl+wheel (mouse, or other non-gesture pinch emulation). deltaY < 0
  // means "zoom in" => faster. At most one step per event so a mouse-wheel
  // notch (deltaY ~ 100) is exactly one step; small trackpad deltas add up.
  function updateWheel(state, config, deltaY, deltaMode) {
    var cfg = normalizeConfig(config);
    var s = sanitizeState(state, cfg);
    if (!isNum(deltaY) || deltaY === 0) return s;
    var unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 100 : 1;
    var dx = -deltaY * unit * cfg.wheelUnit;
    dx = Math.max(-cfg.threshold, Math.min(cfg.threshold, dx));
    var acc = s.wheelAcc + dx;

    var n = wholeSteps(acc, cfg);
    if (n === 0) {
      s.wheelAcc = acc;
      return s;
    }
    var target = s.speed + n * cfg.step;
    var next = clampTarget(target, cfg);
    var hitLimit = roundSpeed(target) !== next;
    return {
      speed: next,
      baseline: s.baseline,
      wheelAcc: hitLimit ? 0 : acc - n * cfg.threshold,
      changed: next !== s.speed,
    };
  }

  // Keyboard shortcuts: one step up (+1) or down (-1) from `current`.
  function stepSpeed(current, direction, config) {
    var cfg = normalizeConfig(config);
    var cur = clampSpeed(current, cfg);
    var d = direction > 0 ? 1 : direction < 0 ? -1 : 0;
    if (d === 0) return cur;
    return clampTarget(cur + d * cfg.step, cfg);
  }

  function resetSpeed(config) {
    return clampTarget(1, normalizeConfig(config));
  }

  return {
    DEFAULTS: DEFAULTS,
    normalizeConfig: normalizeConfig,
    clampSpeed: clampSpeed,
    createState: createState,
    update: update,
    updateWheel: updateWheel,
    stepSpeed: stepSpeed,
    resetSpeed: resetSpeed,
  };
});
