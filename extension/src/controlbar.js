// Control bar shown directly below the video player on watch pages.
//
// - Lives in a shadow root, so YouTube's CSS can't restyle it and ours can't
//   leak into the page. The host element sits between YouTube's #player and
//   #below (which stay siblings in both normal and theater mode).
// - Never touches YouTube's own nodes except (a) clicking YouTube's own
//   theater-mode button and (b) the video element's loop / scale properties.
// - One debounced MutationObserver (childList only, on the parent) puts the
//   bar back if YouTube re-renders around it. mount() is idempotent, so our
//   own insertion cannot cause a loop.
(function () {
  "use strict";

  var L = window.YTE_BarLogic;
  var P = window.YTE_SpeedPolicy;
  if (!L || !P) return;

  var SVG_NS = "http://www.w3.org/2000/svg";
  var CINEMA_CLASS = "yte-cinema"; // styled by css/youtube.css

  // 24x24 stroke icons ("|" separates paths).
  var ICONS = {
    loop: "M7 7h8a3 3 0 0 1 3 3v1|M17 17H9a3 3 0 0 1-3-3v-1|M15 4l3 3-3 3|M9 20l-3-3 3-3",
    cinema: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
    size: "M3 6h18v12H3z|M7 10h10v4H7z",
    screenshot: "M4 8h3l1.5-2h7L17 8h3v11H4z|M12 16.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    pip: "M3 5h18v14H3z|M12 11h7v6h-7z",
    flipH: "M12 4v16|M9 7L3 17h6z|M15 7l6 10h-6z",
    flipV: "M4 12h16|M7 9L17 3v6z|M7 15l10 6v-6z",
    filters: "M12 3v2|M12 19v2|M3 12h2|M19 12h2|M5.6 5.6L7 7|M17 17l1.4 1.4|M5.6 18.4L7 17|M17 7l1.4-1.4|M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    settings: "M4 7h10|M18 7h2|M4 17h2|M10 17h10|M16 5v4|M8 15v4",
  };

  // Colors come from --yte-* variables set on the host from YouTube's own
  // light/dark state (the `dark` attribute on <html>). We deliberately do not
  // read YouTube's --yt-spec-* variables: newer YouTube builds don't define
  // them, and prefers-color-scheme can disagree with YouTube's chosen theme.
  var THEMES = {
    dark: { fg: "#f1f1f1", bg: "rgba(255,255,255,.1)", hover: "rgba(255,255,255,.2)", on: "#f1f1f1", onFg: "#0f0f0f" },
    light: { fg: "#0f0f0f", bg: "rgba(0,0,0,.05)", hover: "rgba(0,0,0,.1)", on: "#0f0f0f", onFg: "#ffffff" },
  };

  var CSS =
    ":host{all:initial;display:block}" +
    ".bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;box-sizing:border-box;" +
    "margin:8px 0 0;padding:6px 8px;border-radius:12px;background:var(--yte-bg);color:var(--yte-fg);" +
    "font:500 13px/1 Roboto,Arial,-apple-system,sans-serif}" +
    "button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;" +
    "min-width:34px;height:34px;padding:0 8px;border-radius:17px;cursor:pointer;color:inherit;" +
    "-webkit-user-select:none;user-select:none}" +
    "button:hover{background:var(--yte-hover)}" +
    "button:focus-visible{outline:2px solid currentColor;outline-offset:1px}" +
    "button[aria-pressed=true]{background:var(--yte-on);color:var(--yte-onfg)}" +
    "button[disabled]{opacity:.4;cursor:default;background:none}" +
    ".group{display:inline-flex;align-items:center;border-radius:17px;background:var(--yte-bg)}" +
    ".group button{min-width:30px}" +
    ".label{min-width:56px;font-variant-numeric:tabular-nums;font-size:14px;font-weight:600}" +
    ".step{font-size:18px;font-weight:600}" +
    "svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;" +
    "stroke-linecap:round;stroke-linejoin:round;pointer-events:none}" +
    ".toast{margin-left:auto;padding:0 8px;opacity:0;transition:opacity .2s;font-size:12.5px}" +
    ".toast.show{opacity:.85}";

  function create(deps) {
    var host = null;
    var shadow = null;
    var sig = "";
    var els = {};
    var flip = { h: false, v: false };
    var cinemaOn = false;
    var observer = null;
    var observedParent = null;
    var themeObserver = null;
    var mountTimer = null;
    var uiTimer = null;
    var toastTimer = null;
    var destroyed = false;

    var docEl = document.documentElement;

    function log() {
      try {
        if (deps.log) deps.log.apply(null, arguments);
      } catch (err) {
        /* ignore */
      }
    }

    // ---- element helpers ------------------------------------------------------

    function node(tag, cls) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      return e;
    }

    function icon(name) {
      var svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      ICONS[name].split("|").forEach(function (d) {
        var p = document.createElementNS(SVG_NS, "path");
        p.setAttribute("d", d);
        svg.appendChild(p);
      });
      return svg;
    }

    function button(id, title, content, onClick, cls) {
      var b = node("button", cls);
      b.type = "button";
      b.setAttribute("data-id", id);
      b.title = title;
      b.setAttribute("aria-label", title);
      if (typeof content === "string") b.textContent = content;
      else b.appendChild(content);
      b.addEventListener("click", function () {
        try {
          onClick();
        } catch (err) {
          log("bar action failed", id, err);
        }
      });
      els[id] = b;
      return b;
    }

    function setPressed(b, on) {
      if (b) b.setAttribute("aria-pressed", on ? "true" : "false");
    }

    function toast(msg) {
      if (!els.toast) return;
      els.toast.textContent = msg;
      els.toast.classList.add("show");
      if (toastTimer !== null) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        toastTimer = null;
        if (els.toast) els.toast.classList.remove("show");
      }, 2500);
    }

    function schedUpdate(ms) {
      if (uiTimer !== null) clearTimeout(uiTimer);
      uiTimer = setTimeout(function () {
        uiTimer = null;
        update();
      }, ms);
    }

    // ---- actions --------------------------------------------------------------------

    function withVideo(fn) {
      var v = deps.getVideo();
      if (!v) return toast("No video found");
      fn(v);
    }

    function applyFlip(v) {
      var value = L.flipScale(flip);
      if (value) v.style.setProperty("scale", value);
      else v.style.removeProperty("scale");
    }

    function screenshot() {
      withVideo(function (v) {
        if (!v.videoWidth || !v.videoHeight) return toast("No video frame yet");
        try {
          var c = document.createElement("canvas");
          c.width = v.videoWidth;
          c.height = v.videoHeight;
          c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
          c.toBlob(function (blob) {
            try {
              if (!blob) return toast("Screenshot not available");
              var url = URL.createObjectURL(blob);
              var a = document.createElement("a");
              a.href = url;
              a.download = L.screenshotFileName(deps.getVideoId(), v.currentTime);
              a.style.display = "none";
              document.documentElement.appendChild(a);
              a.click();
              a.remove();
              setTimeout(function () {
                URL.revokeObjectURL(url);
              }, 4000);
              toast("Screenshot saved");
            } catch (err) {
              log("screenshot save failed", err);
              toast("Screenshot not available");
            }
          }, "image/png");
        } catch (err) {
          // e.g. protected content makes the canvas unreadable
          log("screenshot failed", err);
          toast("Screenshot not available for this video");
        }
      });
    }

    function pip() {
      withVideo(function (v) {
        if (document.pictureInPictureEnabled && v.requestPictureInPicture) {
          if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(function () {});
          } else {
            v.requestPictureInPicture().catch(function () {
              toast("Picture in Picture is not available");
            });
          }
        } else if (typeof v.webkitSetPresentationMode === "function") {
          v.webkitSetPresentationMode(
            v.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture"
          );
        } else {
          toast("Picture in Picture is not available");
        }
        schedUpdate(400);
      });
    }

    function toggleSize() {
      var p = deps.getPlayer();
      var b = p && p.querySelector(".ytp-size-button");
      if (b) b.click();
      else toast("Theater mode is not available");
      schedUpdate(400);
    }

    function toggleCinema() {
      cinemaOn = !cinemaOn;
      docEl.classList.toggle(CINEMA_CLASS, cinemaOn);
      update();
    }

    // ---- building ------------------------------------------------------------------------

    function render(buttons) {
      while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
      els = {};
      var style = node("style");
      style.textContent = CSS;
      shadow.appendChild(style);
      var bar = node("div", "bar");
      bar.setAttribute("role", "toolbar");
      bar.setAttribute("aria-label", "YouTube Enhancer controls");

      buttons.forEach(function (id) {
        if (id === "speed") {
          var g = node("div", "group");
          g.appendChild(button("speedDown", "Slower", "−", function () { deps.speedAction("down"); }, "step"));
          g.appendChild(button("speedLabel", "Reset to 1×", "1×", function () { deps.speedAction("reset"); }, "label"));
          g.appendChild(button("speedUp", "Faster", "+", function () { deps.speedAction("up"); }, "step"));
          bar.appendChild(g);
        } else if (id === "loop") {
          bar.appendChild(button("loop", "Loop this video", icon("loop"), function () {
            withVideo(function (v) { v.loop = !v.loop; update(); });
          }));
        } else if (id === "cinema") {
          bar.appendChild(button("cinema", "Cinema mode", icon("cinema"), toggleCinema));
        } else if (id === "size") {
          bar.appendChild(button("size", "Theater mode", icon("size"), toggleSize));
        } else if (id === "screenshot") {
          bar.appendChild(button("screenshot", "Save a screenshot of the video", icon("screenshot"), screenshot));
        } else if (id === "pip") {
          bar.appendChild(button("pip", "Picture in Picture", icon("pip"), pip));
        } else if (id === "flip") {
          bar.appendChild(button("flipH", "Flip horizontally", icon("flipH"), function () {
            withVideo(function (v) { flip = L.toggleFlip(flip, "h"); applyFlip(v); update(); });
          }));
          bar.appendChild(button("flipV", "Flip vertically", icon("flipV"), function () {
            withVideo(function (v) { flip = L.toggleFlip(flip, "v"); applyFlip(v); update(); });
          }));
        } else if (id === "filters") {
          bar.appendChild(button("filters", "Video filters on/off", icon("filters"), function () {
            deps.toggleFilters();
          }));
        } else if (id === "settings") {
          bar.appendChild(button("settings", "YouTube Enhancer settings", icon("settings"), function () {
            deps.openSettings();
          }));
        }
      });

      var t = node("span", "toast");
      t.setAttribute("role", "status");
      t.setAttribute("aria-live", "polite");
      els.toast = t;
      bar.appendChild(t);
      shadow.appendChild(bar);
    }

    function applyTheme() {
      if (!host) return;
      var t = THEMES[docEl.hasAttribute("dark") ? "dark" : "light"];
      host.style.setProperty("--yte-fg", t.fg);
      host.style.setProperty("--yte-bg", t.bg);
      host.style.setProperty("--yte-hover", t.hover);
      host.style.setProperty("--yte-on", t.on);
      host.style.setProperty("--yte-onfg", t.onFg);
    }

    // Refresh labels and pressed/disabled states from the real page state.
    function update() {
      if (!host || !shadow || destroyed) return;
      try {
        var v = deps.getVideo();
        var ad = deps.isAd();
        if (els.speedLabel) {
          els.speedLabel.textContent = v ? P.formatSpeed(v.playbackRate).replace("x", "×") || "1×" : "–";
        }
        ["speedDown", "speedLabel", "speedUp"].forEach(function (k) {
          if (els[k]) els[k].disabled = !v || ad;
        });
        setPressed(els.loop, !!(v && v.loop));
        setPressed(els.cinema, cinemaOn);
        var flexy = document.querySelector("ytd-watch-flexy");
        setPressed(els.size, !!(flexy && flexy.hasAttribute("theater")));
        setPressed(
          els.pip,
          !!(v && (document.pictureInPictureElement === v || v.webkitPresentationMode === "picture-in-picture"))
        );
        var vals = deps.getValues();
        setPressed(els.filters, !!(vals && vals.filtersEnabled));
        setPressed(els.flipH, flip.h);
        setPressed(els.flipV, flip.v);
      } catch (err) {
        log("bar update failed", err);
      }
    }

    // ---- placing the bar -------------------------------------------------------------------

    function schedMount() {
      if (mountTimer !== null) return; // debounce
      mountTimer = setTimeout(function () {
        mountTimer = null;
        mount();
      }, 100);
    }

    function stopObserving() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (themeObserver) {
        themeObserver.disconnect();
        themeObserver = null;
      }
      observedParent = null;
    }

    function observe(parent) {
      if (observer && observedParent === parent) return;
      stopObserving();
      observer = new MutationObserver(schedMount);
      observer.observe(parent, { childList: true });
      observedParent = parent;
      // YouTube switching between light and dark theme.
      themeObserver = new MutationObserver(applyTheme);
      themeObserver.observe(docEl, { attributes: true, attributeFilter: ["dark"] });
    }

    function detachHost() {
      stopObserving();
      docEl.classList.remove(CINEMA_CLASS); // never leave the page dimmed
      if (host && host.parentNode) host.parentNode.removeChild(host);
    }

    function mount() {
      if (destroyed) return;
      try {
        var values = deps.getValues();
        var show = L.shouldShowBar({
          pathname: location.pathname,
          isTop: window === window.top,
          values: values,
        });
        var anchor = document.getElementById("player");
        if (!show || !anchor || !anchor.parentNode) return detachHost();

        if (!host) {
          host = document.createElement("div");
          host.id = "yte-controlbar";
          host.setAttribute("data-yte", "controlbar");
          host.style.display = "block";
          shadow = host.attachShadow({ mode: "open" });
        }
        var buttons = L.visibleButtons(values);
        var s = buttons.join(",");
        if (s !== sig) {
          render(buttons);
          sig = s;
        }
        if (host.parentNode !== anchor.parentNode || host.previousElementSibling !== anchor) {
          anchor.after(host);
        }
        docEl.classList.toggle(CINEMA_CLASS, cinemaOn);
        applyTheme();
        observe(anchor.parentNode);
        update();
      } catch (err) {
        log("bar mount failed", err);
      }
    }

    // Back to a clean page: bar gone, cinema off, video un-flipped.
    function unmount() {
      detachHost();
      cinemaOn = false;
      if (flip.h || flip.v) {
        flip = { h: false, v: false };
        var v = deps.getVideo();
        if (v) applyFlip(v);
      }
    }

    // A different video is loading: per-video effects start fresh.
    function newVideo() {
      try {
        var v = deps.getVideo();
        if (v) {
          v.loop = false;
          if (flip.h || flip.v) {
            flip = { h: false, v: false };
            applyFlip(v);
          }
        }
        update();
      } catch (err) {
        log("bar newVideo failed", err);
      }
    }

    function destroy() {
      destroyed = true;
      [mountTimer, uiTimer, toastTimer].forEach(function (t) {
        if (t !== null) clearTimeout(t);
      });
      mountTimer = uiTimer = toastTimer = null;
      try {
        unmount();
      } catch (err) {
        /* ignore */
      }
      host = null;
      shadow = null;
    }

    return { mount: mount, unmount: unmount, update: update, newVideo: newVideo, destroy: destroy };
  }

  window.YTE_ControlBar = { create: create };
})();
