// On-screen speed indicator ("1.75x"). Appended INSIDE the player element so
// it stays visible in fullscreen; pointer-events:none so it never blocks a
// click; fades out after ~800 ms; removed on navigation / teardown.
(function () {
  "use strict";

  var el = null;
  var hideTimer = null;

  function clearTimer() {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function create(player) {
    var d = document.createElement("div");
    d.setAttribute("data-yte-indicator", "1");
    d.setAttribute("aria-hidden", "true");
    var s = d.style;
    s.position = "absolute";
    s.top = "12%";
    s.left = "50%";
    s.transform = "translateX(-50%)";
    s.padding = "6px 16px";
    s.borderRadius = "10px";
    s.background = "rgba(0, 0, 0, 0.7)";
    s.color = "#fff";
    s.font = "600 22px/1.25 -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
    s.letterSpacing = "0.02em";
    s.pointerEvents = "none";
    s.userSelect = "none";
    s.zIndex = "2147483647";
    s.opacity = "1";
    s.transition = "opacity 250ms ease";
    player.appendChild(d);
    return d;
  }

  function remove() {
    clearTimer();
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = null;
  }

  function show(player, text, holdMs) {
    try {
      if (!player || !text) return;
      if (!el || el.parentNode !== player) {
        remove();
        el = create(player);
      }
      el.textContent = text;
      el.style.opacity = "1";
      clearTimer();
      hideTimer = setTimeout(function () {
        hideTimer = null;
        if (el) el.style.opacity = "0";
      }, typeof holdMs === "number" && holdMs >= 0 ? holdMs : 800);
    } catch (err) {
      /* never break the page */
    }
  }

  window.YTE_Indicator = { show: show, remove: remove };
})();
