"use strict";
// Page classes, filters, auto theater and autoplay prevention in content.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makePage } = require("./helpers/fake-page.js");
const S = require("../extension/src/settings.js");

const withSettings = (patch) => ({ ...S.defaults(), ...patch });

// ---- page classes -----------------------------------------------------------------

test("no hiding classes by default", async () => {
  const p = makePage();
  await p.settled();
  assert.deepEqual(p.htmlClasses(), []);
});

test("hide options add exactly their classes, live", async () => {
  const p = makePage({ settings: withSettings({ hideComments: true, hideCards: true }) });
  await p.settled();
  assert.deepEqual(p.htmlClasses(), ["yte-hide-cards", "yte-hide-comments"]);
  await p.setSettings(withSettings({ hideRelated: true }));
  assert.deepEqual(p.htmlClasses(), ["yte-hide-related"]);
  await p.setSettings(withSettings({ hideChat: true, hideRelated: true, enabled: false }));
  assert.deepEqual(p.htmlClasses(), [], "master switch off removes everything");
});

test("teardown removes the classes and the filter", async () => {
  const p = makePage({ settings: withSettings({ hideComments: true, filtersEnabled: true, filterBrightness: 150 }) });
  await p.settled();
  assert.equal(p.htmlClasses().length, 1);
  assert.equal(p.video.style.props.filter, "brightness(1.5)");
  p.fire("pagehide", { persisted: false });
  assert.deepEqual(p.htmlClasses(), []);
  assert.equal(p.video.style.props.filter, undefined);
});

test("Hide Shorts toggles its class live and leaves the other classes alone", async () => {
  const p = makePage({ settings: withSettings({ hideShorts: true, hideComments: true }) });
  await p.settled();
  assert.deepEqual(p.htmlClasses(), ["yte-hide-comments", "yte-hide-shorts"]);
  await p.setSettings(withSettings({ hideShorts: false, hideComments: true }));
  assert.deepEqual(p.htmlClasses(), ["yte-hide-comments"]);
  await p.setSettings(withSettings({ hideShorts: true, enabled: false }));
  assert.deepEqual(p.htmlClasses(), []);
});

// ---- filters ---------------------------------------------------------------------------

test("filters are applied to the video only when enabled", async () => {
  const p = makePage({ settings: withSettings({ filterBrightness: 120 }) });
  await p.settled();
  assert.equal(p.video.style.props.filter, undefined, "off by default");
  await p.setSettings(withSettings({ filterBrightness: 120, filtersEnabled: true }));
  assert.equal(p.video.style.props.filter, "brightness(1.2)");
  await p.setSettings(withSettings({ filterBrightness: 120, filtersEnabled: false }));
  assert.equal(p.video.style.props.filter, undefined);
});

test("filters follow a swapped <video> element", async () => {
  const p = makePage({ settings: withSettings({ filtersEnabled: true, filterSepia: 50 }) });
  await p.settled();
  const fresh = p.replaceVideo(1);
  p.activeObservers()[0].cb();
  p.advance(150);
  assert.equal(fresh.style.props.filter, "sepia(0.5)");
});

test("the bar's filter button flips the saved setting and the video follows", async () => {
  const p = makePage({ settings: withSettings({ filterContrast: 130 }) });
  await p.settled();
  p.bar().deps.toggleFilters();
  await p.settled();
  assert.equal(p.video.style.props.filter, "contrast(1.3)");
  assert.equal(p.bar().deps.getValues().filtersEnabled, true);
  p.bar().deps.toggleFilters();
  await p.settled();
  assert.equal(p.video.style.props.filter, undefined);
});

// ---- auto theater ------------------------------------------------------------------------

async function loaded(p) {
  await p.settled();
  p.video.fire("loadedmetadata");
  p.advance(200);
}

