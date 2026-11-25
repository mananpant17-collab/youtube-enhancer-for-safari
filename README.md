# YouTube Enhancer for Safari

A free, open-source Safari extension for Mac. It adds pinch-to-change-speed, a control bar under the player, and options to hide Shorts and other clutter on YouTube.

<!-- TODO: replace this placeholder with real images. See screenshots/README.md for the list. -->
> 📷 **Screenshots coming soon.** Images will live in the [`screenshots/`](screenshots/) folder.

## Features

**Speed**
- Pinch out or in on the trackpad, with the cursor over the video, to speed up or slow down. Each step is 0.25× by default. The range is 0.25× to 4×.
- Hold Ctrl and scroll over the video to do the same with a mouse.
- A small label (like "1.75×") shows over the player when the speed changes.
- Your speed is remembered for the rest of that Safari tab's session.
- Optional keyboard shortcuts (off by default): `]` faster, `[` slower, `\` back to 1×. You can change the keys.

**Control bar under the video** (every button can be hidden)
- Speed − / + / reset to 1×
- Loop
- Cinema mode (dims the rest of the page)
- Theater mode
- Screenshot of the current video frame
- Picture in Picture
- Flip the video horizontally or vertically
- Video filters on/off
- A shortcut to the settings page

**Hide things** (all off by default; these only hide, they never delete anything from the page)
- Shorts: shelves, Shorts mixed into lists, the sidebar entry, and the channel tab
- Comments
- Related videos
- Live chat
- Info cards and end screens

**Player**
- Open videos in theater mode automatically
- Don't autoplay videos that open in a background tab
- Don't autoplay the first video when a YouTube page loads

**Video filters**
- Brightness, contrast, saturation, sepia, grayscale and hue rotation

**Settings**
- A toolbar popup with quick on/off switches
- A full settings page. Changes save at once and apply to open YouTube tabs without a reload.

**Not built yet:** volume booster, default volume, playback-quality picker, pop-up player.

## Important: this is not from the App Store

You build this extension yourself, on your own Mac, with Xcode. Xcode is free. You do not need to pay Apple anything.

The code is open source, so you can read every line before you run it. The extension code is in the [`extension/`](extension/) folder.

## Privacy

- Everything runs on your Mac, inside Safari.
- The extension collects no data. It has no analytics.
- Its code makes no network requests and loads no code from the internet. The automated tests check for this (`tests/project.test.js`).
- Your settings are stored locally in Safari's extension storage.
- Its permissions are `storage` and access to `youtube.com` pages only. Safari asks you before it lets the extension touch any website.
- The Screenshot button saves an image to your Mac using Safari's normal download. It is not uploaded anywhere.

## Requirements

Built and tested on this setup:

- **macOS 27.0.1**
- **Safari 27.0.1**
- **Xcode 27.2**
- A free **Apple ID**. You do not need a paid developer account.

\* **Other versions are untested.** My estimate, not a promise:
- The project is set to need macOS 27.0 for the app. Xcode refuses to run it on older macOS until you lower that. To try: click the project, pick each target, open **General → Minimum Deployments**, and lower it.
- I checked that the code *compiles* for macOS 12 to 27. I have not run it on anything older than macOS 27.
- The extension uses CSS `:has()`, which needs **Safari 15.4 or newer**. Safari's current extension format (Manifest V3) also arrived around then. So **macOS 13 (Safari 16) or newer** is my best guess for it working.
- Xcode 27.2 made the project file. Older Xcode versions may not open it.
- If you try an older version, please open an issue and tell me what happened.

## Installation

1. **Install Xcode** from the Mac App Store. It is a big download. Open it once and accept the license.
2. **Download the code.** On this page, click the green **Code** button, then **Download ZIP**. Double-click the ZIP to unzip it.
3. **Open the project.** Open the unzipped folder, then the `YouTube Enhancer` folder inside it. Double-click **`YouTube Enhancer.xcodeproj`**. Xcode opens.
4. **Add your Apple ID to Xcode.** Choose **Xcode → Settings → Accounts**. Click **+**, choose **Apple ID**, and sign in.
5. **Pick your team, for both targets.**
   1. In the left sidebar, click the blue **YouTube Enhancer** project icon at the top.
   2. Under **Targets**, click **YouTube Enhancer**. Open the **Signing & Capabilities** tab. Under **Team**, choose your name (it may say "Personal Team").
   3. Under **Targets**, click **YouTube Enhancer Extension**. Open **Signing & Capabilities**. Choose the **same** team.
6. **Give the app your own bundle identifier.** Every app needs a unique ID, and the one in this project is only a placeholder that Apple will probably refuse. Do this for **both** targets, in the same **Signing & Capabilities** tab:
   1. Click **YouTube Enhancer**. Change **Bundle Identifier** from `com.example.YouTubeEnhancer` to something with your name in it, like `com.janedoe.youtubeenhancer`. Use only letters, numbers, dots and hyphens.
   2. Click **YouTube Enhancer Extension**. Set its **Bundle Identifier** to the **same text plus `.Extension`**, like `com.janedoe.youtubeenhancer.Extension`.
   3. The extension's ID **must start with** the app's ID. If the red errors don't go away, see [Troubleshooting](#troubleshooting).
7. **Choose what to run.** At the top of the Xcode window, set the scheme to **YouTube Enhancer** and the destination to **My Mac**.
8. **Press Run** (the ▶ button, or ⌘R). Xcode builds the app. It then opens a small window.
9. **Turn it on in Safari.** Open Safari, then choose **Safari → Settings → Extensions**. Tick the box next to **YouTube Enhancer**.
10. **Allow YouTube.** When Safari asks about website access, allow it for **youtube.com**. If it does not ask, click **Edit Websites…** and set **youtube.com** to **Allow**.
11. Open a YouTube video, put the cursor over it, and pinch on the trackpad.

You can quit Xcode and the small app window after this. The extension stays installed.

## Using it

- **Quick switches:** click the extension's button in Safari's toolbar. If you can't see it, right-click the toolbar, choose **Customize Toolbar…**, and drag it in.
- **All settings:** click **All settings…** in that popup. You can also click the settings button on the control bar, or use **Safari → Settings → Extensions**.
- **Change speed:** pinch over the video, or use the **−** and **+** buttons on the control bar. Click the **1×** button to reset.
- **Hide Shorts and other clutter:** open the settings and tick the options under **Page layout**.
- **Master switch:** "Enable YouTube Enhancer" at the top of the popup turns everything off at once.

## Updating to a new version

1. Download the new ZIP and unzip it.
2. Open the new `YouTube Enhancer.xcodeproj`.
3. Choose your team for **both** targets again (step 5 above). The downloaded project does not know your team.
4. Set the same bundle identifiers again for **both** targets (step 6 above). Use exactly the same text as before, so Safari sees the same extension and keeps your settings.
5. Press Run (▶).
6. Quit Safari (⌘Q) and open it again.

## Troubleshooting

**The extension doesn't show in Safari → Settings → Extensions**
1. Check that a Team is chosen for **both** targets (Signing & Capabilities). The two teams must match.
2. Press Run (▶) in Xcode again.
3. Quit Safari (⌘Q) and open it again.

**"Bundle identifier is not available" or other signing errors**
Each bundle identifier can belong to only one developer. If Xcode still complains after step 6, pick something more unusual (add a few extra letters or digits). Do it for **both** targets in **Signing & Capabilities**:
- App: for example `com.yourname.youtubeenhancer2`
- Extension: the app's identifier plus `.Extension`, for example `com.yourname.youtubeenhancer2.Extension`

The extension's identifier must start with the app's identifier.

**Still not showing up (fallback)**
1. In Safari, choose **Safari → Settings → Advanced** and tick **Show features for web developers**.
2. In the menu bar, choose **Develop → Allow Unsigned Extensions**. Enter your Mac password if asked.
3. Go back to **Settings → Extensions** and tick the extension.

Safari turns **Allow Unsigned Extensions** off every time it quits. If the extension disappears after you restart Safari, turn it on again.

**It appears twice in Safari**
This happens if more than one copy of the app is installed. Delete the extra copies of the app, run it once from Xcode, then quit and reopen Safari.

**Nothing happens on YouTube**
- In **Safari → Settings → Extensions**, click **Edit Websites…** and set **youtube.com** to **Allow**.
- Open the popup and check that "Enable YouTube Enhancer" is on.
- Reload the YouTube tab.
- Pinch with the cursor over the video. Pinching elsewhere zooms the page as normal.

**It stopped working on YouTube**
YouTube may have changed its page. [Open an issue](../../issues) and say what no longer works. If it stopped after a long time with no YouTube change, the signing certificate may have expired (free ones last about a year). Press Run (▶) in Xcode again.

**YouTube search spins forever or shows endless Shorts**
In the author's testing this was caused by the *uBlock Origin Lite* extension, not by this one. Try lowering its filtering level for youtube.com, or turn it off there.

## Uninstalling

1. In Safari, choose **Safari → Settings → Extensions** and untick the extension.
2. Find the **YouTube Enhancer** app and drag it to the Trash. If you only ran it from Xcode, it lives in Xcode's build folder. Easiest way to clean it up: in Xcode, choose **Product → Clean Build Folder**, then delete the folder you unzipped.
3. Quit and reopen Safari.

## Contributing and reporting issues

Bug reports and ideas are welcome. Use the **Issues** tab on this page. Please include:
- your macOS, Safari and Xcode versions
- what you did, what you expected, and what happened
- the YouTube page type (home, watch page, search, channel)

To see what the extension is doing, turn on **Debug logging** in the settings. It prints `[YTE]` lines in Safari's Web Inspector console.

For developers:

- The extension source is in `extension/`. It is a standard Manifest V3 web extension with no dependencies and no build step.
- The Xcode project in `YouTube Enhancer/` only wraps `extension/` so Safari can load it.
- Run the tests with `npm test` (needs Node 20 or newer). They use only Node's built-in test runner.
- `scripts/refresh-extension.sh` rebuilds and installs the app to `~/Applications` from the command line. Don't mix it with pressing Run in Xcode, or Safari may list the extension twice.
- `tests/manual/webkit-probe.swift` loads YouTube in a plain WebKit view with the extension's CSS and scripts injected. See the comment at the top of the file.

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by YouTube or Google. "YouTube" is a trademark of Google LLC. It is used here only to say which website the extension works with.

## License

MIT. See [LICENSE](LICENSE).
