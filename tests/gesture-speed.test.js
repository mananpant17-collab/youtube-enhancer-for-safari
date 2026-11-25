"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../extension/src/gesture-speed.js");

const CFG = { step: 0.25, threshold: 0.15, min: 0.25, max: 4 };

// Run one gesture (a sequence of scale values) from `start` speed.
// Returns { speeds: [speed after each event], final, state }.
function gesture(scales, start = 1, cfg = CFG) {
  let state = G.createState(start, cfg);
  const speeds = [];
  for (const sc of scales) {
    state = G.update(state, cfg, sc);
    speeds.push(state.speed);
  }
  return { speeds, final: state.speed, state };
}

function ramp(from, to, n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push(from + ((to - from) * i) / n);
  return out;
}

test("slow pinch-out moves in single discrete steps", () => {
  const { speeds, final } = gesture(ramp(1, 1.5, 100));
  assert.equal(final, 1.5); // ln(1.5)=0.405 -> 2 steps
  let prev = 1;
  for (const s of speeds) {
    assert.ok(s >= prev, "never decreases on a pinch-out");
    assert.ok(Math.abs(s - prev) <= 0.25 + 1e-9, "at most one step at a time");
    prev = s;
  }
});

test("slow pinch-in decreases speed", () => {
  const { final } = gesture(ramp(1, 0.6, 100), 2);
  // ln(0.6) = -0.51 -> 3 steps down
  assert.equal(final, 1.25);
});

test("fast pinch applies several steps in one event", () => {
  const { speeds } = gesture([1, 3]);
  assert.equal(speeds[1], 2.75); // ln(3)=1.0986 -> 7 steps
});

test("one absurd jump is bounded per event", () => {
  const { speeds } = gesture([1e6, 1e6]);
  assert.equal(speeds[0], 3); // capped at 8 steps = +2.0
  assert.equal(speeds[1], 4); // next event continues, clamped at max
});

test("reversal mid-gesture goes back down with hysteresis", () => {
  const { speeds } = gesture([1, 1.4, 1.2, 1.0]);
  assert.deepEqual(speeds, [1, 1.5, 1.5, 1]);
});

test("exact multiples of the threshold do not suffer float errors", () => {
  const { final } = gesture([Math.exp(0.45)]);
  assert.equal(final, 1.75); // exactly 3 steps
  assert.equal(gesture([Math.exp(-0.45)], 2).final, 1.25);
});

test("scale of exactly 1 never changes speed", () => {
  const { speeds, state } = gesture([1, 1, 1, 1], 1.5);
  assert.deepEqual(speeds, [1.5, 1.5, 1.5, 1.5]);
  assert.equal(state.changed, false);
});

test("clamps at the maximum and reversing responds immediately", () => {
  const up = gesture([2], 3.75); // would be 4.75
  assert.equal(up.final, 4);
  assert.equal(up.state.changed, true);

  // keep pinching out at the limit: no change, no hidden debt
  let state = up.state;
  state = G.update(state, CFG, 3);
  assert.equal(state.speed, 4);
  assert.equal(state.changed, false);
  // reverse by ~0.4 in log space -> 2 steps down right away
  state = G.update(state, CFG, Math.exp(Math.log(3) - 0.4));
  assert.equal(state.speed, 3.5);
});

test("clamps at the minimum", () => {
  assert.equal(gesture([0.5], 0.5).final, 0.25);
  assert.equal(gesture([0.01, 0.001], 1).final, 0.25);
});

test("repeated gestures each start fresh from the current speed", () => {
  let speed = 1;
  for (const expected of [1.5, 2, 2.5]) {
    speed = gesture([1, 1.4], speed).final;
    assert.equal(speed, expected);
  }
  // and a pinch-in brings it back down
  speed = gesture([1, 0.7], speed).final; // ln(.7)=-.357 -> 2 steps down
  assert.equal(speed, 2);
});

test("garbage scale values are ignored", () => {
  const bad = [NaN, Infinity, -Infinity, -1, 0, "abc", "1.5", null, undefined, {}, [], true];
  for (const b of bad) {
    const { final, state } = gesture([b], 1.5);
    assert.equal(final, 1.5, `scale ${String(b)}`);
    assert.equal(state.changed, false);
  }
});

test("garbage in the middle of a gesture does not corrupt it", () => {
  const { speeds } = gesture([1, 1.4, NaN, 0, Infinity, 1.4]);
  assert.deepEqual(speeds, [1, 1.5, 1.5, 1.5, 1.5, 1.5]);
});

test("tiny positive scale is finite and clamps", () => {
  const { final } = gesture([Number.MIN_VALUE], 1);
  assert.ok(Number.isFinite(final));
  assert.ok(final >= 0.25 && final <= 4);
});

test("garbage config falls back to defaults and is sane", () => {
  const c = G.normalizeConfig({ step: 0, threshold: -1, min: "x", max: NaN });
  assert.equal(c.step, 0.25);
  assert.equal(c.threshold, 0.15);
  assert.equal(c.min, 0.25);
  assert.equal(c.max, 4);
  for (const bad of [null, undefined, 5, "str", []]) {
    assert.equal(G.normalizeConfig(bad).step, 0.25);
  }
});

