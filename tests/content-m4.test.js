"use strict";
// Content script + settings: live updates, each toggle, keyboard shortcuts.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makePage } = require("./helpers/fake-page.js");
const S = require("../extension/src/settings.js");

const IN = { clientX: 300, clientY: 250 };
const OUT = { clientX: 700, clientY: 600 };
const withSettings = (patch) => ({ ...S.defaults(), ...patch });

function pinch(p, scale = 1.4, pos = IN) {
  const s = p.fire("gesturestart", { ...pos, scale: 1 });
  const c = p.fire("gesturechange", { ...pos, scale });
  p.fire("gestureend", { ...pos, scale });
  return { s, c };
}
const key = (p, k, extra = {}) => p.fire("keydown", { key: k, target: { tagName: "BODY" }, ...extra });
const wheelIn = (p) => p.fire("wheel", { ...IN, ctrlKey: true, deltaY: -100, deltaMode: 0 });

test("master switch off: nothing is intercepted, nothing changes", async () => {
  const p = makePage({ settings: withSettings({ enabled: false, shortcutsEnabled: true }) });
  await p.settled();
  const { s, c } = pinch(p);
  assert.equal(s.prevented || c.prevented, false);
  assert.equal(wheelIn(p).prevented, false);
  assert.equal(key(p, "]").prevented, false);
  assert.equal(p.video.playbackRate, 1);
  assert.equal(p.children.length, 0);
});

test("pinch off: pinch is left to Safari but ctrl+wheel still works", async () => {
  const p = makePage({ settings: withSettings({ pinchEnabled: false }) });
  await p.settled();
  const { s, c } = pinch(p);
  assert.equal(s.prevented || c.prevented, false);
  assert.equal(p.video.playbackRate, 1);
  assert.ok(wheelIn(p).prevented);
  assert.equal(p.video.playbackRate, 1.25);
});

test("ctrl+wheel off: wheel is left alone but pinch works", async () => {
  const p = makePage({ settings: withSettings({ ctrlWheelEnabled: false }) });
  await p.settled();
  assert.equal(wheelIn(p).prevented, false);
  assert.equal(p.video.playbackRate, 1);
  pinch(p);
  assert.equal(p.video.playbackRate, 1.5);
});

test("indicator off: speed still changes, no label", async () => {
  const p = makePage({ settings: withSettings({ indicatorEnabled: false }) });
  await p.settled();
  pinch(p);
  assert.equal(p.video.playbackRate, 1.5);
  assert.equal(p.children.length, 0);
});

test("step / min / max settings are honoured", async () => {
  const p = makePage({ settings: withSettings({ step: 0.5, maxSpeed: 1.75 }) });
  await p.settled();
  pinch(p, 1.4); // 2 threshold-steps of 0.5 => 2.0, capped at 1.75
  assert.equal(p.video.playbackRate, 1.75);
  const q = makePage({ settings: withSettings({ minSpeed: 0.75 }), rate: 1 });
  await q.settled();
  pinch(q, 0.3);
  assert.equal(q.video.playbackRate, 0.75);
});

test("settings changes apply live, without a reload", async () => {
  const p = makePage();
  await p.settled();
  pinch(p);
  assert.equal(p.video.playbackRate, 1.5);

  await p.setSettings(withSettings({ enabled: false }));
  assert.equal(p.children.length, 0, "indicator removed when disabled");
  const off = pinch(p, 1.4);
  assert.equal(off.s.prevented, false);

  await p.setSettings(withSettings({ enabled: true }));
  const on = pinch(p, 1.4);
  assert.ok(on.s.prevented);
  assert.equal(p.video.playbackRate, 2);
});

test("garbage settings in storage fall back to defaults", async () => {
  for (const raw of [
    { schemaVersion: 1, values: { enabled: "no", step: "x", pinchEnabled: 7 } },
    "corrupt",
    { schemaVersion: "one", values: 5 },
    null,
  ]) {
    const p = makePage({ rawSettings: raw });
    await p.settled();
    pinch(p);
    assert.equal(p.video.playbackRate, 1.5, JSON.stringify(raw));
  }
});

test("no storage API at all: runs on defaults", async () => {
  const p = makePage({ noBrowser: true });
  await p.settled();
  pinch(p);
  assert.equal(p.video.playbackRate, 1.5);
});

test("teardown unsubscribes from settings changes", async () => {
  const p = makePage();
  await p.settled();
  assert.equal(p.changeListenerCount(), 1);
  p.fire("pagehide", { persisted: false });
  assert.equal(p.changeListenerCount(), 0);
});

