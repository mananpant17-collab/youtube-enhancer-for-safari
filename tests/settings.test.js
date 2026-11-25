"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../extension/src/settings.js");

test("defaults are valid and stable under sanitize", () => {
  const d = S.defaults();
  assert.deepEqual(S.sanitize(d), d);
  assert.equal(d.enabled, true);
  assert.equal(d.shortcutsEnabled, false, "shortcuts are off by default");
  assert.equal(d.rememberSpeed, true, "default: remember speed");
  assert.equal(d.step, 0.25);
  assert.equal(d.minSpeed, 0.25);
  assert.equal(d.maxSpeed, 4);
});

test("every field belongs to a group and has a sane definition", () => {
  const groups = new Set(S.GROUPS.map((g) => g.id));
  const keys = new Set();
  for (const f of S.FIELDS) {
    assert.ok(groups.has(f.group), f.key);
    assert.ok(!keys.has(f.key), "duplicate key " + f.key);
    keys.add(f.key);
    assert.ok(f.label, f.key);
    assert.ok(["bool", "number", "key"].includes(f.type), f.key);
    if (f.type === "number") assert.ok(f.def >= f.min && f.def <= f.max, f.key);
  }
});

test("sanitize: wrong types fall back to defaults", () => {
  const out = S.sanitize({ enabled: "yes", step: "0.5", pinchEnabled: 1, keySpeedUp: 5, debug: null });
  const d = S.defaults();
  assert.equal(out.enabled, d.enabled);
  assert.equal(out.step, d.step);
  assert.equal(out.pinchEnabled, d.pinchEnabled);
  assert.equal(out.keySpeedUp, d.keySpeedUp);
  assert.equal(out.debug, d.debug);
});

test("sanitize: garbage input of every shape yields the defaults", () => {
  for (const bad of [null, undefined, 5, "str", [], true, NaN]) {
    assert.deepEqual(S.sanitize(bad), S.defaults());
  }
});

test("sanitize: unknown keys are dropped", () => {
  const out = S.sanitize({ evil: 1, __proto__: { x: 1 }, step: 0.5 });
  assert.equal(out.evil, undefined);
  assert.equal(out.step, 0.5);
  assert.deepEqual(Object.keys(out).sort(), S.FIELDS.map((f) => f.key).sort());
});

test("sanitize: numbers are clamped; NaN/Infinity rejected", () => {
  assert.equal(S.sanitize({ step: 99 }).step, 1);
  assert.equal(S.sanitize({ step: -5 }).step, 0.05);
  assert.equal(S.sanitize({ step: NaN }).step, 0.25);
  assert.equal(S.sanitize({ step: Infinity }).step, 0.25);
  assert.equal(S.sanitize({ maxSpeed: 1000 }).maxSpeed, 16);
  assert.equal(S.sanitize({ minSpeed: 0 }).minSpeed, 0.0625);
  assert.equal(S.sanitize({ threshold: 0 }).threshold, 0.05);
});

test("sanitize: min > max is swapped", () => {
  const out = S.sanitize({ minSpeed: 8, maxSpeed: 2 });
  assert.equal(out.minSpeed, 2);
  assert.equal(out.maxSpeed, 8);
});

test("keys: valid single chars, named keys, and empty are accepted; others rejected", () => {
  for (const ok of ["]", "a", "7", "ArrowUp", "PageDown", ""]) assert.equal(S.isValidKey(ok), true, ok);
  for (const bad of [" ", "ab", "Enter", "Escape", "Tab", "\t", null, 5, undefined]) {
    assert.equal(S.isValidKey(bad), false, String(bad));
  }
  assert.equal(S.sanitize({ keySpeedUp: "Enter" }).keySpeedUp, "]");
});

test("keys: one key can't be bound twice (later duplicates are unbound)", () => {
  const out = S.sanitize({ keySpeedUp: "x", keySpeedDown: "x", keySpeedReset: "x" });
  assert.equal(out.keySpeedUp, "x");
  assert.equal(out.keySpeedDown, "");
  assert.equal(out.keySpeedReset, "");
});

test("matchShortcut", () => {
  const v = S.defaults();
  assert.equal(S.matchShortcut(v, "]"), "up");
  assert.equal(S.matchShortcut(v, "["), "down");
  assert.equal(S.matchShortcut(v, "\\"), "reset");
  assert.equal(S.matchShortcut(v, ">"), null, "YouTube's own > is not ours");
  assert.equal(S.matchShortcut(v, "<"), null);
  assert.equal(S.matchShortcut({ ...v, keySpeedUp: "" }, ""), null, "unbound never matches");
  for (const bad of [undefined, null, 5, {}]) assert.equal(S.matchShortcut(v, bad), null);
  assert.equal(S.matchShortcut(null, "]"), null);
});

test("migrate: nothing stored => defaults at the current version", () => {
  for (const raw of [undefined, null, {}, "x", 5, []]) {
    const m = S.migrate(raw);
    assert.equal(m.schemaVersion, S.SCHEMA_VERSION);
    assert.deepEqual(m.values, S.defaults());
  }
});

