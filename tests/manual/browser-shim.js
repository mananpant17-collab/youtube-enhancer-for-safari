// Dev-only stand-in for Safari's `browser` API (localStorage-backed), so the
// options page and popup can be previewed in an ordinary browser tab.
(function () {
  "use strict";
  var KEY = "__yte_preview_storage";
  var listeners = [];
  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; }
  }
  function emit(changes) {
    listeners.slice().forEach(function (f) { f(changes, "local"); });
  }
  window.addEventListener("storage", function (e) {
    if (e.key !== KEY) return;
    var o = {}, n = {};
    try { o = JSON.parse(e.oldValue || "{}"); n = JSON.parse(e.newValue || "{}"); } catch (x) { /* ignore */ }
    if (JSON.stringify(o.settings) !== JSON.stringify(n.settings)) {
      emit({ settings: { oldValue: o.settings, newValue: n.settings } });
    }
  });
  window.browser = {
    storage: {
      local: {
        get: function (k) { var d = read(), r = {}; if (k in d) r[k] = d[k]; return Promise.resolve(r); },
        set: function (o) {
          var d = read(), ch = {};
          Object.keys(o).forEach(function (k) { ch[k] = { oldValue: d[k], newValue: o[k] }; d[k] = o[k]; });
          localStorage.setItem(KEY, JSON.stringify(d));
          emit(ch);
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener: function (f) { listeners.push(f); },
        removeListener: function (f) { var i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); },
      },
    },
    runtime: {
      openOptionsPage: function () { window.open("/options/options.html", "_blank"); return Promise.resolve(); },
      getURL: function (p) { return "/" + p; },
    },
    tabs: { create: function (o) { window.open(o.url); } },
  };
})();
