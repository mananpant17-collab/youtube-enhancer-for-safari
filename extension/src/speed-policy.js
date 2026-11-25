// Pure helpers for deciding what to do about playbackRate changes. No DOM.
//
// YouTube reuses one <video> across videos and sometimes resets its speed.
// When a `ratechange` event arrives we must tell apart:
//   "ours"    - the echo of our own write            -> ignore (no loop)
//   "reapply" - YouTube overwrote us just after a new
//               video loaded                          -> put our speed back
//   "user"    - the user changed speed another way
//               (YouTube's menu, < > keys)            -> adopt it, don't fight
//   "ignore"  - an ad is playing / nonsense value     -> do nothing
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.YTE_SpeedPolicy = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var EPS = 1e-4;

  function isNum(v) {
    return typeof v === "number" && isFinite(v);
  }

  function approxEqual(a, b) {
    return isNum(a) && isNum(b) && Math.abs(a - b) < EPS;
  }

  // 1.75 -> "1.75x", 1 -> "1x", 0.25 -> "0.25x". Garbage -> "".
  function formatSpeed(v) {
    if (!isNum(v) || v <= 0) return "";
    return String(Math.round(v * 100) / 100) + "x";
  }

  // i: { rate, expected, desired, inWindow, adShowing }
  function classifyRateChange(i) {
    i = i && typeof i === "object" ? i : {};
    if (i.adShowing) return "ignore";
    if (!isNum(i.rate) || i.rate <= 0) return "ignore";
    if (isNum(i.expected) && approxEqual(i.rate, i.expected)) return "ours";
    if (i.inWindow && isNum(i.desired) && !approxEqual(i.rate, i.desired)) return "reapply";
    return "user";
  }

  // Value read back from sessionStorage (a string) -> valid speed or null.
  function sanitizeStoredSpeed(raw) {
    var n = typeof raw === "string" && raw !== "" ? Number(raw) : raw;
    if (!isNum(n) || n < 0.0625 || n > 16) return null;
    return Math.round(n * 1000) / 1000;
  }

  // The current video's id from the URL, or null. Handles /watch?v=,
  // /embed/<id>, /live/<id>.
  function videoIdFromLocation(pathname, search) {
    var path = typeof pathname === "string" ? pathname : "";
    var m = /^\/(?:embed|live)\/([\w-]{6,})/.exec(path);
    if (m) return m[1];
    var q = /[?&]v=([\w-]{6,})/.exec(typeof search === "string" ? search : "");
    return q ? q[1] : null;
  }

  return {
    formatSpeed: formatSpeed,
    approxEqual: approxEqual,
    classifyRateChange: classifyRateChange,
    sanitizeStoredSpeed: sanitizeStoredSpeed,
    videoIdFromLocation: videoIdFromLocation,
  };
});
