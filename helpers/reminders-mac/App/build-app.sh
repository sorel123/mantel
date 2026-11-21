#!/bin/bash
# Build MantelReminders.app (universal) and zip it. Run on a Mac with Xcode or the Swift toolchain:
#   helpers/reminders-mac/App/build-app.sh [version] [out-dir]
set -euo pipefail
cd "$(dirname "$0")/.."
version="${1:-1.0.0}"
out="${2:-dist}"
swift build -c release --arch arm64 --arch x86_64
bin="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)/MantelReminders"
app="$out/Mantel Reminders.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin" "$app/Contents/MacOS/MantelReminders"
sed "s#<key>CFBundleShortVersionString</key><string>1.0.0</string>#<key>CFBundleShortVersionString</key><string>${version%%-*}</string>#" \
  App/Info.plist > "$app/Contents/Info.plist"
# Ad-hoc signature: not notarised, so the first open is right-click > Open (see docs/list-sharing.md).
codesign --force --deep --sign - "$app"
codesign --verify --verbose "$app"
(cd "$out" && rm -f MantelReminders-mac.zip && ditto -c -k --keepParent "Mantel Reminders.app" MantelReminders-mac.zip)
echo "Built $out/MantelReminders-mac.zip"
