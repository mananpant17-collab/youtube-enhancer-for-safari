"use strict";
// Runs extension/src/content.js against a tiny fake page, to verify the
// interception rules (what is prevented, when, and the gesture-start lock).
// It cannot prove Safari's real behaviour: that needs the manual checklist.
const test = require("node:test");
const assert = require("node:assert/strict");

const { makePage } = require("./helpers/fake-page.js");

const IN = { clientX: 300, clientY: 250 };
const OUT = { clientX: 700, clientY: 600 };

test("registers gesture listeners as capture + non-passive", () => {
  const { listeners, optsByType } = makePage();
  for (const t of ["gesturestart", "gesturechange", "gestureend", "wheel"]) {
    assert.ok(listeners[t] && listeners[t].length === 1, t);
    assert.equal(optsByType[t][0].capture, true, t + " capture");
    assert.equal(optsByType[t][0].passive, false, t + " non-passive");
  }
  for (const t of ["pointermove", "mousemove"]) {
    assert.equal(optsByType[t][0].capture, true, t + " capture");
    assert.equal(optsByType[t][0].passive, true, t + " passive");
  }
});

test("pinch over the player is claimed and changes speed", () => {
  const p = makePage();
  const s = p.fire("gesturestart", { ...IN, scale: 1 });
  assert.ok(s.prevented && s.stopped);
  const c = p.fire("gesturechange", { ...IN, scale: 1.4 });
  assert.ok(c.prevented && c.stopped);
  assert.equal(p.video.playbackRate, 1.5);
  const e = p.fire("gestureend", { ...IN, scale: 1.4 });
  assert.ok(e.prevented);
});

test("pinch outside the player is never touched", () => {
  const p = makePage();
  for (const t of ["gesturestart", "gesturechange", "gestureend"]) {
    const ev = p.fire(t, { ...OUT, scale: 1.4 });
    assert.equal(ev.prevented, false, t);
    assert.equal(ev.stopped, false, t);
  }
  assert.equal(p.video.playbackRate, 1);
});

test("claimed gesture stays claimed when the cursor drifts off the player", () => {
  const p = makePage();
  p.fire("gesturestart", { ...IN, scale: 1 });
  const c = p.fire("gesturechange", { ...OUT, scale: 1.4 }); // drifted
  assert.ok(c.prevented, "still ours");
  assert.equal(p.video.playbackRate, 1.5);
  const e = p.fire("gestureend", { ...OUT, scale: 1.4 });
  assert.ok(e.prevented);
});

test("unclaimed gesture stays unclaimed when the cursor drifts onto the player", () => {
  const p = makePage();
  p.fire("gesturestart", { ...OUT, scale: 1 });
  const c = p.fire("gesturechange", { ...IN, scale: 1.4 });
  assert.equal(c.prevented, false);
  assert.equal(p.video.playbackRate, 1);
});

test("a new gesture re-decides from scratch", () => {
  const p = makePage();
  p.fire("gesturestart", { ...IN, scale: 1 });
  p.fire("gestureend", { ...IN, scale: 1 });
  const s = p.fire("gesturestart", { ...OUT, scale: 1 });
  assert.equal(s.prevented, false);
  const c = p.fire("gesturechange", { ...OUT, scale: 1.4 });
  assert.equal(c.prevented, false);
});

test("falls back to the tracked pointer when the event has no coordinates", () => {
  const p = makePage();
  p.fire("pointermove", { ...IN });
  const s = p.fire("gesturestart", { scale: 1 }); // no clientX/Y
  assert.ok(s.prevented);
  const p2 = makePage();
  p2.fire("pointermove", { ...OUT });
  assert.equal(p2.fire("gesturestart", { scale: 1 }).prevented, false);
  const p3 = makePage(); // nothing tracked, nothing on the event
  assert.equal(p3.fire("gesturestart", { scale: 1 }).prevented, false);
});

test("fail safe: no player, no video, or Shorts => nothing is intercepted", () => {
  for (const opts of [{ noPlayer: true }, { noVideo: true }, { path: "/shorts/abc123" }]) {
    const p = makePage(opts);
    const s = p.fire("gesturestart", { ...IN, scale: 1 });
    const c = p.fire("gesturechange", { ...IN, scale: 1.4 });
    const w = p.fire("wheel", { ...IN, ctrlKey: true, deltaY: -100, deltaMode: 0 });
    assert.equal(s.prevented || c.prevented || w.prevented, false, JSON.stringify(opts));
  }
});

test("ads: page zoom is blocked over the player but ad speed is never changed", () => {
  const p = makePage({ ad: true });
  const s = p.fire("gesturestart", { ...IN, scale: 1 });
  assert.ok(s.prevented);
  const c = p.fire("gesturechange", { ...IN, scale: 2 });
  assert.ok(c.prevented);
  assert.equal(p.video.playbackRate, 1);
  const w = p.fire("wheel", { ...IN, ctrlKey: true, deltaY: -100, deltaMode: 0 });
  assert.ok(w.prevented);
  assert.equal(p.video.playbackRate, 1);
});

test("ctrl+wheel: only prevented with ctrl AND over the player", () => {
  const p = makePage();
  assert.equal(p.fire("wheel", { ...IN, ctrlKey: false, deltaY: -100, deltaMode: 0 }).prevented, false);
  assert.equal(p.fire("wheel", { ...OUT, ctrlKey: true, deltaY: -100, deltaMode: 0 }).prevented, false);
  assert.equal(p.video.playbackRate, 1);
  const w = p.fire("wheel", { ...IN, ctrlKey: true, deltaY: -100, deltaMode: 0 });
  assert.ok(w.prevented && w.stopped);
  assert.equal(p.video.playbackRate, 1.25);
});

test("handlers never throw on hostile events", () => {
  const p = makePage();
  for (const t of ["gesturestart", "gesturechange", "gestureend", "wheel", "pointermove"]) {
    assert.doesNotThrow(() => p.fire(t, { scale: NaN, clientX: NaN, clientY: undefined, deltaY: "x", ctrlKey: true }));
  }
  assert.equal(p.video.playbackRate, 1);
});
