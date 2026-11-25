"use strict";
// M3 behaviour against the fake page: indicator, navigation, the guarded
// re-apply of playbackRate, observers and teardown.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makePage } = require("./helpers/fake-page.js");

const IN = { clientX: 300, clientY: 250 };

function pinchTo(p, scale = 1.4) {
  p.fire("gesturestart", { ...IN, scale: 1 });
  p.fire("gesturechange", { ...IN, scale });
  p.fire("gestureend", { ...IN, scale });
}

// ---- indicator ---------------------------------------------------------------

test("indicator: shows the new speed inside the player, then fades after ~800ms", () => {
  const p = makePage();
  pinchTo(p); // 1 -> 1.5
  assert.equal(p.children.length, 1, "appended inside the player element");
  const el = p.children[0];
  assert.equal(el.textContent, "1.5x");
  assert.equal(el.style.opacity, "1");
  assert.equal(el.style.pointerEvents, "none");
  assert.equal(el.attrs["aria-hidden"], "true");
  p.advance(700);
  assert.equal(el.style.opacity, "1");
  p.advance(150);
  assert.equal(el.style.opacity, "0");
});

test("indicator: a second change reuses the element and restarts the hold", () => {
  const p = makePage();
  pinchTo(p);
  p.advance(700);
  pinchTo(p, 1.2); // new gesture: 1.5 -> 1.75 ... (ln1.2=.18 -> 1 step)
  assert.equal(p.children.length, 1);
  assert.equal(p.children[0].textContent, "1.75x");
  p.advance(700);
  assert.equal(p.children[0].style.opacity, "1", "hold restarted");
});

test("indicator: removed on navigation start and finish", () => {
  const p = makePage();
  pinchTo(p);
  p.fire("yt-navigate-start");
  assert.equal(p.children.length, 0);
  pinchTo(p, 1.2);
  assert.equal(p.children.length, 1);
  p.fire("yt-navigate-finish");
  assert.equal(p.children.length, 0);
});

test("indicator: not shown when speed did not change or outside the player", () => {
  const p = makePage();
  p.fire("gesturestart", { clientX: 700, clientY: 600, scale: 1 });
  p.fire("gesturechange", { clientX: 700, clientY: 600, scale: 1.4 });
  assert.equal(p.children.length, 0);
  const q = makePage({ ad: true });
  pinchTo(q, 2);
  assert.equal(q.children.length, 0, "no indicator on ads: speed untouched");
});

// ---- remembering speed across videos / YouTube overwrites -------------------------

test("a new video that YouTube reset to 1x gets our speed back", () => {
  const p = makePage();
  pinchTo(p); // 1.5
  assert.equal(p.video.playbackRate, 1.5);
  p.video.playbackRate = 1; // YouTube resets while loading the next video
  p.advance(1000);
  p.video.fire("loadedmetadata");
  p.advance(200);
  assert.equal(p.video.playbackRate, 1.5);
});

test("our own write never starts a ratechange feedback loop", () => {
  const p = makePage();
  p.video.fire("loadedmetadata"); // opens the re-apply window with a full budget
  p.advance(200);
  pinchTo(p); // 1 -> 1.5, inside the window
  const writesAfterPinch = p.video.writes;
  p.video.fire("ratechange"); // echo of our own write
  p.video.fire("ratechange");
  assert.equal(p.video.writes, writesAfterPinch, "no extra writes from echoes");
  assert.equal(p.video.playbackRate, 1.5);
});

test("YouTube overwriting right after load is re-applied, but only a bounded number of times", () => {
  const p = makePage();
  pinchTo(p); // 1.5
  p.video.fire("loadedmetadata"); // opens the 2s window + budget of 3
  p.advance(200);
  const before = p.video.writes;
  // A hostile page that resets the speed every time we set it:
  for (let i = 0; i < 20; i++) {
    p.video.playbackRate = 1;
    p.video.writes--; // don't count the hostile write
    p.video.fire("ratechange");
  }
  assert.ok(p.video.writes - before <= 3, `bounded re-applies, got ${p.video.writes - before}`);
});

test("a change after the window (YouTube menu, < > keys) is adopted, not fought", () => {
  const p = makePage();
  pinchTo(p); // 1.5
  p.advance(5000); // far outside any window
  p.video.playbackRate = 2; // user picks 2x in YouTube's own menu
  p.video.fire("ratechange");
  p.advance(100);
  assert.equal(p.video.playbackRate, 2, "not overwritten");
  // next video: YouTube resets to 1, we restore the *user's* 2x
  p.video.playbackRate = 1;
  p.video.fire("loadedmetadata");
  p.advance(200);
  assert.equal(p.video.playbackRate, 2);
});

