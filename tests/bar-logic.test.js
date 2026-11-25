"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../extension/src/bar-logic.js");
const S = require("../extension/src/settings.js");

const ALL = ["speed", "loop", "cinema", "size", "screenshot", "pip", "flip", "filters", "settings"];

test("defaults show every button in the intended order", () => {
  assert.deepEqual(L.visibleButtons(S.defaults()), ALL);
});

test("every button maps to a real boolean setting", () => {
  const keys = new Set(S.FIELDS.filter((f) => f.type === "bool").map((f) => f.key));
  for (const b of L.BUTTONS) assert.ok(keys.has(b.setting), b.setting);
});

test("master switch or bar switch off => no buttons", () => {
  assert.deepEqual(L.visibleButtons({ ...S.defaults(), enabled: false }), []);
  assert.deepEqual(L.visibleButtons({ ...S.defaults(), controlBarEnabled: false }), []);
});

test("individual buttons can be hidden", () => {
  const v = L.visibleButtons({ ...S.defaults(), barLoop: false, barPip: false });
  assert.deepEqual(v, ALL.filter((x) => x !== "loop" && x !== "pip"));
});

test("only real booleans count (no truthy strings)", () => {
  assert.deepEqual(L.visibleButtons({ enabled: true, controlBarEnabled: true, barSpeed: "yes", barLoop: 1 }), []);
  for (const bad of [null, undefined, 5, "x", []]) assert.deepEqual(L.visibleButtons(bad), []);
});

test("shouldShowBar: only on watch pages in the top frame", () => {
  const values = S.defaults();
  assert.equal(L.shouldShowBar({ pathname: "/watch", isTop: true, values }), true);
  for (const pathname of ["/shorts/abc", "/embed/abcdefghijk", "/", "/results", "/feed/subscriptions", "/live_chat", "", null, undefined]) {
    assert.equal(L.shouldShowBar({ pathname, isTop: true, values }), false, String(pathname));
  }
  assert.equal(L.shouldShowBar({ pathname: "/watch", isTop: false, values }), false, "never inside iframes");
  assert.equal(L.shouldShowBar({ pathname: "/watch", isTop: true, values: { ...values, controlBarEnabled: false } }), false);
  for (const bad of [null, undefined, 5, "x"]) assert.equal(L.shouldShowBar(bad), false);
});

test("flip toggling and the CSS scale value", () => {
  let f = L.toggleFlip(null, "h");
  assert.deepEqual(f, { h: true, v: false });
  assert.equal(L.flipScale(f), "-1 1");
  f = L.toggleFlip(f, "v");
  assert.equal(L.flipScale(f), "-1 -1");
  f = L.toggleFlip(f, "h");
  assert.equal(L.flipScale(f), "1 -1");
  f = L.toggleFlip(f, "v");
  assert.equal(L.flipScale(f), "", "no flip => no property");
  assert.deepEqual(L.toggleFlip({ h: true, v: true }, "x"), { h: true, v: true });
  assert.equal(L.flipScale(undefined), "");
});

test("formatClock", () => {
  assert.equal(L.formatClock(9.9), "9s");
  assert.equal(L.formatClock(65), "1m05s");
  assert.equal(L.formatClock(3725.6), "1h02m05s");
  for (const bad of [NaN, -5, Infinity, "x", null, undefined, 0]) assert.equal(L.formatClock(bad), "0s", String(bad));
});

test("screenshotFileName is safe", () => {
  assert.equal(L.screenshotFileName("jNQXAC9IVRw", 12), "youtube-jNQXAC9IVRw-12s.png");
  assert.equal(L.screenshotFileName(null, 0), "youtube-video-0s.png");
  const evil = L.screenshotFileName("../../etc/passwd\u0000", 5);
  assert.ok(!/[\/\\:\u0000]/.test(evil), evil);
  assert.ok(evil.endsWith(".png"));
});
