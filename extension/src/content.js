// YouTube Enhancer for Safari - content script (M3).
//
// M2: pinch-to-change-speed (GestureEvents + ctrl+wheel) over the player.
// M3: on-screen speed indicator, SPA navigation handling, and a guarded
//     playbackRate re-apply so YouTube resetting the speed doesn't win and
//     we never create a ratechange feedback loop.
//
// Rules this file follows:
//  - "over the player" is decided from POSITION (event clientX/Y, falling
//    back to the last tracked pointer position), never from event.target;
//  - the decision is made once at gesturestart and locked until gestureend;
//  - no preventDefault outside the "over the player" case;
//  - every handler is wrapped in try/catch; failure = default Safari behaviour;
//  - no polling: events + one debounced MutationObserver, all torn down on
//    pagehide; no unbounded loops.
(function () {
  "use strict";

  var VERSION = "0.7.0";
  var root = document.documentElement;
  if (!root) return;
  if (window.__YTE_ACTIVE__) return; // never double-inject
  window.__YTE_ACTIVE__ = true;

  try {
    root.setAttribute("data-yte-loaded", VERSION);
    root.setAttribute("data-yte-frame", window === window.top ? "top" : "frame");
  } catch (err) {
    /* ignore */
  }

  var G = window.YTE_GestureSpeed;
  var P = window.YTE_SpeedPolicy;
  var IND = window.YTE_Indicator;
  var S = window.YTE_Settings;
  var BAR = window.YTE_ControlBar;
  var F = window.YTE_Features;
  if (!G || !P || !IND || !S || !BAR || !F) return; // helper modules failed to load: do nothing

  // Live settings (see settings.js). Filled with defaults immediately so the
  // script works before storage has answered, then updated from storage.
  var CFG = { indicatorMs: 800 };
  function mapSettings(v) {
    CFG.enabled = v.enabled;
    CFG.pinchEnabled = v.pinchEnabled;
    CFG.ctrlWheelEnabled = v.ctrlWheelEnabled;
    CFG.step = v.step;
    CFG.threshold = v.threshold;
    CFG.min = v.minSpeed;
    CFG.max = v.maxSpeed;
    CFG.rememberSpeed = v.rememberSpeed;
    CFG.indicatorEnabled = v.indicatorEnabled;
    CFG.shortcutsEnabled = v.shortcutsEnabled;
    CFG.keySpeedUp = v.keySpeedUp;
    CFG.keySpeedDown = v.keySpeedDown;
    CFG.keySpeedReset = v.keySpeedReset;
    CFG.controlBarEnabled = v.controlBarEnabled;
    CFG.barSpeed = v.barSpeed;
    CFG.barLoop = v.barLoop;
    CFG.barCinema = v.barCinema;
    CFG.barSize = v.barSize;
    CFG.barScreenshot = v.barScreenshot;
    CFG.barPip = v.barPip;
    CFG.barFlip = v.barFlip;
    CFG.barFilters = v.barFilters;
    CFG.barSettings = v.barSettings;
    CFG.hideComments = v.hideComments;
    CFG.hideRelated = v.hideRelated;
    CFG.hideChat = v.hideChat;
    CFG.hideCards = v.hideCards;
    CFG.hideShorts = v.hideShorts;
    CFG.autoTheater = v.autoTheater;
    CFG.preventAutoplayBackground = v.preventAutoplayBackground;
    CFG.preventAutoplayForeground = v.preventAutoplayForeground;
    CFG.filtersEnabled = v.filtersEnabled;
    CFG.filterBrightness = v.filterBrightness;
    CFG.filterContrast = v.filterContrast;
    CFG.filterSaturation = v.filterSaturation;
    CFG.filterSepia = v.filterSepia;
    CFG.filterGrayscale = v.filterGrayscale;
    CFG.filterHue = v.filterHue;
  }
  mapSettings(S.defaults());
  var DEBUG = false;

  function log() {
    if (!DEBUG) return;
    try {
      console.log.apply(console, ["[YTE]"].concat([].slice.call(arguments)));
    } catch (err) {
      /* ignore */
    }
  }

  // ---- small DOM helpers ------------------------------------------------------

  function isNum(v) {
    return typeof v === "number" && isFinite(v);
  }
  function isShortsPage() {
    return location.pathname.indexOf("/shorts/") === 0;
  }
  function getPlayer() {
    var p = document.getElementById("movie_player");
    return p && p.isConnected !== false ? p : null;
  }
  function getVideoOf(player) {
    return (
      player.querySelector("video.html5-main-video") || player.querySelector("video")
    );
  }
  function isAdShowing(player) {
    return !!(player && player.classList && player.classList.contains("ad-showing"));
  }

  // ---- speed memory (this tab's session only) -----------------------------------

  var STORE_KEY = "yte:speed";
  function readStored() {
    try {
      return P.sanitizeStoredSpeed(window.sessionStorage.getItem(STORE_KEY));
    } catch (err) {
      return null;
    }
  }
  function writeStored(v) {
    try {
      window.sessionStorage.setItem(STORE_KEY, String(v));
    } catch (err) {
      /* storage unavailable: memory only */
    }
  }

  var sessionSpeed = CFG.rememberSpeed ? readStored() : null;

  function desiredSpeed() {
    return CFG.rememberSpeed ? sessionSpeed : null;
  }
  function remember(v) {
    if (!CFG.rememberSpeed || !isNum(v) || v <= 0) return;
    sessionSpeed = v;
    writeStored(v);
  }

  // ---- writing playbackRate ---------------------------------------------------------

  // `expected` is the value we just wrote. ratechange is delivered
  // asynchronously, so a boolean flag around the assignment would not work;
  // comparing the event's value with what we wrote does.
  var expected = null;
  var expectedTimer = null;

  function setSpeed(video, speed, showIndicator) {
    if (!video || !video.isConnected || !isNum(speed)) return;
    expected = speed;
    if (expectedTimer !== null) clearTimeout(expectedTimer);
    expectedTimer = setTimeout(function () {
      expectedTimer = null;
      expected = null;
    }, 500);
    video.playbackRate = speed;
    remember(speed);
    try {
      root.setAttribute("data-yte-speed", String(speed));
    } catch (err) {
      /* ignore */
    }
    log("speed", speed + "x");
    if (showIndicator && CFG.indicatorEnabled) IND.show(getPlayer(), P.formatSpeed(speed), CFG.indicatorMs);
    if (bar) bar.update();
  }

  // ---- tracking the (reused) <video> ------------------------------------------------

  var tracked = null; // the <video> we currently listen to
  var windowUntil = 0; // YouTube may overwrite our speed until this time
  var budget = 0; // max re-applies per new video (bounds any fight)
  var reapplyTimer = null;
  var syncTimer = null;
  var waitTimer = null;
  var observer = null;
  var lastVideoId = null;
  var PASSIVE = { passive: true };

  function onLoadedMetadata() {
    windowUntil = Date.now() + 2000;
    budget = 3;
    if (reapplyTimer !== null) clearTimeout(reapplyTimer);
    // Small delay so YouTube has finished its own setup (and toggled the
    // ad-showing class) before we decide anything.
    reapplyTimer = setTimeout(afterNewMedia, 150);
  }

  function afterNewMedia() {
    reapplyTimer = null;
    try {
      if (!CFG.enabled) return;
      var v = tracked;
      if (!v || !v.isConnected || isShortsPage()) return;
      if (isAdShowing(getPlayer())) return; // never touch ad speed
      var id = P.videoIdFromLocation(location.pathname, location.search);
      var isNewVideo = id !== lastVideoId;
      lastVideoId = id;
      if (isNewVideo && bar) bar.newVideo();
      maybeAutoTheater(id);
      if (!CFG.rememberSpeed) {
        if (isNewVideo && !P.approxEqual(v.playbackRate, 1)) setSpeed(v, 1, false);
        return;
      }
      var d = desiredSpeed();
      if (d !== null && !P.approxEqual(v.playbackRate, d)) setSpeed(v, d, false);
    } catch (err) {
      log("afterNewMedia failed", err);
    }
  }

  function onRateChange() {
    try {
      var v = tracked;
      if (!v || !CFG.enabled) return;
      var kind = P.classifyRateChange({
        rate: v.playbackRate,
        expected: expected,
        desired: desiredSpeed(),
        inWindow: Date.now() < windowUntil,
        adShowing: isAdShowing(getPlayer()),
      });
      if (kind === "ours") {
        expected = null;
      } else if (kind === "reapply") {
        if (budget > 0) {
          budget--;
          setSpeed(v, desiredSpeed(), false);
        }
      } else if (kind === "user") {
        remember(v.playbackRate); // YouTube menu / < > keys: adopt, don't fight
      }
      if (bar) bar.update();
    } catch (err) {
      log("ratechange failed", err);
    }
  }

  function detach() {
    if (!tracked) return;
    try {
      tracked.removeEventListener("loadedmetadata", onLoadedMetadata, PASSIVE);
      tracked.removeEventListener("ratechange", onRateChange, PASSIVE);
      tracked.removeEventListener("play", onPlay, PASSIVE);
    } catch (err) {
      /* ignore */
    }
    tracked = null;
  }

  function attach(v) {
    if (tracked === v) return;
    detach();
    if (!v) return;
    tracked = v;
    v.addEventListener("loadedmetadata", onLoadedMetadata, PASSIVE);
    v.addEventListener("ratechange", onRateChange, PASSIVE);
    v.addEventListener("play", onPlay, PASSIVE);
    applyFilters();
    if (v.readyState >= 1) onLoadedMetadata(); // video was already loaded
  }

  function sync() {
    try {
      if (isShortsPage()) return attach(null);
      var p = getPlayer();
      attach(p ? getVideoOf(p) : null);
    } catch (err) {
      log("sync failed", err);
    }
  }

  function schedSync() {
    if (syncTimer !== null) return; // debounce
    syncTimer = setTimeout(function () {
      syncTimer = null;
      sync();
    }, 100);
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (waitTimer !== null) {
      clearTimeout(waitTimer);
      waitTimer = null;
    }
  }

  // Watch the player for the <video> being swapped. If the player isn't in
  // the DOM yet, wait for it with a cheap observer that gives up after 30 s
  // (navigation events restart it) and is replaced as soon as it succeeds.
  function watch() {
    stopObserver();
    try {
      var p = getPlayer();
      if (p) {
        observer = new MutationObserver(schedSync);
        observer.observe(p, { childList: true, subtree: true });
        sync();
        refreshBar();
        return;
      }
      observer = new MutationObserver(function () {
        if (getPlayer()) watch();
      });
      observer.observe(root, { childList: true, subtree: true });
      waitTimer = setTimeout(stopObserver, 30000);
    } catch (err) {
      log("watch failed", err);
    }
  }

  // ---- SPA navigation ------------------------------------------------------------------

  function onNavigateStart() {
    IND.remove();
  }
  function onNavigateDone() {
    try {
      IND.remove();
      gesture = null;
      wheel = null;
      watch(); // the player element may have been rebuilt
      refreshBar(); // show on watch pages, remove everywhere else
    } catch (err) {
      log("navigate failed", err);
    }
  }

  // ---- pointer tracking -----------------------------------------------------------------

  var ptr = { x: 0, y: 0, ok: false };

  function onPointerMove(e) {
    ptr.x = e.clientX;
    ptr.y = e.clientY;
    ptr.ok = true;
  }
  function onPointerGone() {
    ptr.ok = false;
  }

  // Returns { player, video } if the pointer for this event is over the main
  // player, else null. Handles normal, theater, fullscreen and miniplayer
  // because the player element's own rect is used in all of them.
  function locate(e) {
    if (isShortsPage()) return null;
    var player = getPlayer();
    if (!player) return null;
    var video = getVideoOf(player);
    if (!video) return null;

    var x, y;
    if (isNum(e.clientX) && isNum(e.clientY) && !(e.clientX === 0 && e.clientY === 0)) {
      x = e.clientX;
      y = e.clientY;
    } else if (ptr.ok) {
      x = ptr.x;
      y = ptr.y;
    } else {
      return null;
    }

    var r = player.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    return { player: player, video: video };
  }

  function swallow(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  // ---- pinch (GestureEvents) ---------------------------------------------------------------

  var gesture = null; // non-null = this gesture was claimed at gesturestart

  function onGestureStart(e) {
    gesture = null;
    try {
      if (!CFG.enabled || !CFG.pinchEnabled) return;
      var hit = locate(e);
      if (!hit) return; // not over the player: leave Safari alone
      swallow(e);
      gesture = {
        video: hit.video,
        ad: isAdShowing(hit.player),
        state: G.createState(hit.video.playbackRate, CFG),
      };
    } catch (err) {
      gesture = null;
      log("gesturestart failed", err);
    }
  }

  function onGestureChange(e) {
    if (!gesture) return; // decision was "not ours": never flips mid-gesture
    try {
      swallow(e);
      if (gesture.ad) return; // ads: block page zoom but never touch ad speed
      gesture.state = G.update(gesture.state, CFG, e.scale);
      if (gesture.state.changed) setSpeed(gesture.video, gesture.state.speed, true);
    } catch (err) {
      log("gesturechange failed", err);
    }
  }

  function onGestureEnd(e) {
    if (!gesture) return;
    try {
      swallow(e);
    } catch (err) {
      /* ignore */
    }
    gesture = null;
  }

  // ---- ctrl+wheel (mice, other input methods) ------------------------------------------------

  var wheel = null; // { video, state, t }

  function onWheel(e) {
    if (!CFG.enabled || !e.ctrlKey || !CFG.ctrlWheelEnabled) return;
    try {
      var hit = locate(e);
      if (!hit) return;
      swallow(e);
      if (isAdShowing(hit.player)) return;
      var now = Date.now();
      if (!wheel || wheel.video !== hit.video || now - wheel.t > 300) {
        wheel = { video: hit.video, state: G.createState(hit.video.playbackRate, CFG), t: now };
      }
      wheel.t = now;
      wheel.state = G.updateWheel(wheel.state, CFG, e.deltaY, e.deltaMode);
      if (wheel.state.changed) setSpeed(wheel.video, wheel.state.speed, true);
    } catch (err) {
      log("wheel failed", err);
    }
  }

  // ---- page classes, filters, auto theater, autoplay -------------------------------------------

  function applyPageClasses() {
    var classes = F.pageClasses(CFG);
    Object.keys(classes).forEach(function (cls) {
      root.classList.toggle(cls, classes[cls]);
    });
  }

  function applyFilters() {
    var p = getPlayer();
    var v = tracked || (p && getVideoOf(p));
    if (!v || !v.style) return;
    var css = F.filterCss(CFG);
    if (css) v.style.setProperty("filter", css);
    else v.style.removeProperty("filter");
  }

  var theaterDoneFor = null;
  function maybeAutoTheater(id) {
    var p = getPlayer();
    var btn = p && p.querySelector(".ytp-size-button");
    var flexy = document.querySelector("ytd-watch-flexy");
    var go = F.shouldAutoTheater({
      enabled: CFG.enabled,
      autoTheater: CFG.autoTheater,
      pathname: location.pathname,
      isTheater: !!(flexy && flexy.hasAttribute("theater")),
      adShowing: isAdShowing(p),
      videoId: id,
      doneFor: theaterDoneFor,
      hasButton: !!btn,
    });
    if (go) {
      theaterDoneFor = id;
      btn.click(); // YouTube's own button: the supported way to switch modes
    }
  }

  // Autoplay prevention. "User interacted" = a real (trusted) click or key
  // press happened since this page loaded.
  var userInteracted = false;
  var everVisible = !document.hidden;
  var pauseCount = 0;
  var pauseId = null;

  function onUserEvent(e) {
    if (e && e.isTrusted) userInteracted = true;
  }
  function onVisibility() {
    if (!document.hidden) everVisible = true;
  }
  function onPlay() {
    try {
      var v = tracked;
      if (!v) return;
      var id = P.videoIdFromLocation(location.pathname, location.search);
      if (id !== pauseId) {
        pauseId = id;
        pauseCount = 0;
      }
      var pause = F.shouldPauseAutoplay({
        enabled: CFG.enabled,
        background: CFG.preventAutoplayBackground,
        foreground: CFG.preventAutoplayForeground,
        hiddenSinceLoad: !everVisible,
        userInteracted: userInteracted,
        pauses: pauseCount,
        maxPauses: 5, // bounded: a page that keeps calling play() can't trap us
      });
      if (pause) {
        pauseCount++;
        v.pause();
        log("autoplay prevented");
      }
    } catch (err) {
      log("play handler failed", err);
    }
  }

  function clearPageEffects() {
    F.PAGE_CLASSES.forEach(function (c) {
      root.classList.remove(c.cls);
    });
    var p = getPlayer();
    var v = tracked || (p && getVideoOf(p));
    if (v && v.style) v.style.removeProperty("filter");
  }

  // ---- keyboard shortcuts (off by default) ---------------------------------------------------

  function isTypingTarget(e) {
    var t = (e.composedPath && e.composedPath()[0]) || e.target;
    if (!t || !t.tagName) return false;
    var n = t.tagName;
    return n === "INPUT" || n === "TEXTAREA" || n === "SELECT" || t.isContentEditable === true;
  }

  function onKeyDown(e) {
    try {
      if (!CFG.enabled || !CFG.shortcutsEnabled) return;
      // Leave every browser/YouTube combination (Cmd+, Ctrl+, Alt+) alone.
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      var action = S.matchShortcut(CFG, e.key);
      if (!action || isTypingTarget(e) || isShortsPage()) return;
      var player = getPlayer();
      var video = player && getVideoOf(player);
      if (!video || isAdShowing(player)) return;
      swallow(e);
      speedAction(action);
    } catch (err) {
      log("keydown failed", err);
    }
  }

  // "up" | "down" | "reset": shared by the keyboard shortcuts and the bar.
  function speedAction(action) {
    if (!CFG.enabled || isShortsPage()) return;
    var player = getPlayer();
    var video = player && getVideoOf(player);
    if (!video || isAdShowing(player)) return; // never touch ad speed
    var next =
      action === "reset"
        ? G.resetSpeed(CFG)
        : G.stepSpeed(video.playbackRate, action === "up" ? 1 : -1, CFG);
    setSpeed(video, next, true);
  }

  // ---- settings from storage ------------------------------------------------------------------

  function applySettings(v) {
    try {
      mapSettings(v);
      DEBUG = !!v.debug;
      if (!CFG.enabled) {
        IND.remove();
        gesture = null;
        wheel = null;
      }
      if (CFG.rememberSpeed && sessionSpeed === null) sessionSpeed = readStored();
      applyPageClasses();
      applyFilters();
      refreshBar();
    } catch (err) {
      log("applySettings failed", err);
    }
  }

  var api = typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : null;
  var unsubscribeSettings = function () {};

  // ---- control bar below the player -------------------------------------------------------------

  function openSettings() {
    try {
      var r = api && api.runtime && api.runtime.sendMessage({ type: "yte:open-options" });
      if (r && r.catch) r.catch(function () {});
    } catch (err) {
      /* ignore */
    }
  }

  var bar = BAR.create({
    getValues: function () {
      return CFG;
    },
    getPlayer: getPlayer,
    getVideo: function () {
      var p = getPlayer();
      return p ? getVideoOf(p) : null;
    },
    isAd: function () {
      return isAdShowing(getPlayer());
    },
    getVideoId: function () {
      return P.videoIdFromLocation(location.pathname, location.search);
    },
    speedAction: speedAction,
    toggleFilters: function () {
      S.save(api, { filtersEnabled: !CFG.filtersEnabled }).catch(function () {});
    },
    openSettings: openSettings,
    log: log,
  });

  function refreshBar() {
    try {
      if (CFG.enabled) bar.mount();
      else bar.unmount();
    } catch (err) {
      log("refreshBar failed", err);
    }
  }

  // ---- listener registration / teardown --------------------------------------------------------

  var CAPTURE_PASSIVE = { capture: true, passive: true };
  var CAPTURE_ACTIVE = { capture: true, passive: false };
  var registered = [];

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    registered.push([target, type, fn, opts]);
  }

  function teardown() {
    for (var i = 0; i < registered.length; i++) {
      var r = registered[i];
      try {
        r[0].removeEventListener(r[1], r[2], r[3]);
      } catch (err) {
        /* ignore */
      }
    }
    registered = [];
    stopObserver();
    detach();
    IND.remove();
    unsubscribeSettings();
    bar.destroy();
    clearPageEffects();
    [expectedTimer, reapplyTimer, syncTimer].forEach(function (t) {
      if (t !== null) clearTimeout(t);
    });
    expectedTimer = reapplyTimer = syncTimer = null;
    gesture = null;
    wheel = null;
    window.__YTE_ACTIVE__ = false;
  }

  on(document, "pointermove", onPointerMove, CAPTURE_PASSIVE);
  on(document, "mousemove", onPointerMove, CAPTURE_PASSIVE);
  on(root, "mouseleave", onPointerGone, PASSIVE);
  on(window, "blur", onPointerGone, PASSIVE);

  on(document, "gesturestart", onGestureStart, CAPTURE_ACTIVE);
  on(document, "gesturechange", onGestureChange, CAPTURE_ACTIVE);
  on(document, "gestureend", onGestureEnd, CAPTURE_ACTIVE);
  on(document, "wheel", onWheel, CAPTURE_ACTIVE);
  on(document, "keydown", onKeyDown, CAPTURE_ACTIVE);
  on(document, "pointerdown", onUserEvent, CAPTURE_PASSIVE);
  on(document, "keydown", onUserEvent, CAPTURE_PASSIVE);
  on(document, "visibilitychange", onVisibility, PASSIVE);

  // YouTube's SPA navigation. Listening on window (capture) also catches
  // events dispatched on document or on any element below it.
  on(window, "yt-navigate-start", onNavigateStart, CAPTURE_PASSIVE);
  on(window, "yt-navigate-finish", onNavigateDone, CAPTURE_PASSIVE);
  on(window, "popstate", onNavigateDone, PASSIVE);

  // A page restored from the back/forward cache keeps its listeners, so only
  // tear down when the page is really going away.
  on(
    window,
    "pagehide",
    function (e) {
      if (!e.persisted) teardown();
    },
    PASSIVE
  );

  S.load(api).then(applySettings, function () {});
  unsubscribeSettings = S.onChange(api, applySettings);

  watch();
})();
