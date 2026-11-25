"use strict";
// How content.js drives the control bar (the bar itself is a recorder stub
// here; the real DOM is checked on a live YouTube page).
const test = require("node:test");
const assert = require("node:assert/strict");
const { makePage } = require("./helpers/fake-page.js");
const S = require("../extension/src/settings.js");

const withSettings = (patch) => ({ ...S.defaults(), ...patch });
const last = (calls, names) => [...calls].reverse().find((c) => names.includes(c));

test("one bar is created and mounted once settings arrive", async () => {
  const p = makePage();
  await p.settled();
  assert.equal(p.bar().created, 1);
  assert.ok(p.bar().calls.includes("mount"));
});

test("bar is given live settings values", async () => {
  const p = makePage({ settings: withSettings({ barLoop: false, controlBarEnabled: true }) });
  await p.settled();
  const v = p.bar().deps.getValues();
  assert.equal(v.barLoop, false);
  assert.equal(v.barSpeed, true);
  assert.equal(v.controlBarEnabled, true);
  assert.equal(v.enabled, true);
});

test("master switch removes the bar; turning it back on restores it", async () => {
  const p = makePage();
  await p.settled();
  assert.equal(last(p.bar().calls, ["mount", "unmount"]), "mount");
  await p.setSettings(withSettings({ enabled: false }));
  assert.equal(last(p.bar().calls, ["mount", "unmount"]), "unmount");
  await p.setSettings(withSettings({ enabled: true }));
  assert.equal(last(p.bar().calls, ["mount", "unmount"]), "mount");
});

test("bar-only switch is passed through (the bar decides to hide itself)", async () => {
  const p = makePage({ settings: withSettings({ controlBarEnabled: false }) });
  await p.settled();
  assert.equal(p.bar().deps.getValues().controlBarEnabled, false);
});

test("speed buttons: up / down / reset go through the same guarded path", async () => {
  const p = makePage();
  await p.settled();
  const { speedAction } = p.bar().deps;
  speedAction("up");
  assert.equal(p.video.playbackRate, 1.25);
  speedAction("up");
  assert.equal(p.video.playbackRate, 1.5);
  speedAction("down");
  assert.equal(p.video.playbackRate, 1.25);
  speedAction("reset");
  assert.equal(p.video.playbackRate, 1);
  assert.equal(p.children[0].textContent, "1x", "indicator confirms the change");
  assert.ok(p.bar().calls.includes("update"), "bar label is refreshed");
});

test("speed buttons respect min/max, ads, Shorts, and the master switch", async () => {
  const capped = makePage({ settings: withSettings({ maxSpeed: 1.25 }) });
  await capped.settled();
  capped.bar().deps.speedAction("up");
  capped.bar().deps.speedAction("up");
  assert.equal(capped.video.playbackRate, 1.25);

  for (const opts of [{ ad: true }, { path: "/shorts/abc123xyz" }, { noVideo: true }, { noPlayer: true }]) {
    const p = makePage(opts);
    await p.settled();
    p.bar().deps.speedAction("up");
    assert.equal(p.video.playbackRate, 1, JSON.stringify(opts));
  }
  const off = makePage({ settings: withSettings({ enabled: false }) });
  await off.settled();
  off.bar().deps.speedAction("up");
  assert.equal(off.video.playbackRate, 1);
});

test("deps expose the player, video, ad state and video id", async () => {
  const p = makePage({ search: "?v=dQw4w9WgXcQ" });
  await p.settled();
  const d = p.bar().deps;
  assert.ok(d.getPlayer());
  assert.equal(d.getVideo(), p.video);
  assert.equal(d.isAd(), false);
  assert.equal(d.getVideoId(), "dQw4w9WgXcQ");
  p.classes.add("ad-showing");
  assert.equal(d.isAd(), true);
});

test("a new video tells the bar to reset per-video effects; the same video does not", async () => {
  const p = makePage({ search: "?v=aaaaaaaaaaa" });
  await p.settled();
  p.video.fire("loadedmetadata");
  p.advance(200);
  assert.equal(p.bar().calls.filter((c) => c === "newVideo").length, 1, "first video");
  p.video.fire("loadedmetadata"); // same id again (e.g. ad -> content)
  p.advance(200);
  assert.equal(p.bar().calls.filter((c) => c === "newVideo").length, 1);
  p.location.search = "?v=bbbbbbbbbbb";
  p.video.fire("loadedmetadata");
  p.advance(200);
  assert.equal(p.bar().calls.filter((c) => c === "newVideo").length, 2);
});

test("navigation re-evaluates the bar (shown on watch, removed elsewhere)", async () => {
  const p = makePage();
  await p.settled();
  const before = p.bar().calls.filter((c) => c === "mount").length;
  p.fire("yt-navigate-finish");
  assert.ok(p.bar().calls.filter((c) => c === "mount").length > before, "re-evaluated (mount is idempotent, extra calls are harmless)");
});

test("the bar's settings button asks the background to open the options page", async () => {
  const p = makePage();
  await p.settled();
  p.bar().deps.openSettings();
  assert.equal(JSON.stringify(p.messages), JSON.stringify([{ type: "yte:open-options" }]));
  const noApi = makePage({ noBrowser: true });
  await noApi.settled();
  assert.doesNotThrow(() => noApi.bar().deps.openSettings());
});

test("teardown destroys the bar", async () => {
  const p = makePage();
  await p.settled();
  p.fire("pagehide", { persisted: false });
  assert.equal(p.bar().calls[p.bar().calls.length - 1], "destroy");
});
