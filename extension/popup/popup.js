// Toolbar popup: quick on/off toggles. Same settings store as the options page.
(function () {
  "use strict";
  var S = window.YTE_Settings;
  var api = typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : null;
  var QUICK = ["enabled", "pinchEnabled", "ctrlWheelEnabled", "rememberSpeed", "indicatorEnabled", "controlBarEnabled", "hideShorts", "shortcutsEnabled"];
  var inputs = {};
  var statusEl = document.getElementById("status");
  var timer = null;

  function flash(msg) {
    statusEl.textContent = msg;
    statusEl.classList.add("show");
    clearTimeout(timer);
    timer = setTimeout(function () { statusEl.classList.remove("show"); }, 1200);
  }

  function pushAll(values) {
    QUICK.forEach(function (k) { if (inputs[k]) inputs[k].checked = !!values[k]; });
  }

  var host = document.getElementById("toggles");
  QUICK.forEach(function (key) {
    var f = S.FIELDS.filter(function (x) { return x.key === key; })[0];
    if (!f) return;
    var row = document.createElement("div");
    row.className = "row";
    var label = document.createElement("div");
    label.className = "label";
    label.textContent = f.label;
    var wrap = document.createElement("label");
    wrap.className = "switch";
    var input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("aria-label", f.label);
    var track = document.createElement("span");
    track.className = "track";
    wrap.appendChild(input);
    wrap.appendChild(track);
    input.addEventListener("change", function () {
      var patch = {};
      patch[key] = input.checked;
      S.save(api, patch).then(
        function (values) { pushAll(values); flash("Saved"); },
        function () { flash("Could not save"); }
      );
    });
    inputs[key] = input;
    row.appendChild(label);
    row.appendChild(wrap);
    host.appendChild(row);
  });

  document.getElementById("more").addEventListener("click", function () {
    try {
      var p = api.runtime.openOptionsPage();
      if (p && p.catch) p.catch(fallback);
    } catch (err) {
      fallback();
    }
    function fallback() {
      try { api.tabs.create({ url: api.runtime.getURL("options/options.html") }); } catch (e) { /* ignore */ }
    }
    window.close();
  });

  pushAll(S.defaults());
  S.load(api).then(pushAll, function () {});
  S.onChange(api, pushAll);
})();
