// Pure decision logic for the page/player features. No DOM.
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.YTE_Features = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // class on <html> -> the setting that turns it on. The CSS for each class
  // lives in css/youtube.css and is inert until the class is present: pages
  // are only ever HIDDEN with CSS, never edited or removed.
  var PAGE_CLASSES = [
    { cls: "yte-hide-comments", setting: "hideComments" },
    { cls: "yte-hide-related", setting: "hideRelated" },
    { cls: "yte-hide-chat", setting: "hideChat" },
    { cls: "yte-hide-cards", setting: "hideCards" },
    { cls: "yte-hide-shorts", setting: "hideShorts" },
  ];

  function pageClasses(values) {
    var on = !!values && values.enabled === true;
    var out = {};
    PAGE_CLASSES.forEach(function (c) {
      out[c.cls] = on && values[c.setting] === true;
    });
    return out;
  }

  function isNum(v) {
    return typeof v === "number" && isFinite(v);
  }

  // CSS `filter` value for the video, "" when nothing should be applied.
  // Defaults (100% / 0%) are skipped so we never add a no-op filter chain.
  function filterCss(values) {
    if (!values || values.enabled !== true || values.filtersEnabled !== true) return "";
    var parts = [];
    function pct(key, neutral, fn) {
      var v = values[key];
      if (isNum(v) && v !== neutral) parts.push(fn + "(" + Math.round(v * 10) / 1000 + ")");
    }
    pct("filterBrightness", 100, "brightness");
    pct("filterContrast", 100, "contrast");
    pct("filterSaturation", 100, "saturate");
    pct("filterSepia", 0, "sepia");
    pct("filterGrayscale", 0, "grayscale");
    if (isNum(values.filterHue) && values.filterHue !== 0) {
      parts.push("hue-rotate(" + Math.round(values.filterHue) + "deg)");
    }
    return parts.join(" ");
  }

  // Click YouTube's theater button once per video, never on ads / non-watch
  // pages, never when it is already on.
  function shouldAutoTheater(ctx) {
    ctx = ctx && typeof ctx === "object" ? ctx : {};
    if (ctx.enabled !== true || ctx.autoTheater !== true) return false;
    if (typeof ctx.pathname !== "string" || ctx.pathname.indexOf("/watch") !== 0) return false;
    if (ctx.isTheater === true || ctx.adShowing === true || ctx.hasButton !== true) return false;
    if (typeof ctx.videoId !== "string" || ctx.videoId === "") return false;
    return ctx.videoId !== ctx.doneFor;
  }

  // Should this `play` event be undone? A bounded number of times per video,
  // so a page that keeps calling play() can never trap us in a loop.
  //   background: pause videos that start in a tab that has never been visible
  //   foreground: pause the first video of a page load the user didn't start
  function shouldPauseAutoplay(ctx) {
    ctx = ctx && typeof ctx === "object" ? ctx : {};
    if (ctx.enabled !== true) return false;
    var pauses = isNum(ctx.pauses) ? ctx.pauses : 0;
    var max = isNum(ctx.maxPauses) ? ctx.maxPauses : 0;
    if (pauses >= max) return false;
    if (ctx.background === true && ctx.hiddenSinceLoad === true) return true;
    if (ctx.foreground === true && ctx.userInteracted !== true) return true;
    return false;
  }

  return {
    PAGE_CLASSES: PAGE_CLASSES,
    pageClasses: pageClasses,
    filterCss: filterCss,
    shouldAutoTheater: shouldAutoTheater,
    shouldPauseAutoplay: shouldPauseAutoplay,
  };
});