test("auto theater: clicks YouTube's button once per video", async () => {
  const p = makePage({ settings: withSettings({ autoTheater: true }) });
  await loaded(p);
  assert.equal(p.sizeBtn.clicks, 1);
  p.video.fire("loadedmetadata"); // same video again
  p.advance(200);
  assert.equal(p.sizeBtn.clicks, 1);
  p.location.search = "?v=bbbbbbbbbbb";
  p.sizeBtn.click(); // user left theater mode
  const before = p.sizeBtn.clicks;
  p.video.fire("loadedmetadata");
  p.advance(200);
  assert.equal(p.sizeBtn.clicks, before + 1, "next video gets theater again");
});

test("auto theater: off by default, skipped when already theater / ad / no button", async () => {
  for (const [opts, patch] of [
    [{}, {}],
    [{ theater: true }, { autoTheater: true }],
    [{ ad: true }, { autoTheater: true }],
    [{ noSizeButton: true }, { autoTheater: true }],
    [{ path: "/results" }, { autoTheater: true }],
  ]) {
    const p = makePage({ ...opts, settings: withSettings(patch) });
    await loaded(p);
    assert.equal(p.sizeBtn.clicks, 0, JSON.stringify([opts, patch]));
  }
});

// ---- autoplay prevention --------------------------------------------------------------------

test("autoplay prevention is off by default", async () => {
  const p = makePage({ hidden: true });
  await p.settled();
  p.video.fire("play");
  assert.equal(p.video.pauses, 0);
});

test("background tabs: a video that starts in a never-visible tab is paused", async () => {
  const p = makePage({ hidden: true, settings: withSettings({ preventAutoplayBackground: true }) });
  await p.settled();
  p.video.fire("play");
  assert.equal(p.video.pauses, 1);
  // user finally looks at the tab, then presses play: allowed
  p.setHidden(false);
  p.fire("visibilitychange");
  p.video.fire("play");
  assert.equal(p.video.pauses, 1);
});

test("background option does not touch videos in a visible tab", async () => {
  const p = makePage({ settings: withSettings({ preventAutoplayBackground: true }) });
  await p.settled();
  p.video.fire("play");
  assert.equal(p.video.pauses, 0);
});

test("foreground: first video is paused until the user really interacts", async () => {
  const p = makePage({ settings: withSettings({ preventAutoplayForeground: true }) });
  await p.settled();
  p.video.fire("play");
  assert.equal(p.video.pauses, 1);
  p.fire("pointerdown", { isTrusted: false }); // a script-made event doesn't count
  p.video.fire("play");
  assert.equal(p.video.pauses, 2);
  p.fire("pointerdown", { isTrusted: true });
  p.video.fire("play");
  assert.equal(p.video.pauses, 2, "after a real click, play is allowed");
});

test("foreground: a real key press also counts as interaction", async () => {
  const p = makePage({ settings: withSettings({ preventAutoplayForeground: true }) });
  await p.settled();
  p.fire("keydown", { key: "k", isTrusted: true, target: { tagName: "BODY" } });
  p.video.fire("play");
  assert.equal(p.video.pauses, 0);
});

test("a page that keeps calling play() cannot trap us (bounded pauses)", async () => {
  const p = makePage({ settings: withSettings({ preventAutoplayForeground: true }) });
  await p.settled();
  for (let i = 0; i < 50; i++) p.video.fire("play");
  assert.equal(p.video.pauses, 5);
  p.location.search = "?v=bbbbbbbbbbb"; // new video: fresh budget
  for (let i = 0; i < 50; i++) p.video.fire("play");
  assert.equal(p.video.pauses, 10);
});

test("master switch off: nothing is paused", async () => {
  const p = makePage({ hidden: true, settings: withSettings({ enabled: false, preventAutoplayBackground: true, preventAutoplayForeground: true }) });
  await p.settled();
  p.video.fire("play");
  assert.equal(p.video.pauses, 0);
});

test("the play listener is removed with the video and on teardown", async () => {
  const p = makePage();
  await p.settled();
  const old = p.video;
  p.replaceVideo(1);
  p.activeObservers()[0].cb();
  p.advance(150);
  assert.equal(old.listenerCount(), 0);
  p.fire("pagehide", { persisted: false });
  assert.equal(p.video.listenerCount(), 0);
  assert.equal(p.activeListenerCount(), 0);
});
