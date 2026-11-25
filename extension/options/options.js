// Options page: built from the schema in settings.js, so a setting is only
// ever declared once. Every change is saved immediately (no Save button).
(function () {
  "use strict";
  var S = window.YTE_Settings;
  var api = typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : null;
  var controls = {}; // key -> { set(value) }
  var statusEl = document.getElementById("status");
  var statusTimer = null;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function flash(msg) {
    statusEl.textContent = msg;
    statusEl.classList.add("show");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () {
      statusEl.classList.remove("show");
    }, 1400);
  }

  function pushAll(values) {
    Object.keys(controls).forEach(function (k) {
      controls[k].set(values[k]);
    });
  }

  function commit(patch) {
    S.save(api, patch).then(
      function (values) {
        pushAll(values); // show what was actually stored (e.g. clamped)
        flash("Saved");
      },
      function () {
        flash("Could not save");
      }
    );
  }

  function buildBool(f) {
    var wrap = el("label", "switch");
    var input = el("input");
    input.type = "checkbox";
    input.setAttribute("aria-label", f.label);
    var track = el("span", "track");
    wrap.appendChild(input);
    wrap.appendChild(track);
    input.addEventListener("change", function () {
      var patch = {};
      patch[f.key] = input.checked;
      commit(patch);
    });
    controls[f.key] = { set: function (v) { input.checked = !!v; } };
    return wrap;
  }

  function buildNumber(f) {
    var box = el("span", "control");
    var input = el("input");
    input.type = "number";
    input.min = String(f.min);
    input.max = String(f.max);
    input.step = String(f.inc || "any");
    input.setAttribute("aria-label", f.label);
    box.appendChild(input);
    if (f.unit) box.appendChild(el("span", "unit", f.unit));
    input.addEventListener("change", function () {
      var n = parseFloat(input.value);
      var patch = {};
      patch[f.key] = n; // NaN is rejected by sanitize() -> default
      commit(patch);
    });
    controls[f.key] = { set: function (v) { input.value = String(v); } };
    return box;
  }

  function buildKey(f) {
    var input = el("input", "keybox");
    input.type = "text";
    input.readOnly = true;
    input.placeholder = "none";
    input.setAttribute("aria-label", f.label + " (click, then press a key)");
    input.addEventListener("keydown", function (e) {
      if (e.key === "Tab") return; // keep keyboard navigation
      e.preventDefault();
      var patch = {};
      if (e.key === "Backspace" || e.key === "Delete") {
        patch[f.key] = "";
      } else if (e.key === "Escape") {
        input.blur();
        return;
      } else if (e.metaKey || e.ctrlKey || e.altKey || !S.isValidKey(e.key)) {
        flash("That key can't be used");
        return;
      } else {
        patch[f.key] = e.key;
      }
      commit(patch);
    });
    controls[f.key] = { set: function (v) { input.value = v; } };
    return input;
  }

  function buildRow(f) {
    var row = el("div", "row");
    var text = el("div", "text");
    text.appendChild(el("div", "label", f.label));
    if (f.help) text.appendChild(el("div", "help", f.help));
    row.appendChild(text);
    var control = f.type === "bool" ? buildBool(f) : f.type === "number" ? buildNumber(f) : buildKey(f);
    row.appendChild(control);
    return row;
  }

  function build() {
    var host = document.getElementById("groups");
    S.GROUPS.forEach(function (g) {
      var fields = S.FIELDS.filter(function (f) { return f.group === g.id; });
      if (!fields.length) return;
      var section = el("section");
      section.appendChild(el("h2", "", g.title));
      var card = el("div", "card");
      fields.forEach(function (f) { card.appendChild(buildRow(f)); });
      section.appendChild(card);
      host.appendChild(section);
    });
  }

  // Two-step reset so a stray click can't wipe settings.
  var resetBtn = document.getElementById("reset");
  var resetTimer = null;
  resetBtn.addEventListener("click", function () {
    if (!resetBtn.classList.contains("primary")) {
      resetBtn.classList.add("primary");
      resetBtn.textContent = "Click again to confirm";
      resetTimer = setTimeout(resetLabel, 3000);
      return;
    }
    resetLabel();
    commit(S.defaults());
  });
  function resetLabel() {
    clearTimeout(resetTimer);
    resetBtn.classList.remove("primary");
    resetBtn.textContent = "Reset all to defaults";
  }

  build();
  pushAll(S.defaults()); // sensible first paint
  S.ensureStored(api).then(pushAll, function () {});
  S.onChange(api, pushAll); // stay in sync with the popup / other windows
})();
