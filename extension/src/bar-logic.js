// Pure logic for the control bar below the player: which buttons show, when
// the bar may appear at all, flip state, screenshot file names. No DOM.
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.YTE_BarLogic = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // id -> the setting that shows/hides it. Order = order on the bar.
  var BUTTONS = [
    { id: "speed", setting: "barSpeed" },
    { id: "loop", setting: "barLoop" },
    { id: "cinema", setting: "barCinema" },
    { id: "size", setting: "barSize" },
    { id: "screenshot", setting: "barScreenshot" },
    { id: "pip", setting: "barPip" },
    { id: "flip", setting: "barFlip" },
    { id: "filters", setting: "barFilters" },
    { id: "settings", setting: "barSettings" },
  ];

  function visibleButtons(values) {
    if (!values || values.enabled !== true || values.controlBarEnabled !== true) return [];
    return BUTTONS.filter(function (b) {
      return values[b.setting] === true;
    }).map(function (b) {
      return b.id;
    });
  }

  // The bar lives only on a normal watch page in the top frame: never in
  // embeds on other sites, never on Shorts.
  function shouldShowBar(ctx) {
    ctx = ctx && typeof ctx === "object" ? ctx : {};
    var path = typeof ctx.pathname === "string" ? ctx.pathname : "";
    if (path.indexOf("/watch") !== 0) return false;
    if (ctx.isTop !== true) return false;
    return visibleButtons(ctx.values).length > 0;
  }

  function toggleFlip(state, axis) {
    var s = state && typeof state === "object" ? state : {};
    var next = { h: s.h === true, v: s.v === true };
    if (axis === "h") next.h = !next.h;
    else if (axis === "v") next.v = !next.v;
    return next;
  }

  // Value for the CSS `scale` property ("" = no change).
  function flipScale(state) {
    var s = state && typeof state === "object" ? state : {};
    if (s.h !== true && s.v !== true) return "";
    return (s.h === true ? "-1" : "1") + " " + (s.v === true ? "-1" : "1");
  }

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  // 3725.6 -> "1h02m05s", 65 -> "1m05s", 9 -> "9s"; garbage -> "0s"
  function formatClock(seconds) {
    var t = typeof seconds === "number" && isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    var h = Math.floor(t / 3600);
    var m = Math.floor((t % 3600) / 60);
    var s = t % 60;
    if (h > 0) return h + "h" + pad(m) + "m" + pad(s) + "s";
    if (m > 0) return m + "m" + pad(s) + "s";
    return s + "s";
  }

  function screenshotFileName(videoId, seconds) {
    var id = typeof videoId === "string" ? videoId.replace(/[^\w-]/g, "").slice(0, 32) : "";
    return "youtube-" + (id || "video") + "-" + formatClock(seconds) + ".png";
  }

  return {
    BUTTONS: BUTTONS,
    visibleButtons: visibleButtons,
    shouldShowBar: shouldShowBar,
    toggleFlip: toggleFlip,
    flipScale: flipScale,
    formatClock: formatClock,
    screenshotFileName: screenshotFileName,
  };
});
