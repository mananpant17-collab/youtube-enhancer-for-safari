// Dev-only probe: loads a YouTube URL in a real WebKit view (the engine Safari
// uses), injects the extension's CSS / scripts at document start the way the
// extension does, then reports what the page actually did.
//
//   swiftc tests/manual/webkit-probe.swift -o /tmp/webkit-probe -framework AppKit -framework WebKit
//   /tmp/webkit-probe <control|css|full> <url> [scrolls]
//
//   control : nothing injected (baseline)
//   css     : css/youtube.css injected + <html class="yte-hide-shorts">
//   full    : the content scripts too, with a fake browser.storage that
//             turns Hide Shorts on
import AppKit
import WebKit

let args = CommandLine.arguments
let mode = args.count > 1 ? args[1] : "control"
let urlString = args.count > 2 ? args[2] : "https://www.youtube.com/results?search_query=naruto+vs+sasuke"
let scrolls = args.count > 3 ? Int(args[3]) ?? 4 : 4
let root = FileManager.default.currentDirectoryPath + "/extension/"

func read(_ path: String) -> String { (try? String(contentsOfFile: root + path, encoding: .utf8)) ?? "" }

let probeJS = """
(function () {
  const vis = s => [...document.querySelectorAll(s)].filter(e => e.getClientRects().length > 0).length;
  const spinner = document.querySelector('ytd-search tp-yt-paper-spinner, ytd-search #spinner, #spinner');
  const cont = document.querySelector('ytd-continuation-item-renderer');
  return JSON.stringify({
    ready: document.readyState,
    htmlClass: document.documentElement.className.split(/\\s+/).filter(c => c.startsWith('yte')).join(','),
    videosInDom: document.querySelectorAll('ytd-video-renderer').length,
    videosVisible: vis('ytd-video-renderer'),
    shortsLockupsVisible: vis('ytm-shorts-lockup-view-model'),
    shelvesInDom: document.querySelectorAll('grid-shelf-view-model').length,
    shelvesVisible: vis('grid-shelf-view-model'),
    continuationInDom: !!cont,
    continuationDisplay: cont ? getComputedStyle(cont).display : null,
    spinnerVisible: spinner ? spinner.getClientRects().length > 0 && getComputedStyle(spinner).display !== 'none' : null,
    listTags: (() => { const c = document.querySelector('ytd-search ytd-item-section-renderer #contents, ytd-search #contents'); if (!c) return null; const m = {}; [...c.children].forEach(e => { const k = e.tagName.toLowerCase(); m[k] = (m[k]||0) + 1; }); return m; })(),
    lockups: document.querySelectorAll('yt-lockup-view-model').length,
    lockupsVisible: vis('yt-lockup-view-model'),
    lockupsWithShortsLink: document.querySelectorAll('yt-lockup-view-model:has(a[href^="/shorts/"])').length,
    nodes: document.getElementsByTagName('*').length,
    scrollH: document.documentElement.scrollHeight,
    title: document.title,
    ytInitialData: typeof window.ytInitialData
  });
})()
"""

class Probe: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    var web: WKWebView!
    var window: NSWindow!

    func start() {
        let conf = WKWebViewConfiguration()
        conf.applicationNameForUserAgent = "Version/27.0 Safari/605.1.15"
        let ucc = WKUserContentController()
        ucc.add(self, name: "log")
        func inject(_ js: String) {
            ucc.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        }
        // surface page errors
        inject("window.addEventListener('error', e => webkit.messageHandlers.log.postMessage('PAGE ERROR: ' + e.message + ' @' + (e.filename||'').split('/').pop() + ':' + e.lineno));")

        if mode == "css" || mode == "full" {
            let css = read("css/youtube.css")
            let escaped = css.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "`", with: "\\`").replacingOccurrences(of: "$", with: "\\$")
            inject("""
            (function(){ try { const s = document.createElement('style'); s.id='yte-probe-css'; s.textContent = `\(escaped)`;
              (document.head || document.documentElement).appendChild(s);
              if (\(mode == "css")) document.documentElement.classList.add('yte-hide-shorts'); } catch (e) { webkit.messageHandlers.log.postMessage('css inject failed ' + e); } })();
            """)
        }
        if mode == "full" {
            // fake browser.* so settings.js loads {hideShorts: true}
            inject("""
            (function(){ const data = { settings: { schemaVersion: 1, values: { hideShorts: true } } };
              window.browser = { runtime: { sendMessage: () => Promise.resolve() },
                storage: { local: { get: k => Promise.resolve(k in data ? { [k]: data[k] } : {}), set: o => Promise.resolve() },
                           onChanged: { addListener() {}, removeListener() {} } } }; })();
            """)
            for f in ["src/settings.js", "src/gesture-speed.js", "src/speed-policy.js", "src/features.js",
                      "src/bar-logic.js", "src/indicator.js", "src/controlbar.js", "src/content.js"] {
                inject("try {\n" + read(f) + "\n} catch (e) { webkit.messageHandlers.log.postMessage('script " + f + " threw: ' + e); }")
            }
        }
        conf.userContentController = ucc

        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1440, height: 900), configuration: conf)
        web.navigationDelegate = self
        window = NSWindow(contentRect: NSRect(x: 40, y: 40, width: 1440, height: 900), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = web
        window.orderFrontRegardless()
        web.load(URLRequest(url: URL(string: urlString)!))
        log("mode=\(mode) url=\(urlString)")
        schedule()
    }

    func log(_ s: String) { print(s); fflush(stdout) }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { log("  [page] \(m.body)") }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { log("NAV FAIL \(e)") }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { log("NAV FAIL (provisional) \(e)") }

    func probe(_ label: String, _ next: @escaping () -> Void) {
        web.evaluateJavaScript(probeJS) { r, e in
            self.log("\(label): \(r as? String ?? "ERR \(String(describing: e))")")
            next()
        }
    }

    // SPA=1: start wherever the URL says (e.g. the home page), then type a search
    // into YouTube's own search box so the results arrive via in-page navigation,
    // like a real user, instead of a full page load.
    let searchJS = """
    (function () {
      const i = document.querySelector('input[name="search_query"], input.ytSearchboxComponentInput');
      if (!i) return 'no search box';
      i.focus(); i.value = 'naruto vs sasuke';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      const b = document.querySelector('button.ytSearchboxComponentSearchButton, #search-icon-legacy, button[aria-label="Search"]');
      if (!b) return 'no search button';
      b.click();
      return 'searched';
    })()
    """

    func schedule() {
        let spa = ProcessInfo.processInfo.environment["SPA"] != nil
        if spa {
            DispatchQueue.main.asyncAfter(deadline: .now() + 9) {
                self.web.evaluateJavaScript(self.searchJS) { r, _ in self.log("typed search in page: \(r ?? "?")") }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + (spa ? 22 : 12)) {
            self.probe("loaded") { self.scroll(0) }
        }
    }

    func scroll(_ i: Int) {
        if i >= scrolls { log("done"); exit(0) }
        web.evaluateJavaScript("window.scrollTo(0, document.documentElement.scrollHeight);") { _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                self.probe("after scroll \(i + 1)") { self.scroll(i + 1) }
            }
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let probe = Probe()
DispatchQueue.main.async { probe.start() }
DispatchQueue.main.asyncAfter(deadline: .now() + 120) { print("timeout"); exit(2) }
app.run()
