"use strict";
// Guards against "works in tests, missing from the Safari app":
//  - every top-level entry of extension/ is bundled by the Xcode project
//  - every file the manifest points to exists
//  - every script a page loads exists
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const EXT = path.join(ROOT, "extension");
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));

test("every top-level entry of extension/ is referenced by the Xcode project", () => {
  const proj = fs.readFileSync(path.join(ROOT, "YouTube Enhancer", "YouTube Enhancer.xcodeproj", "project.xcproj"), "utf8");
  for (const name of fs.readdirSync(EXT)) {
    if (name.startsWith(".")) continue;
    assert.ok(proj.includes(`"../../extension/${name}"`), `${name} is not bundled by the Xcode project`);
  }
});

test("manifest: every referenced file exists", () => {
  const files = new Set();
  const add = (f) => f && files.add(f);
  Object.values(manifest.icons || {}).forEach(add);
  Object.values((manifest.action || {}).default_icon || {}).forEach(add);
  add((manifest.action || {}).default_popup);
  add((manifest.options_ui || {}).page);
  add((manifest.background || {}).service_worker);
  for (const cs of manifest.content_scripts || []) (cs.js || []).concat(cs.css || []).forEach(add);
  assert.ok(files.size > 5);
  for (const f of files) assert.ok(fs.existsSync(path.join(EXT, f)), `manifest references missing file: ${f}`);
});

test("manifest: minimal permissions and the required match patterns", () => {
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, ["*://*.youtube.com/*"]);
  const cs = manifest.content_scripts[0];
  assert.deepEqual(cs.matches, ["*://*.youtube.com/*"]);
  assert.equal(cs.all_frames, true);
});

test("content script load order: dependencies come before content.js", () => {
  const js = manifest.content_scripts[0].js;
  assert.equal(js[js.length - 1], "src/content.js");
  for (const dep of ["src/settings.js", "src/gesture-speed.js", "src/speed-policy.js", "src/features.js", "src/bar-logic.js", "src/indicator.js", "src/controlbar.js"]) {
    assert.ok(js.indexOf(dep) >= 0 && js.indexOf(dep) < js.indexOf("src/content.js"), dep);
  }
});

test("extension pages: every <script src> and stylesheet exists", () => {
  for (const page of ["options/options.html", "popup/popup.html"]) {
    const dir = path.dirname(path.join(EXT, page));
    const html = fs.readFileSync(path.join(EXT, page), "utf8");
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(refs.length >= 3, page);
    for (const r of refs) assert.ok(fs.existsSync(path.resolve(dir, r)), `${page} references missing ${r}`);
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), page + " has an inline script (blocked by extension CSP)");
  }
});

test("no network, eval or remote code in the extension", () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(EXT).filter((x) => x.endsWith(".js"))) {
    const src = fs.readFileSync(f, "utf8");
    assert.ok(!/\beval\s*\(|new Function\s*\(|\bfetch\s*\(|XMLHttpRequest|importScripts/.test(src), f);
  }
});
