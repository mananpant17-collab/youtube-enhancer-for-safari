// Stand-in for controlbar.js in the fake-page harness: records how
// content.js drives the bar. The real bar DOM is verified on a live page.
(function () {
  window.__bar = { calls: [], created: 0, deps: null };
  window.YTE_ControlBar = {
    create: function (deps) {
      window.__bar.created++;
      window.__bar.deps = deps;
      function rec(name) {
        return function () {
          window.__bar.calls.push(name);
        };
      }
      return { mount: rec("mount"), unmount: rec("unmount"), update: rec("update"), newVideo: rec("newVideo"), destroy: rec("destroy") };
    },
  };
})();