// ---- keyboard shortcuts ----------------------------------------------------------

test("shortcuts are OFF by default: keys are never touched", async () => {
  const p = makePage();
  await p.settled();
  for (const k of ["]", "[", "\\", ">", "<"]) assert.equal(key(p, k).prevented, false, k);
  assert.equal(p.video.playbackRate, 1);
});

test("shortcuts on: up / down / reset", async () => {
  const p = makePage({ settings: withSettings({ shortcutsEnabled: true }) });
  await p.settled();
  assert.ok(key(p, "]").prevented);
  assert.equal(p.video.playbackRate, 1.25);
  key(p, "]");
  assert.equal(p.video.playbackRate, 1.5);
  key(p, "[");
  assert.equal(p.video.playbackRate, 1.25);
  key(p, "\\");
  assert.equal(p.video.playbackRate, 1);
  assert.equal(p.children[0].textContent, "1x", "indicator confirms");
});

test("shortcuts: YouTube's own < and > keys are never swallowed", async () => {
  const p = makePage({ settings: withSettings({ shortcutsEnabled: true }) });
  await p.settled();
  for (const k of ["<", ">", ",", ".", " ", "k", "f"]) assert.equal(key(p, k).prevented, false, k);
  assert.equal(p.video.playbackRate, 1);
});

test("shortcuts: Cmd/Ctrl/Alt combos and typing fields are left alone", async () => {
  const p = makePage({ settings: withSettings({ shortcutsEnabled: true }) });
  await p.settled();
  for (const extra of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { isComposing: true }, { defaultPrevented: true }]) {
    assert.equal(key(p, "]", extra).prevented, false, JSON.stringify(extra));
  }
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
    assert.equal(key(p, "]", { target: { tagName } }).prevented, false, tagName);
  }
  assert.equal(key(p, "]", { target: { tagName: "DIV", isContentEditable: true } }).prevented, false);
  assert.equal(p.video.playbackRate, 1);
});

test("shortcuts: composedPath() is used so shadow-DOM inputs are detected", async () => {
  const p = makePage({ settings: withSettings({ shortcutsEnabled: true }) });
  await p.settled();
  const ev = key(p, "]", {
    target: { tagName: "YTD-SEARCHBOX" },
    composedPath: () => [{ tagName: "INPUT" }],
  });
  assert.equal(ev.prevented, false);
});

test("shortcuts: not on ads, Shorts, or without a player", async () => {
  for (const opts of [{ ad: true }, { path: "/shorts/abc123xyz" }, { noPlayer: true }, { noVideo: true }]) {
    const p = makePage({ ...opts, settings: withSettings({ shortcutsEnabled: true }) });
    await p.settled();
    assert.equal(key(p, "]").prevented, false, JSON.stringify(opts));
    assert.equal(p.video.playbackRate, 1);
  }
});

test("shortcuts: custom bindings and unbound actions", async () => {
  const p = makePage({
    settings: withSettings({ shortcutsEnabled: true, keySpeedUp: "n", keySpeedDown: "", step: 0.5 }),
  });
  await p.settled();
  assert.equal(key(p, "]").prevented, false, "old binding gone");
  assert.ok(key(p, "n").prevented);
  assert.equal(p.video.playbackRate, 1.5);
  assert.equal(key(p, "").prevented, false, "empty key never matches the unbound action");
});

test("shortcuts: respect min/max", async () => {
  const p = makePage({ settings: withSettings({ shortcutsEnabled: true, maxSpeed: 1.5 }), rate: 1.5 });
  await p.settled();
  key(p, "]");
  assert.equal(p.video.playbackRate, 1.5);
});

test("keydown listener is capture + non-passive and removed on teardown", async () => {
  const p = makePage();
  assert.equal(p.optsByType.keydown[0].capture, true);
  assert.equal(p.optsByType.keydown[0].passive, false);
  p.fire("pagehide", { persisted: false });
  assert.equal((p.listeners.keydown || []).length, 0);
});

test("hostile keydown events never throw", async () => {
  const p = makePage({ settings: withSettings({ shortcutsEnabled: true }) });
  await p.settled();
  assert.doesNotThrow(() => {
    p.fire("keydown", {});
    p.fire("keydown", { key: null, target: null });
    p.fire("keydown", { key: "]", target: undefined, composedPath: () => { throw new Error("x"); } });
  });
});
