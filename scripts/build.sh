#!/bin/zsh
# Unsigned CLI build, for verification only. It builds into a throwaway folder
# and unregisters the result, so it can never leave a second copy of the
# extension registered with Safari. Real installs use refresh-extension.sh.
set -euo pipefail
cd "$(dirname "$0")/../YouTube Enhancer"
OUT=/private/tmp/yte-verify-build
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
rc=0
xcodebuild -project "YouTube Enhancer.xcodeproj" -scheme "YouTube Enhancer" \
  -configuration Debug -derivedDataPath "$OUT" CODE_SIGNING_ALLOWED=NO "$@" build || rc=$?
APP="$OUT/Build/Products/Debug/YouTube Enhancer.app"
pluginkit -r "$APP/Contents/PlugIns/YouTube Enhancer Extension.appex" >/dev/null 2>&1 || true
"$LSREG" -u "$APP" >/dev/null 2>&1 || true
exit $rc
