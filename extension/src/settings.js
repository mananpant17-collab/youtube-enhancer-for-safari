// Settings: schema, defaults, validation, versioned migration, and thin
// browser.storage.local helpers. Shared by the content script, the popup and
// the options page. The schema (FIELDS) also drives the options page UI, so a
// setting is declared exactly once.
//
// Stored shape (under the "settings" key of storage.local):
//   { schemaVersion: <int>, values: { <key>: <value>, ... } }
//
// Everything read from storage goes through sanitize(): wrong types, unknown
// keys and out-of-range numbers can never reach the rest of the code.
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.YTE_Settings = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SCHEMA_VERSION = 1;
  var STORAGE_KEY = "settings";

  var GROUPS = [
    { id: "general", title: "General" },
    { id: "speed", title: "Playback speed" },
    { id: "display", title: "Display" },
    { id: "controlbar", title: "Control bar" },
    { id: "page", title: "Page layout" },
    { id: "player", title: "Player" },
    { id: "filters", title: "Video filters" },
    { id: "keyboard", title: "Keyboard shortcuts" },
    { id: "advanced", title: "Advanced" },
  ];

  // type: "bool" | "number" | "key"
  var FIELDS = [
    { key: "enabled", type: "bool", def: true, group: "general",
      label: "Enable YouTube Enhancer",
      help: "Master switch. When off, the extension does nothing on YouTube." },

    { key: "pinchEnabled", type: "bool", def: true, group: "speed",
      label: "Pinch to change speed",
      help: "While the cursor is over the player, pinch out to speed up and pinch in to slow down. Pinching anywhere else behaves normally." },
    { key: "ctrlWheelEnabled", type: "bool", def: true, group: "speed",
      label: "Ctrl + scroll wheel changes speed",
      help: "Hold Ctrl and scroll over the player (for mice and other input devices)." },
    { key: "step", type: "number", def: 0.25, min: 0.05, max: 1, inc: 0.05, unit: "×", group: "speed",
      label: "Speed step", help: "How much one step changes the speed." },
    { key: "threshold", type: "number", def: 0.15, min: 0.05, max: 0.6, inc: 0.01, group: "speed",
      label: "Pinch distance per step",
      help: "Smaller values make the pinch more sensitive; larger values need a bigger pinch per step." },
    { key: "minSpeed", type: "number", def: 0.25, min: 0.0625, max: 16, inc: 0.25, unit: "×", group: "speed",
      label: "Slowest speed" },
    { key: "maxSpeed", type: "number", def: 4, min: 0.0625, max: 16, inc: 0.25, unit: "×", group: "speed",
      label: "Fastest speed" },
    { key: "rememberSpeed", type: "bool", def: true, group: "speed",
      label: "Remember speed between videos",
      help: "On: keep your speed for the rest of this tab's session. Off: reset to 1× on each new video." },

    { key: "indicatorEnabled", type: "bool", def: true, group: "display",
      label: "Show speed indicator",
      help: "A small \"1.75×\" label over the player when the speed changes." },

    { key: "controlBarEnabled", type: "bool", def: true, group: "controlbar",
      label: "Show the control bar below the player",
      help: "A row of buttons under the video. Choose which buttons appear below." },
    { key: "barSpeed", type: "bool", def: true, group: "controlbar", label: "Speed \u2212 / + buttons" },
    { key: "barLoop", type: "bool", def: true, group: "controlbar", label: "Loop" },
    { key: "barCinema", type: "bool", def: true, group: "controlbar", label: "Cinema mode",
      help: "Dims everything except the player and the control bar." },
    { key: "barSize", type: "bool", def: true, group: "controlbar", label: "Theater mode" },
    { key: "barScreenshot", type: "bool", def: true, group: "controlbar", label: "Screenshot" },
    { key: "barPip", type: "bool", def: true, group: "controlbar", label: "Picture in Picture" },
    { key: "barFlip", type: "bool", def: true, group: "controlbar", label: "Flip horizontally / vertically" },
    { key: "barFilters", type: "bool", def: true, group: "controlbar", label: "Video filters on/off" },
    { key: "barSettings", type: "bool", def: true, group: "controlbar", label: "Settings shortcut" },

    { key: "hideShorts", type: "bool", def: false, group: "page", label: "Hide Shorts",
      help: "Hides Shorts shelves, Shorts in video lists, the Shorts sidebar entry and the channel Shorts tab. CSS only: nothing is removed, so scrolling and search keep loading normally." },
    { key: "hideComments", type: "bool", def: false, group: "page", label: "Hide comments",
      help: "Hidden with CSS only; nothing is removed from the page." },
    { key: "hideRelated", type: "bool", def: false, group: "page", label: "Hide related videos" },
    { key: "hideChat", type: "bool", def: false, group: "page", label: "Hide live chat" },
    { key: "hideCards", type: "bool", def: false, group: "page", label: "Hide info cards and end screens" },

    { key: "autoTheater", type: "bool", def: false, group: "player", label: "Automatically use theater mode" },
    { key: "preventAutoplayBackground", type: "bool", def: false, group: "player",
      label: "Don't autoplay videos opened in background tabs",
      help: "A video that starts in a tab you haven't looked at yet is paused. Press play when you get there." },
    { key: "preventAutoplayForeground", type: "bool", def: false, group: "player",
      label: "Don't autoplay the first video of a page load",
      help: "When a YouTube page loads and you haven't clicked or pressed a key yet, the video starts paused." },

    { key: "filtersEnabled", type: "bool", def: false, group: "filters", label: "Apply video filters",
      help: "Also togglable from the control bar. Sliders below set how strong each filter is." },
    { key: "filterBrightness", type: "number", def: 100, min: 0, max: 300, inc: 5, unit: "%", group: "filters", label: "Brightness" },
    { key: "filterContrast", type: "number", def: 100, min: 0, max: 300, inc: 5, unit: "%", group: "filters", label: "Contrast" },
    { key: "filterSaturation", type: "number", def: 100, min: 0, max: 300, inc: 5, unit: "%", group: "filters", label: "Saturation" },
    { key: "filterSepia", type: "number", def: 0, min: 0, max: 100, inc: 5, unit: "%", group: "filters", label: "Sepia" },
    { key: "filterGrayscale", type: "number", def: 0, min: 0, max: 100, inc: 5, unit: "%", group: "filters", label: "Grayscale" },
    { key: "filterHue", type: "number", def: 0, min: 0, max: 360, inc: 5, unit: "\u00b0", group: "filters", label: "Hue rotation" },

    { key: "shortcutsEnabled", type: "bool", def: false, group: "keyboard",
      label: "Enable speed keyboard shortcuts",
      help: "Off by default so nothing clashes with YouTube's own keys (such as < and >)." },
    { key: "keySpeedUp", type: "key", def: "]", group: "keyboard", label: "Increase speed",
      help: "Click the box and press a key. Backspace clears it." },
    { key: "keySpeedDown", type: "key", def: "[", group: "keyboard", label: "Decrease speed" },
    { key: "keySpeedReset", type: "key", def: "\\", group: "keyboard", label: "Reset to 1×" },

    { key: "debug", type: "bool", def: false, group: "advanced",
      label: "Debug logging",
      help: "Prints [YTE] messages to Safari's Web Inspector console." },
  ];

  var NAMED_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"];

  function isNum(v) {
    return typeof v === "number" && isFinite(v);
  }

  function isValidKey(v) {
    if (v === "") return true; // unbound
    if (typeof v !== "string") return false;
    if (v.length === 1) return !/\s/.test(v);
    return NAMED_KEYS.indexOf(v) !== -1;
  }

  function defaults() {
    var d = {};
    for (var i = 0; i < FIELDS.length; i++) d[FIELDS[i].key] = FIELDS[i].def;
    return d;
  }

  function sanitize(input) {
    var src = input && typeof input === "object" ? input : {};
    var out = {};
    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i];
      var v = src[f.key];
      if (f.type === "bool") {
        out[f.key] = typeof v === "boolean" ? v : f.def;
      } else if (f.type === "number") {
        out[f.key] = isNum(v) ? Math.min(f.max, Math.max(f.min, v)) : f.def;
      } else {
        out[f.key] = isValidKey(v) ? v : f.def;
      }
    }
    if (out.minSpeed > out.maxSpeed) {
      var t = out.minSpeed;
      out.minSpeed = out.maxSpeed;
      out.maxSpeed = t;
    }
    // One key can't do two things: later duplicates become unbound.
    var used = {};
    ["keySpeedUp", "keySpeedDown", "keySpeedReset"].forEach(function (k) {
      if (out[k] !== "" && used[out[k]]) out[k] = "";
      if (out[k] !== "") used[out[k]] = true;
    });
    return out;
  }

  // Migrations run in order: MIGRATIONS[n] upgrades values from schema n to
  // n+1. None exist yet (the schema is at version 1); this is where a future
  // rename/reshape goes so existing users keep their settings.
  var MIGRATIONS = {};

  function migrate(raw, migrations) {
    var ver = 0;
    var vals = {};
    if (raw && typeof raw === "object") {
      if (typeof raw.schemaVersion === "number" && raw.schemaVersion >= 0 && raw.schemaVersion % 1 === 0) {
        ver = raw.schemaVersion;
      }
      if (raw.values && typeof raw.values === "object") vals = raw.values;
    }
    var m = migrations || MIGRATIONS;
    for (; ver < SCHEMA_VERSION; ver++) {
      var fn = m[ver];
      if (typeof fn === "function") {
        try {
          vals = fn(vals) || vals;
        } catch (err) {
          /* a bad migration must not lose everything: keep going */
        }
      }
    }
    return { schemaVersion: SCHEMA_VERSION, values: sanitize(vals) };
  }

  // "1.0.0" style key bindings: which action does this keydown's `key` mean?
  function matchShortcut(values, key) {
    if (typeof key !== "string" || key === "" || !values) return null;
    if (values.keySpeedUp === key) return "up";
    if (values.keySpeedDown === key) return "down";
    if (values.keySpeedReset === key) return "reset";
    return null;
  }

  // ---- storage helpers (promise based; Safari's `browser.*`) --------------------

  function area(api) {
    return api && api.storage && api.storage.local ? api.storage.local : null;
  }

  function load(api) {
    var a = area(api);
    if (!a) return Promise.resolve(defaults());
    return Promise.resolve(a.get(STORAGE_KEY)).then(
      function (res) {
        return migrate(res && res[STORAGE_KEY]).values;
      },
      function () {
        return defaults();
      }
    );
  }

  // Saves are serialized so two quick toggles can't read-modify-write over
  // each other.
  var queue = Promise.resolve();

  function save(api, patch) {
    var a = area(api);
    var run = function () {
      if (!a) return Promise.resolve(defaults());
      return Promise.resolve(a.get(STORAGE_KEY)).then(function (res) {
        var cur = migrate(res && res[STORAGE_KEY]).values;
        var next = migrate({ schemaVersion: SCHEMA_VERSION, values: Object.assign({}, cur, patch) });
        var o = {};
        o[STORAGE_KEY] = next;
        return Promise.resolve(a.set(o)).then(function () {
          return next.values;
        });
      });
    };
    var p = queue.then(run, run);
    queue = p.then(function () {}, function () {});
    return p;
  }

  // Rewrites storage into the current shape if it isn't already (first run,
  // after an upgrade). Safe to call any time.
  function ensureStored(api) {
    var a = area(api);
    if (!a) return Promise.resolve(defaults());
    return Promise.resolve(a.get(STORAGE_KEY)).then(function (res) {
      var raw = res && res[STORAGE_KEY];
      var next = migrate(raw);
      if (JSON.stringify(raw) === JSON.stringify(next)) return next.values;
      var o = {};
      o[STORAGE_KEY] = next;
      return Promise.resolve(a.set(o)).then(function () {
        return next.values;
      });
    });
  }

  // cb(values) whenever settings change anywhere. Returns an unsubscribe fn.
  function onChange(api, cb) {
    if (!api || !api.storage || !api.storage.onChanged) return function () {};
    var listener = function (changes, areaName) {
      try {
        if (areaName && areaName !== "local") return;
        if (!changes || !changes[STORAGE_KEY]) return;
        cb(migrate(changes[STORAGE_KEY].newValue).values);
      } catch (err) {
        /* never throw into the browser's event dispatch */
      }
    };
    api.storage.onChanged.addListener(listener);
    return function () {
      try {
        api.storage.onChanged.removeListener(listener);
      } catch (err) {
        /* ignore */
      }
    };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    STORAGE_KEY: STORAGE_KEY,
    GROUPS: GROUPS,
    FIELDS: FIELDS,
    NAMED_KEYS: NAMED_KEYS,
    defaults: defaults,
    sanitize: sanitize,
    migrate: migrate,
    isValidKey: isValidKey,
    matchShortcut: matchShortcut,
    load: load,
    save: save,
    ensureStored: ensureStored,
    onChange: onChange,
  };
});
