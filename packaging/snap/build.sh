#!/usr/bin/env bash
# Packs the Mantel snap from a bundle made by packaging/build-bundle.mjs.
# Usage: packaging/snap/build.sh <bundle-dir> <version> <out-dir>
# Needs `snap pack` (snapd) or, failing that, mksquashfs.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bundle="$(cd "$1" && pwd)"; version="$2"; out="$3"
case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64) arch=arm64 ;; *) echo "unsupported arch" >&2; exit 1 ;; esac
# Snap versions: at most 32 characters of letters, digits and . + ~ - :
version="$(printf '%s' "$version" | tr -c 'A-Za-z0-9.+~:-' '-' | cut -c1-32)"

prime="$(mktemp -d)"
trap 'rm -rf "$prime"' EXIT
cp -a "$bundle/." "$prime/"
mkdir -p "$prime/meta/hooks" "$prime/bin"
cp "$here"/bin/* "$prime/bin/"
cp "$here"/hooks/* "$prime/meta/hooks/"
sed -e "s/@VERSION@/$version/" -e "s/@ARCH@/$arch/" "$here/snap.yaml" > "$prime/meta/snap.yaml"
chmod -R a+rX "$prime"
chmod 755 "$prime"/bin/mantel-server "$prime"/bin/mantel-health "$prime"/meta/hooks/* "$prime/node"
# A deliberately broken build, to prove a failed update undoes itself (see README).
if [ "${MANTEL_BREAK_UPDATE_CHECK:-}" = 1 ]; then touch "$prime/break-update-check"; fi

mkdir -p "$out"
file="$out/mantel_${version}_${arch}.snap"
rm -f "$file"
if command -v snap >/dev/null 2>&1; then
  snap pack --check-skeleton "$prime"
  snap pack "$prime" "$out" --filename="$(basename "$file")"
else
  mksquashfs "$prime" "$file" -noappend -comp xz -all-root -no-xattrs -no-fragments -quiet
fi
echo "$file"
