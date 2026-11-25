"use strict";
// A tiny fake browser page for running the content scripts in Node.
// It mirrors only what the scripts touch. It cannot prove real Safari
// behaviour; that needs the manual checklist.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = path.join(__dirname, "..", "..", "extension", "src");
const SCRIPTS = [
  path.join(SRC, "settings.js"),
  path.join(SRC, "gesture-speed.js"),
  path.join(SRC, "speed-policy.js"),
  path.join(SRC, "features.js"),
  path.join(SRC, "bar-logic.js"),
  path.join(SRC, "indicator.js"),
  path.join(__dirname, "bar-stub.js"), // not the real controlbar.js
  path.join(SRC, "content.js"),
];

function makePage(opts = {}) {
  // ---- clock + timers --------------------------------------------------------
  let now = 1_000_000;
  let nextId = 1;
  const timers = new Map();
  const setTimeout_ = (fn, ms) => {
    const id = nextId++;
    timers.set(id, { fn, at: now + (ms || 0) });
    return id;
  };
  const clearTimeout_ = (id) => timers.delete(id);
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      let best = null;
      for (const [id, t] of timers) if (t.at <= end && (!best || t.at < best[1].at)) best = [id, t];
      if (!best) break;
      timers.delete(best[0]);
      now = Math.max(now, best[1].at);
      best[1].fn();
    }
    now = end;
  }

  // ---- listeners -------------------------------------------------------------
  const listeners = {};
  const optsByType = {};
  const add = (type, fn, o) => {
    (listeners[type] = listeners[type] || []).push(fn);
    (optsByType[type] = optsByType[type] || []).push(o);
  };
  const remove = (type, fn) => {
    const l = listeners[type] || [];
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  };
  function activeListenerCount() {
    return Object.values(listeners).reduce((n, l) => n + l.length, 0);
  }

  // ---- video + player ----------------------------------------------------------
  function makeVideo(rate = 1) {
    const vl = {};
    let r = rate;
    const v = {
      isConnected: true,
      readyState: opts.videoReady ? 4 : 0,
      writes: 0,
      pauses: 0,
      pause: () => v.pauses++,
      style: {
        props: {},
        setProperty(k, val) {
          this.props[k] = val;
        },
        removeProperty(k) {
          delete this.props[k];
        },
      },
      get playbackRate() {
        return r;
      },
      set playbackRate(x) {
        r = x;
        v.writes++;
      },
      addEventListener: (t, fn) => (vl[t] = vl[t] || []).push(fn),
      removeEventListener: (t, fn) => {
        const l = vl[t] || [];
        const i = l.indexOf(fn);
        if (i >= 0) l.splice(i, 1);
      },
      fire: (t) => (vl[t] || []).slice().forEach((fn) => fn({})),
      listenerCount: () => Object.values(vl).reduce((n, l) => n + l.length, 0),
    };
    return v;
  }

  let video = makeVideo(opts.rate || 1);
  let theater = !!opts.theater;
  const sizeBtn = { clicks: 0, click: () => (sizeBtn.clicks++, (theater = !theater)) };
  const flexy = { hasAttribute: (a) => a === "theater" && theater };
  let hidden = !!opts.hidden;
  const classes = new Set(opts.ad ? ["ad-showing"] : []);
  const children = [];
  const player = {
    isConnected: true,
    classList: { contains: (c) => classes.has(c) },
    querySelector: (sel) => (sel === ".ytp-size-button" ? (opts.noSizeButton ? null : sizeBtn) : opts.noVideo ? null : video),
    getBoundingClientRect: () => ({ left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300 }),
    appendChild(c) {
      c.parentNode = player;
      children.push(c);
      return c;
    },
    removeChild(c) {
      const i = children.indexOf(c);
      if (i >= 0) children.splice(i, 1);
      c.parentNode = null;
    },
  };
  let playerPresent = !opts.noPlayer;

  // ---- mutation observers ----------------------------------------------------------
  const observers = [];
  class FakeMO {
    constructor(cb) {
      this.cb = cb;
      this.active = false;
      this.target = null;
      observers.push(this);
    }
    observe(t) {
      this.active = true;
      this.target = t;
    }
    disconnect() {
      this.active = false;
    }
  }

  // ---- storage -----------------------------------------------------------------------
  const store = new Map(opts.storage ? Object.entries(opts.storage) : []);
  const sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  // ---- browser.storage.local ---------------------------------------------------------
  const storageData = {};
  if (opts.settings) storageData.settings = { schemaVersion: 1, values: opts.settings };
  if (opts.rawSettings !== undefined) storageData.settings = opts.rawSettings;
  const changeListeners = [];
  const messages = [];
  const browserApi = {
    runtime: { sendMessage: (m) => (messages.push(m), Promise.resolve()) },
    storage: {
      local: {
        get: (k) => Promise.resolve(k in storageData ? { [k]: storageData[k] } : {}),
        set: (o) => {
          const changes = {};
          for (const k of Object.keys(o)) {
            changes[k] = { oldValue: storageData[k], newValue: o[k] };
            storageData[k] = o[k];
          }
          changeListeners.slice().forEach((fn) => fn(changes, "local"));
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener: (fn) => changeListeners.push(fn),
        removeListener: (fn) => {
          const i = changeListeners.indexOf(fn);
          if (i >= 0) changeListeners.splice(i, 1);
        },
      },
    },
  };

  const classSet = new Set();
  const rootEl = {
    setAttribute() {},
    addEventListener: add,
    removeEventListener: remove,
    classList: {
      toggle: (c, force) => (force ? classSet.add(c) : classSet.delete(c), classSet.has(c)),
      add: (c) => classSet.add(c),
      remove: (c) => classSet.delete(c),
      contains: (c) => classSet.has(c),
    },
  };
  const doc = {
    documentElement: rootEl,
    getElementById: (id) => (id === "movie_player" && playerPresent ? player : null),
    querySelector: (sel) => (sel === "ytd-watch-flexy" ? flexy : null),
    get hidden() {
      return hidden;
    },
    createElement: () => {
      const el = { style: {}, attrs: {}, parentNode: null, textContent: "" };
      el.setAttribute = (k, v) => (el.attrs[k] = v);
      return el;
    },
    addEventListener: add,
    removeEventListener: remove,
  };
  const location = { pathname: opts.path || "/watch", search: opts.search || "?v=aaaaaaaaaaa" };
  const sandbox = {
    document: doc,
    addEventListener: add,
    removeEventListener: remove,
    location,
    sessionStorage,
    console: { log() {} },
    setTimeout: setTimeout_,
    clearTimeout: clearTimeout_,
    MutationObserver: FakeMO,
    Date: { now: () => now },
    Math,
    Number,
    String,
    isFinite,
    RegExp,
  };
  if (!opts.noBrowser) sandbox.browser = browserApi;
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of SCRIPTS) vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: path.basename(f) });

  function fire(type, props = {}) {
    const ev = Object.assign({ prevented: false, stopped: false }, props);
    ev.preventDefault = () => (ev.prevented = true);
    ev.stopPropagation = () => (ev.stopped = true);
    for (const fn of (listeners[type] || []).slice()) fn(ev);
    return ev;
  }

  return {
    get video() {
      return video;
    },
    fire,
    listeners,
    optsByType,
    observers,
    advance,
    store,
    location,
    classes,
    children,
    pendingTimers: () => timers.size,
    activeListenerCount,
    activeObservers: () => observers.filter((o) => o.active),
    setPlayerPresent: (b) => (playerPresent = b),
    replaceVideo: (rate = 1) => (video = makeVideo(rate)),
    makeVideo,
    time: () => now,
    // settings helpers
    settled: () => new Promise((r) => setImmediate(r)),
    setSettings: (values) => browserApi.storage.local.set({ settings: { schemaVersion: 1, values } }),
    changeListenerCount: () => changeListeners.length,
    messages,
    bar: () => sandbox.__bar,
    sizeBtn,
    htmlClasses: () => [...classSet].sort(),
    setHidden: (b) => (hidden = b),
  };
}

module.exports = { makePage };