test("min > max is swapped; limits are held to the player's real range", () => {
  const c = G.normalizeConfig({ min: 8, max: 2 });
  assert.equal(c.min, 2);
  assert.equal(c.max, 8);
  const wide = G.normalizeConfig({ min: 0, max: 1000, step: 1 });
  assert.equal(wide.min, 0.25); // 0 is invalid -> default
  assert.equal(wide.max, 16);
});

test("configurable step and threshold", () => {
  const cfg = { step: 0.1, threshold: 0.05, min: 0.25, max: 4 };
  const { final } = gesture([Math.exp(0.1)], 1, cfg); // 2 steps of 0.1
  assert.equal(final, 1.2);
});

test("garbage state is sanitized, never NaN", () => {
  const s = G.update({ speed: NaN, baseline: "x", wheelAcc: Infinity }, CFG, 1.4);
  assert.ok(Number.isFinite(s.speed));
  assert.ok(Number.isFinite(s.baseline));
  assert.ok(Number.isFinite(s.wheelAcc));
  assert.equal(G.update(null, CFG, 1).speed, 1);
});

test("createState clamps an out-of-range starting speed", () => {
  assert.equal(G.createState(100, CFG).speed, 4);
  assert.equal(G.createState(0, CFG).speed, 1);
  assert.equal(G.createState(NaN, CFG).speed, 1);
  assert.equal(G.createState(0.01, CFG).speed, 0.25);
});

test("update does not mutate its input state", () => {
  const s0 = G.createState(1, CFG);
  const frozen = Object.freeze({ ...s0 });
  const s1 = G.update(frozen, CFG, 1.4);
  assert.equal(frozen.speed, 1);
  assert.equal(s1.speed, 1.5);
});

// ---- ctrl+wheel -----------------------------------------------------------

test("wheel: one mouse notch is exactly one step", () => {
  let s = G.createState(1, CFG);
  s = G.updateWheel(s, CFG, -100, 0);
  assert.equal(s.speed, 1.25);
  s = G.updateWheel(s, CFG, 100, 0);
  assert.equal(s.speed, 1);
  s = G.updateWheel(s, CFG, -3, 1); // line mode
  assert.equal(s.speed, 1.25);
});

test("wheel: small trackpad deltas accumulate into a step", () => {
  let s = G.createState(1, CFG);
  const seen = [];
  for (let i = 0; i < 10; i++) {
    s = G.updateWheel(s, CFG, -2, 0); // 0.02 each
    seen.push(s.speed);
  }
  assert.equal(seen[0], 1); // not yet
  assert.equal(s.speed, 1.25); // 10 * 0.02 = 0.2 > 0.15
});

test("wheel: garbage and zero deltas are ignored", () => {
  for (const d of [NaN, Infinity, "x", null, undefined, 0]) {
    const s = G.updateWheel(G.createState(1.5, CFG), CFG, d, 0);
    assert.equal(s.speed, 1.5);
    assert.equal(s.changed, false);
  }
});

test("wheel: respects the limits", () => {
  let s = G.createState(4, CFG);
  s = G.updateWheel(s, CFG, -100, 0);
  assert.equal(s.speed, 4);
  assert.equal(s.changed, false);
  s = G.createState(0.25, CFG);
  s = G.updateWheel(s, CFG, 100, 0);
  assert.equal(s.speed, 0.25);
});

// ---- fuzz: never NaN/Infinity, always within range ------------------------

test("fuzz: random real and garbage input stays finite and in range", () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const junk = [NaN, Infinity, -Infinity, 0, -5, "a", null, undefined, {}, 1e308, 5e-324];
  let state = G.createState(1, CFG);
  for (let i = 0; i < 5000; i++) {
    const r = rnd();
    let v;
    if (r < 0.15) v = junk[Math.floor(rnd() * junk.length)];
    else if (r < 0.2) v = 1;
    else v = Math.exp((rnd() - 0.5) * 6);
    state =
      rnd() < 0.25
        ? G.updateWheel(state, CFG, rnd() < 0.2 ? v : (rnd() - 0.5) * 300, Math.floor(rnd() * 3))
        : G.update(state, CFG, v);
    assert.ok(Number.isFinite(state.speed), `speed finite at ${i}`);
    assert.ok(state.speed >= 0.25 && state.speed <= 4, `in range at ${i}: ${state.speed}`);
    assert.ok(Number.isFinite(state.baseline) && Number.isFinite(state.wheelAcc));
  }
});

// ---- keyboard stepping ---------------------------------------------------------

test("stepSpeed: one step up/down, clamped", () => {
  assert.equal(G.stepSpeed(1, 1, CFG), 1.25);
  assert.equal(G.stepSpeed(1, -1, CFG), 0.75);
  assert.equal(G.stepSpeed(4, 1, CFG), 4);
  assert.equal(G.stepSpeed(0.25, -1, CFG), 0.25);
  assert.equal(G.stepSpeed(1, 0, CFG), 1);
  assert.equal(G.stepSpeed(3.9, 1, CFG), 4);
});

test("stepSpeed/resetSpeed: garbage-safe", () => {
  for (const bad of [NaN, Infinity, "x", null, undefined, 0, -3]) {
    const s = G.stepSpeed(bad, 1, CFG);
    assert.ok(Number.isFinite(s) && s >= 0.25 && s <= 4, String(bad));
  }
  assert.equal(G.stepSpeed(1, NaN, CFG), 1);
  assert.equal(G.resetSpeed(CFG), 1);
  assert.equal(G.resetSpeed({ min: 2, max: 4 }), 2, "1x is outside the allowed range");
});