test("ads: loadedmetadata/ratechange during an ad never touches the ad's speed", () => {
  const p = makePage();
  pinchTo(p); // 1.5
  p.classes.add("ad-showing");
  p.video.playbackRate = 1;
  p.video.writes = 0;
  p.video.fire("loadedmetadata");
  p.advance(300);
  p.video.fire("ratechange");
  assert.equal(p.video.writes, 0);
  assert.equal(p.video.playbackRate, 1);
  // ad ends, content video loads: our speed comes back
  p.classes.delete("ad-showing");
  p.video.fire("loadedmetadata");
  p.advance(300);
  assert.equal(p.video.playbackRate, 1.5);
});

test("remembered speed survives a page reload in the same tab (sessionStorage)", () => {
  const p = makePage();
  pinchTo(p);
  assert.equal(p.store.get("yte:speed"), "1.5");
  const reloaded = makePage({ storage: { "yte:speed": "1.5" }, videoReady: true });
  reloaded.advance(300);
  assert.equal(reloaded.video.playbackRate, 1.5);
});

test("garbage in sessionStorage is ignored", () => {
  const p = makePage({ storage: { "yte:speed": "banana" }, videoReady: true });
  p.advance(300);
  assert.equal(p.video.playbackRate, 1);
});

// ---- observers, navigation, teardown -------------------------------------------------

test("video swap is picked up (debounced) and old listeners are removed", () => {
  const p = makePage();
  const old = p.video;
  assert.equal(old.listenerCount(), 3);
  const fresh = p.replaceVideo(1);
  const mo = p.activeObservers()[0];
  mo.cb();
  mo.cb();
  mo.cb(); // burst of mutations => one sync
  assert.equal(p.pendingTimers(), 1);
  p.advance(150);
  assert.equal(old.listenerCount(), 0, "no leak on the old video");
  assert.equal(fresh.listenerCount(), 3);
});

test("player not in the DOM yet: waits cheaply, then swaps to a player observer", () => {
  const p = makePage({ noPlayer: true });
  assert.equal(p.activeObservers().length, 1);
  assert.equal(p.activeObservers()[0].target.constructor === Object, true); // watching <html>
  p.setPlayerPresent(true);
  p.activeObservers()[0].cb();
  const active = p.activeObservers();
  assert.equal(active.length, 1, "waiting observer was disconnected");
  assert.equal(p.video.listenerCount(), 3);
});

test("waiting observer gives up after 30s instead of running forever", () => {
  const p = makePage({ noPlayer: true });
  p.advance(29000);
  assert.equal(p.activeObservers().length, 1);
  p.advance(2000);
  assert.equal(p.activeObservers().length, 0);
  // a later navigation restarts it
  p.fire("yt-navigate-finish");
  assert.equal(p.activeObservers().length, 1);
});

test("navigation re-binds to a rebuilt player without stacking observers", () => {
  const p = makePage();
  for (let i = 0; i < 5; i++) p.fire("yt-navigate-finish");
  p.fire("popstate");
  assert.equal(p.activeObservers().length, 1);
  assert.equal(p.video.listenerCount(), 3);
});

test("teardown on a real pagehide removes listeners, observers, timers, indicator", () => {
  const p = makePage();
  pinchTo(p);
  assert.ok(p.activeListenerCount() > 0);
  p.fire("pagehide", { persisted: false });
  assert.equal(p.activeListenerCount(), 0);
  assert.equal(p.activeObservers().length, 0);
  assert.equal(p.video.listenerCount(), 0);
  assert.equal(p.children.length, 0);
  assert.equal(p.pendingTimers(), 0);
});

test("pagehide into the back/forward cache keeps everything for restore", () => {
  const p = makePage();
  const before = p.activeListenerCount();
  p.fire("pagehide", { persisted: true });
  assert.equal(p.activeListenerCount(), before);
  assert.equal(p.activeObservers().length, 1);
});

test("Shorts: no video tracking, no observers writing anything", () => {
  const p = makePage({ path: "/shorts/abc123xyz" });
  p.advance(500);
  assert.equal(p.video.listenerCount(), 0);
  pinchTo(p);
  assert.equal(p.children.length, 0);
  assert.equal(p.video.writes, 0);
});

test("nothing throws when storage and player are unavailable", () => {
  const p = makePage({ noPlayer: true });
  assert.doesNotThrow(() => {
    p.fire("yt-navigate-start");
    p.fire("yt-navigate-finish");
    p.fire("popstate");
    p.advance(60000);
  });
});
