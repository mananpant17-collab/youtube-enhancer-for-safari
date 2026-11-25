// Dev-only: serves extension/ on http://localhost:8765 and injects a fake
// `browser` API into HTML pages so the options page and popup can be viewed
// and clicked in an ordinary browser. Not part of the extension.
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "extension");
const SHIM = path.resolve(__dirname, "..", "tests", "manual", "browser-shim.js");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    if (url === "/__shim.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      return res.end(fs.readFileSync(SHIM));
    }
    const file = path.resolve(ROOT, "." + url);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end("not found");
    }
    const ext = path.extname(file);
    let body = fs.readFileSync(file);
    if (ext === ".html") body = Buffer.from(body.toString().replace("<head>", '<head><script src="/__shim.js"></script>'));
    res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  })
  .listen(8765, "127.0.0.1", () => console.log("preview on http://localhost:8765/options/options.html"));
