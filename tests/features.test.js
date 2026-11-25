"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../extension/src/features.js");
const S = require("../extension/src/settings.js");

test("pageClasses: all off by default", () => {
  const c = F.pageClasses(S.defaults());
  assert.equal(Object.keys(c).length, 5);
  assert.ok(Object.values(c).every((v) => v === false));
});

test("pageClasses: each setting maps to its own class; master switch overrides", () => {
  const v = { ...S.defaults(), hideComments: true, hideChat: true };
  assert.deepEqual(F.pageClasses(v), {
    "yte-hide-comments": true,
    "yte-hide-related": false,
    "yte-hide-chat": true,
    "yte-hide-cards": false,
    "yte-hide-shorts": false,
  });
  assert.ok(Object.values(F.pageClasses({ ...v, enabled: false })).every((x) => x === false));
  for (const bad of [null, undefined, 5, "x"]) {
    assert.ok(Object.values(F.pageClasses(bad)).every((x) => x === false));
  }
  assert.equal(F.pageClasses({ enabled: true, hideComments: "yes" })["yte-hide-comments"], false, "strict booleans");
});

test("every page class has CSS in youtube.css", () => {
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "extension", "css", "youtube.css"), "utf8");
  for (const c of F.PAGE_CLASSES) assert.ok(css.includes("html." + c.cls + " "), c.cls);
});

test("hiding is CSS only: the stylesheet never removes or rewrites anything", () => {
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "extension", "css", "youtube.css"), "utf8");
  assert.ok(!/content\s*:|visibility\s*:\s*collapse/.test(css));
  for (const m of css.matchAll(/html\.yte-hide-[^{]+\{([^}]*)\}/g)) assert.match(m[1], /display:\s*none/);
});

test("filterCss: empty unless enabled", () => {
  const v = { ...S.defaults(), filterBrightness: 120 };
  assert.equal(F.filterCss(v), "", "filtersEnabled is false");
  assert.equal(F.filterCss({ ...v, filtersEnabled: true }), "brightness(1.2)");
  assert.equal(F.filterCss({ ...v, filtersEnabled: true, enabled: false }), "");
  assert.equal(F.filterCss({ ...S.defaults(), filtersEnabled: true }), "", "all neutral => nothing");
});

test("filterCss: every filter, neutral values skipped", () => {
  const v = {
    enabled: true, filtersEnabled: true,
    filterBrightness: 150, filterContrast: 80, filterSaturation: 200,
    filterSepia: 30, filterGrayscale: 100, filterHue: 90,
  };
  assert.equal(
    F.filterCss(v),
    "brightness(1.5) contrast(0.8) saturate(2) sepia(0.3) grayscale(1) hue-rotate(90deg)"
  );
  assert.equal(F.filterCss({ ...v, filterContrast: 100, filterHue: 0 }), "brightness(1.5) saturate(2) sepia(0.3) grayscale(1)");
});

test("filterCss: garbage is ignored, never NaN in the output", () => {
  const out = F.filterCss({ enabled: true, filtersEnabled: true, filterBrightness: NaN, filterContrast: "x", filterHue: Infinity, filterSepia: null });
  assert.equal(out, "");
  assert.ok(!/NaN|Infinity|undefined/.test(F.filterCss({ enabled: true, filtersEnabled: true, filterBrightness: 33.333 })));
  for (const bad of [null, undefined, 5]) assert.equal(F.filterCss(bad), "");
});

const theater = {
  enabled: true, autoTheater: true, pathname: "/watch", isTheater: false,
  adShowing: false, videoId: "abc123xyz", doneFor: null, hasButton: true,
};

test("shouldAutoTheater: once per video, only when it makes sense", () => {
  assert.equal(F.shouldAutoTheater(theater), true);
  assert.equal(F.shouldAutoTheater({ ...theater, doneFor: "abc123xyz" }), false, "already done for this video");
  assert.equal(F.shouldAutoTheater({ ...theater, doneFor: "other" }), true, "new video");
  for (const patch of [
    { enabled: false }, { autoTheater: false }, { pathname: "/shorts/x" }, { pathname: "/" },
    { isTheater: true }, { adShowing: true }, { hasButton: false }, { videoId: "" }, { videoId: null },
  ]) {
    assert.equal(F.shouldAutoTheater({ ...theater, ...patch }), false, JSON.stringify(patch));
  }
  for (const bad of [null, undefined, 5]) assert.equal(F.shouldAutoTheater(bad), false);
});

const ap = { enabled: true, background: false, foreground: false, hiddenSinceLoad: false, userInteracted: false, pauses: 0, maxPauses: 5 };

test("shouldPauseAutoplay: both options off => never", () => {
  assert.equal(F.shouldPauseAutoplay({ ...ap, hiddenSinceLoad: true }), false);
  assert.equal(F.shouldPauseAutoplay(ap), false);
});

test("shouldPauseAutoplay: background option", () => {
  const c = { ...ap, background: true };
  assert.equal(F.shouldPauseAutoplay({ ...c, hiddenSinceLoad: true }), true);
  assert.equal(F.shouldPauseAutoplay({ ...c, hiddenSinceLoad: false }), false, "tab has been visible");
  assert.equal(F.shouldPauseAutoplay({ ...c, userInteracted: false }), false, "foreground tab untouched");
});

