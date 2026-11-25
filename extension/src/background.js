// YouTube Enhancer for Safari - background service worker.
// Content scripts cannot open the options page themselves, so they ask us.
"use strict";

try {
  var api = typeof browser !== "undefined" ? browser : chrome;

  api.runtime.onInstalled.addListener(function (details) {
    console.log("[YTE] installed", details && details.reason);
  });

  api.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== "yte:open-options") return;
    var url = api.runtime.getURL("options/options.html");
    Promise.resolve()
      .then(function () {
        return api.runtime.openOptionsPage();
      })
      .catch(function () {
        return api.tabs.create({ url: url });
      })
      .catch(function () {});
  });
} catch (err) {
  console.log("[YTE] background init failed", err);
}