test("migrate: current data is kept and sanitized", () => {
  const m = S.migrate({ schemaVersion: S.SCHEMA_VERSION, values: { step: 0.5, enabled: "no" } });
  assert.equal(m.values.step, 0.5);
  assert.equal(m.values.enabled, true);
});

test("migrate: runs registered migrations in order, once each", () => {
  const calls = [];
  // pretend the schema moved on; MIGRATIONS[n] upgrades n -> n+1
  const migrations = {
    0: (v) => (calls.push(0), { ...v, step: 0.5 }),
    1: (v) => (calls.push(1), v),
  };
  const m = S.migrate({ schemaVersion: 0, values: { step: 0.1 } }, migrations);
  assert.deepEqual(calls, [0]); // current schema is 1: only 0->1 applies
  assert.equal(m.values.step, 0.5);
  assert.equal(m.schemaVersion, 1);
});

test("migrate: a throwing migration does not lose the other settings", () => {
  const m = S.migrate({ schemaVersion: 0, values: { step: 0.5 } }, { 0: () => { throw new Error("boom"); } });
  assert.equal(m.values.step, 0.5);
});

test("migrate: data from a newer version is sanitized, not trusted", () => {
  const m = S.migrate({ schemaVersion: 99, values: { step: 0.5, futureThing: true } });
  assert.equal(m.values.step, 0.5);
  assert.equal(m.values.futureThing, undefined);
  assert.equal(m.schemaVersion, S.SCHEMA_VERSION);
});

function fakeApi(initial) {
  const data = initial ? { settings: initial } : {};
  const listeners = [];
  return {
    data,
    listeners,
    storage: {
      local: {
        get: async (k) => (k in data ? { [k]: data[k] } : {}),
        set: async (o) => {
          const changes = {};
          for (const k of Object.keys(o)) {
            changes[k] = { newValue: o[k] };
            data[k] = o[k];
          }
          listeners.slice().forEach((fn) => fn(changes, "local"));
        },
      },
      onChanged: {
        addListener: (fn) => listeners.push(fn),
        removeListener: (fn) => listeners.splice(listeners.indexOf(fn), 1),
      },
    },
  };
}

test("load: empty storage gives defaults; broken storage gives defaults", async () => {
  assert.deepEqual(await S.load(fakeApi()), S.defaults());
  assert.deepEqual(await S.load(null), S.defaults());
  const failing = { storage: { local: { get: async () => { throw new Error("no"); } } } };
  assert.deepEqual(await S.load(failing), S.defaults());
});

test("save: merges a patch, sanitizes, and persists the versioned shape", async () => {
  const api = fakeApi();
  const v = await S.save(api, { step: 0.5, enabled: false, step2: 1 });
  assert.equal(v.step, 0.5);
  assert.equal(v.enabled, false);
  assert.equal(v.pinchEnabled, true, "other settings untouched");
  assert.deepEqual(Object.keys(api.data.settings), ["schemaVersion", "values"]);
  assert.equal(api.data.settings.schemaVersion, S.SCHEMA_VERSION);
  // garbage patches can't corrupt what is stored
  const v2 = await S.save(api, { step: "abc", maxSpeed: 1e9 });
  assert.equal(v2.step, 0.25);
  assert.equal(v2.maxSpeed, 16);
  assert.equal(v2.enabled, false, "earlier change preserved");
});

test("save: concurrent saves don't overwrite each other", async () => {
  const api = fakeApi();
  await Promise.all([
    S.save(api, { pinchEnabled: false }),
    S.save(api, { ctrlWheelEnabled: false }),
    S.save(api, { indicatorEnabled: false }),
  ]);
  const v = await S.load(api);
  assert.equal(v.pinchEnabled, false);
  assert.equal(v.ctrlWheelEnabled, false);
  assert.equal(v.indicatorEnabled, false);
});

test("ensureStored: writes the current shape once, then leaves it alone", async () => {
  const api = fakeApi();
  await S.ensureStored(api);
  assert.equal(api.data.settings.schemaVersion, S.SCHEMA_VERSION);
  let writes = 0;
  const orig = api.storage.local.set;
  api.storage.local.set = async (o) => (writes++, orig(o));
  await S.ensureStored(api);
  assert.equal(writes, 0);
});

test("onChange: delivers sanitized values, ignores other keys/areas, unsubscribes", async () => {
  const api = fakeApi();
  const got = [];
  const off = S.onChange(api, (v) => got.push(v));
  await api.storage.local.set({ other: 1 });
  assert.equal(got.length, 0);
  await S.save(api, { step: 0.5 });
  assert.equal(got.length, 1);
  assert.equal(got[0].step, 0.5);
  api.listeners[0]({ settings: { newValue: { schemaVersion: 1, values: { step: "x" } } } }, "sync");
  assert.equal(got.length, 1, "other area ignored");
  api.listeners[0]({ settings: { newValue: { schemaVersion: 1, values: { step: "x" } } } }, "local");
  assert.equal(got[1].step, 0.25, "garbage sanitized");
  off();
  assert.equal(api.listeners.length, 0);
});

test("onChange: a throwing callback never escapes into the browser", () => {
  const api = fakeApi();
  S.onChange(api, () => { throw new Error("x"); });
  assert.doesNotThrow(() => api.listeners[0]({ settings: { newValue: null } }, "local"));
});
