#!/bin/zsh
# Rebuild YouTube Enhancer, install it to ~/Applications, and register it with
# Safari. Run it any time: after changing the extension, after Xcode cleans its
# build folder, or if the extension stops showing up in Safari.
#
#   ./scripts/refresh-extension.sh              (asks before quitting Safari)
#   ./scripts/refresh-extension.sh --no-prompt  (never asks; leaves Safari alone)
#
# Safari itself resets "Develop > Allow Unsigned Extensions" every time it
# quits. If the extension is missing from Safari > Settings > Extensions after
# a restart, switch that on again and it will appear.

setopt NO_UNSET PIPE_FAIL
PROJECT_DIR="${0:A:h:h}"
XCODEPROJ="$PROJECT_DIR/YouTube Enhancer/YouTube Enhancer.xcodeproj"
BUILD_DIR="$PROJECT_DIR/build"
APP_NAME="YouTube Enhancer"
DEST_DIR="$HOME/Applications"
DEST="$DEST_DIR/$APP_NAME.app"
EXT_ID=""   # filled in after the build, from the built extension's own Info.plist
LOG="$BUILD_DIR/refresh.log"
# Optional: DEVELOPMENT_TEAM=YOURTEAMID ./scripts/refresh-extension.sh
# (otherwise the team chosen in Xcode's Signing & Capabilities is used)
TEAM_ARG=()
[[ -n "${DEVELOPMENT_TEAM:-}" ]] && TEAM_ARG=(DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM")
PROMPT=1
[[ "${1:-}" == "--no-prompt" ]] && PROMPT=0
[[ -t 0 ]] || PROMPT=0

say()  { print -P "%F{cyan}==>%f $*"; }
ok()   { print -P "%F{green}OK%f  $*"; }
warn() { print -P "%F{yellow}!!%f  $*"; }
die()  {
  print -P "%F{red}FAILED:%f $*"
  [[ -f "$LOG" ]] && { print "--- last lines of $LOG ---"; tail -n 15 "$LOG"; }
  (( PROMPT )) && { print -n "\nPress Return to close. "; read -r _ }
  exit 1
}

# Paths macOS currently has registered for our extension (pluginkit prints the
# name on one line and "Path = ..." a few lines below it).
registered_paths() {
  pluginkit -mAvvv -p com.apple.Safari.web-extension 2>/dev/null \
    | awk -v id="$EXT_ID" '$0 ~ id {f=1} f && /Path = / {sub(/.*Path = /, ""); print; f=0}'
}

mkdir -p "$BUILD_DIR" "$DEST_DIR"
: > "$LOG"

say "Checking Xcode"
xcodebuild -version >>"$LOG" 2>&1 || die "Xcode is not selected. Run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"

say "Building (about a minute)"
xcodebuild -project "$XCODEPROJ" -scheme "$APP_NAME" -configuration Release \
  -derivedDataPath "$BUILD_DIR" -allowProvisioningUpdates "${TEAM_ARG[@]}" build >>"$LOG" 2>&1 \
  || { grep -E "error:" "$LOG" | head -5; die "The build failed. If it mentions signing, open the project in Xcode once, pick your team under Signing & Capabilities, then run this again."; }
BUILT="$BUILD_DIR/Build/Products/Release/$APP_NAME.app"
[[ -d "$BUILT" ]] || die "Build finished but the app was not found at $BUILT"
ok "Built"
EXT_ID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" \
  "$BUILT/Contents/PlugIns/$APP_NAME Extension.appex/Contents/Info.plist" 2>/dev/null) \
  || die "Could not read the extension's bundle identifier from the built app."

say "Checking the signature"
codesign --verify --deep --strict "$BUILT" >>"$LOG" 2>&1 || die "The built app's signature is not valid."
APP_TEAM=$(codesign -dvv "$BUILT" 2>&1 | sed -n 's/^TeamIdentifier=//p')
EXT_TEAM=$(codesign -dvv "$BUILT/Contents/PlugIns/$APP_NAME Extension.appex" 2>&1 | sed -n 's/^TeamIdentifier=//p')
[[ -n "$APP_TEAM" && "$APP_TEAM" == "$EXT_TEAM" ]] \
  || die "App team ($APP_TEAM) and extension team ($EXT_TEAM) differ; Safari would ignore the extension."
ok "Signed by team $APP_TEAM (app and extension match)"

say "Installing to $DEST"
osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1
sleep 1
# Forget older registered copies (Xcode's build folder, earlier installs).
registered_paths | while read -r old; do
    [[ "$old" == "$DEST/"* ]] || pluginkit -r "$old" >/dev/null 2>&1
  done
rm -rf "$DEST"
ditto "$BUILT" "$DEST" || die "Could not copy the app to $DEST"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST" >/dev/null 2>&1
pluginkit -a "$DEST/Contents/PlugIns/$APP_NAME Extension.appex" >/dev/null 2>&1
open -g "$DEST"          # opening the app once makes macOS register the extension
sleep 3
osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1

# The build itself registers its output; drop it so only the installed copy
# exists (two copies = two extensions in Safari, both running).
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
pluginkit -r "$BUILT/Contents/PlugIns/$APP_NAME Extension.appex" >/dev/null 2>&1
$LSREG -u "$BUILT" >/dev/null 2>&1
rm -rf "$BUILD_DIR/Build"

REG=$(registered_paths | head -1)
COUNT=$(registered_paths | wc -l | tr -d ' ')
if [[ "$REG" == "$DEST/"* && "$COUNT" == "1" ]]; then
  ok "Registered with Safari from $DEST (exactly one copy)"
elif [[ "$REG" == "$DEST/"* ]]; then
  warn "$COUNT copies are registered; Safari may list the extension twice. Paths:"; registered_paths
else
  warn "macOS did not report the extension at $DEST (it says: ${REG:-nothing}). Try opening $DEST once by hand."
fi

if pgrep -x Safari >/dev/null; then
  if (( PROMPT )); then
    print -n "Safari is open. Quit and reopen it now so it loads the new version? Your tabs come back. [y/N] "
    read -r ans
    if [[ "$ans" == [yY]* ]]; then
      osascript -e 'tell application "Safari" to quit' >/dev/null 2>&1
      sleep 2
      open -a Safari
      ok "Safari restarted"
    else
      warn "Quit and reopen Safari yourself (Cmd+Q) to load the new version."
    fi
  else
    warn "Safari is open: quit and reopen it (Cmd+Q) to load the new version."
  fi
fi

print ""
print -P "%F{green}Done.%f If YouTube Enhancer is missing from Safari > Settings > Extensions,"
print "turn on  Develop > Allow Unsigned Extensions  (Safari switches it off each time it quits)."
(( PROMPT )) && { print -n "\nPress Return to close. "; read -r _ }
exit 0