test("shouldPauseAutoplay: foreground option respects real user interaction", () => {
  const c = { ...ap, foreground: true };
  assert.equal(F.shouldPauseAutoplay(c), true);
  assert.equal(F.shouldPauseAutoplay({ ...c, userInteracted: true }), false);
});

test("shouldPauseAutoplay: bounded, master switch, garbage", () => {
  const c = { ...ap, foreground: true };
  assert.equal(F.shouldPauseAutoplay({ ...c, pauses: 4 }), true);
  assert.equal(F.shouldPauseAutoplay({ ...c, pauses: 5 }), false, "gives up after maxPauses");
  assert.equal(F.shouldPauseAutoplay({ ...c, maxPauses: 0 }), false);
  assert.equal(F.shouldPauseAutoplay({ ...c, enabled: false }), false);
  assert.equal(F.shouldPauseAutoplay({ ...c, pauses: NaN, maxPauses: NaN }), false);
  for (const bad of [null, undefined, 5, "x"]) assert.equal(F.shouldPauseAutoplay(bad), false);
});

// ---- Hide Shorts: CSS safety ----------------------------------------------------------

const CSS = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "extension", "css", "youtube.css"), "utf8");

// [{ selectors: [...], body }] for every rule that is scoped under a hide class
function hideRules() {
  const out = [];
  for (const m of CSS.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = m[1].split(",").map((x) => x.trim()).filter(Boolean);
    if (selectors.some((x) => x.startsWith("html.yte-hide-"))) out.push({ selectors, body: m[2].trim() });
  }
  return out;
}

test("hide rules: every selector is scoped under its html.yte-hide-* class", () => {
  const rules = hideRules();
  assert.ok(rules.length >= 5);
  for (const r of rules) for (const sel of r.selectors) assert.match(sel, /^html\.yte-hide-[a-z]+ /, sel);
});

test("hide rules: only ever display:none (never remove, move, resize or rewrite)", () => {
  for (const r of hideRules()) assert.equal(r.body.replace(/\s+/g, " "), "display: none !important;", r.selectors[0]);
});

test("hide rules never touch the infinite-scroll sentinel or the lists themselves", () => {
  for (const r of hideRules()) {
    for (const sel of r.selectors) {
      assert.ok(!/continuation/i.test(sel), "must not match continuation items: " + sel);
      assert.ok(!/#contents\b|ytd-item-section-renderer\b(?!:)|ytd-two-column|ytd-search\b|ytd-browse\b|ytd-page-manager|ytd-section-list-renderer/.test(sel), "must not match list containers: " + sel);
    }
  }
});

test("Shorts rules cover shelves, in-list items, sidebar and channel tab", () => {
  const all = hideRules().filter((r) => r.selectors.some((x) => x.includes("yte-hide-shorts"))).flatMap((r) => r.selectors).join("\n");
  for (const needle of [
    "ytd-reel-shelf-renderer",
    "ytd-rich-shelf-renderer[is-shorts]",
    "grid-shelf-view-model:has(ytm-shorts-lockup-view-model)",
    "ytd-video-renderer:has(a[href^=\"/shorts/\"])",
    "ytd-rich-item-renderer:has(a[href^=\"/shorts/\"])",
    "ytd-mini-guide-entry-renderer:has(a[href^=\"/shorts\"])",
    "yt-tab-shape[tab-title=\"Shorts\"]",
  ]) assert.ok(all.includes(needle), needle);
});

test("Hide Shorts is a setting, off by default, and maps to its class", () => {
  assert.equal(S.defaults().hideShorts, false);
  assert.equal(F.pageClasses({ ...S.defaults(), hideShorts: true })["yte-hide-shorts"], true);
  assert.equal(F.pageClasses({ ...S.defaults(), hideShorts: true, enabled: false })["yte-hide-shorts"], false);
});

test("no script in the extension ever removes or detaches YouTube nodes", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.join(__dirname, "..", "extension", "src");
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/\.(remove|removeChild|replaceWith|replaceChildren|outerHTML|innerHTML)\b/g)) {
      const line = src.slice(0, m.index).split("\n").length;
      const ctx = src.split("\n")[line - 1].trim();
      // allowed: our own bar/indicator/anchor elements, class and style property removal
      assert.ok(
        /classList\.remove|style\.removeProperty|\.a\.remove|a\.remove\(\)|host|el\.parentNode|shadow|removeEventListener|el = null|oldChild|firstChild|reg|IND/.test(ctx) ||
          /^\/\//.test(ctx) || /^\*/.test(ctx),
        f + ":" + line + " " + ctx
      );
    }
  }
});

test("youtube.css: EVERY rule is scoped to an html.yte-* class (inert until a setting adds it)", () => {
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  let n = 0;
  for (const m of stripped.matchAll(/([^{}]+)\{[^}]*\}/g)) {
    for (const sel of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
      n++;
      assert.match(sel, /^html\.yte-[a-z-]+(\s|$)/, "unscoped selector would affect every user: " + sel);
    }
  }
  assert.ok(n > 15);
});
