"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../extension/src/speed-policy.js");

test("formatSpeed", () => {
  assert.equal(P.formatSpeed(1.75), "1.75x");
  assert.equal(P.formatSpeed(1), "1x");
  assert.equal(P.formatSpeed(0.25), "0.25x");
  assert.equal(P.formatSpeed(2.5), "2.5x");
  assert.equal(P.formatSpeed(1.2500000001), "1.25x");
  for (const bad of [NaN, Infinity, 0, -1, "1", null, undefined]) assert.equal(P.formatSpeed(bad), "");
});

test("classify: our own echo is ignored (no feedback loop)", () => {
  assert.equal(P.classifyRateChange({ rate: 1.5, expected: 1.5, desired: 1.5, inWindow: true }), "ours");
  assert.equal(P.classifyRateChange({ rate: 1.50000001, expected: 1.5 }), "ours");
});

test("classify: YouTube overwriting us shortly after a new video => reapply", () => {
  assert.equal(P.classifyRateChange({ rate: 1, expected: null, desired: 1.5, inWindow: true }), "reapply");
});

test("classify: same change outside the window is the user's choice", () => {
  assert.equal(P.classifyRateChange({ rate: 2, expected: null, desired: 1.5, inWindow: false }), "user");
});

test("classify: nothing desired => adopt as user's", () => {
  assert.equal(P.classifyRateChange({ rate: 2, expected: null, desired: null, inWindow: true }), "user");
});

test("classify: ads and garbage are ignored", () => {
  assert.equal(P.classifyRateChange({ rate: 1, desired: 1.5, inWindow: true, adShowing: true }), "ignore");
  for (const rate of [NaN, 0, -2, Infinity, "x", undefined]) {
    assert.equal(P.classifyRateChange({ rate, desired: 1.5, inWindow: true }), "ignore");
  }
  assert.equal(P.classifyRateChange(null), "ignore");
  assert.equal(P.classifyRateChange(undefined), "ignore");
});

test("classify: already at desired speed inside the window is not a fight", () => {
  assert.equal(P.classifyRateChange({ rate: 1.5, expected: null, desired: 1.5, inWindow: true }), "user");
});

test("sanitizeStoredSpeed", () => {
  assert.equal(P.sanitizeStoredSpeed("1.75"), 1.75);
  assert.equal(P.sanitizeStoredSpeed("0.25"), 0.25);
  for (const bad of [null, undefined, "", "abc", "NaN", "Infinity", "0", "-1", "17", "0.01", {}, []]) {
    assert.equal(P.sanitizeStoredSpeed(bad), null, String(bad));
  }
});

test("videoIdFromLocation", () => {
  assert.equal(P.videoIdFromLocation("/watch", "?v=dQw4w9WgXcQ&t=5"), "dQw4w9WgXcQ");
  assert.equal(P.videoIdFromLocation("/watch", "?list=PL1&v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(P.videoIdFromLocation("/embed/dQw4w9WgXcQ", ""), "dQw4w9WgXcQ");
  assert.equal(P.videoIdFromLocation("/live/abcdefghijk", ""), "abcdefghijk");
  assert.equal(P.videoIdFromLocation("/", ""), null);
  assert.equal(P.videoIdFromLocation(null, undefined), null);
});
