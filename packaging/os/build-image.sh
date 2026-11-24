#!/usr/bin/env bash
# Builds a Mantel OS image for 64-bit UEFI PCs (Ubuntu Core 24, test grade).
#
# Usage: packaging/os/build-image.sh <mantel.snap> <out-dir>
# Needs snapd and ubuntu-image (`sudo snap install ubuntu-image --classic`) and python3-yaml.
#
# The image uses Canonical's "dangerous" reference model, which lets us add snaps that are not
# in the model and swap in our own copy of the pc gadget (carrying Mantel's defaults). Images
# signed with Mantel's own model come in stage 5, once the brand account exists.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mantel_snap="$(readlink -f "$1")"
out="$(mkdir -p "$2" && cd "$2" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"

# Channels: the reference model follows edge/beta; a family's box follows stable.
KERNEL_CHANNEL="${KERNEL_CHANNEL:-24/stable}"
# The gadget carries the boot loaders (shim, GRUB). 24/stable's GRUB (SBAT grub,4) is on the
# revocation list Windows updates put in PC firmware, so Secure Boot refuses it ("Verification
# failed: (0x1A) Security Violation"). 24/beta has the GRUB Ubuntu 24.04 itself ships.
GADGET_CHANNEL="${GADGET_CHANNEL:-24/beta}"
# Refuse to build with a GRUB below this SBAT generation (packaging/os/boot-chain.sh shows them).
MIN_GRUB_SBAT="${MIN_GRUB_SBAT:-5}"
FRAME_CHANNEL="${FRAME_CHANNEL:-24/stable}"
# The kiosk's 24 track is the current WebKit on core24 (shares Frame's graphics stack); its
# latest/stable is WebKit 2.38 from 2023 on core20.
KIOSK_CHANNEL="${KIOSK_CHANNEL:-24/edge}"
NM_CHANNEL="${NM_CHANNEL:-24/stable}"

snap_id() { snap info "$1" | awk '/^snap-id:/ {print $2}'; }
ids="$(printf '{"ubuntu-frame":"%s","wpe-webkit-mir-kiosk":"%s"}' \
  "$(snap_id ubuntu-frame)" "$(snap_id wpe-webkit-mir-kiosk)")"
echo "snap ids: $ids"
echo "$ids" > ids.json
snap info wpe-webkit-mir-kiosk | sed -n '/^channels:/,$p' || true

# Our pc gadget: the store's, with Mantel's defaults and connections added.
snap download pc --channel="$GADGET_CHANNEL" --basename=pc-store >/dev/null
unsquashfs -q -d gadget pc-store.snap
grub_gen="$(objcopy -O binary --only-section=.sbat gadget/grubx64.efi /dev/stdout | tr -d '\0' | awk -F, '$1=="grub" {print $2}')"
echo "gadget $GADGET_CHANNEL: GRUB SBAT generation ${grub_gen:-unknown}"
if [ -z "$grub_gen" ] || [ "$grub_gen" -lt "$MIN_GRUB_SBAT" ]; then
  echo "this gadget's GRUB is revoked for Secure Boot (needs grub,$MIN_GRUB_SBAT or later)" >&2; exit 1
fi
python3 "$here/gadget.py" gadget ids.json
cp "$here/cloud.conf" gadget/cloud.conf
# The system log goes to the screen (tty1, the last console), so the long first boot shows
# progress instead of one still line; kernel messages also go to the serial port, and the VM
# test's diagnostics write there directly.
ls gadget
printf '%s' "${CMDLINE_EXTRA:-console=ttyS0,115200n8 console=tty1 systemd.journald.forward_to_console=1}" > gadget/cmdline.extra
snap pack gadget . --filename=pc-mantel.snap >/dev/null

# Snaps the kiosk needs (graphics drivers, bases) are added as ubuntu-image asks for them.
extra=(${EXTRA_SNAPS:-})
for attempt in 1 2 3 4 5 6 7 8; do
  args=()
  for s in "${extra[@]}"; do args+=(--snap "$s"); done
  rm -rf img
  if ubuntu-image snap "$here/models/ubuntu-core-24-amd64-dangerous.model" \
    --output-dir "$work/img" \
    --snap "$work/pc-mantel.snap" \
    --snap "pc-kernel=$KERNEL_CHANNEL" \
    --snap "core24=latest/stable" \
    --snap "snapd=latest/stable" \
    --snap "$mantel_snap" \
    --snap "ubuntu-frame=$FRAME_CHANNEL" \
    --snap "wpe-webkit-mir-kiosk=$KIOSK_CHANNEL" \
    --snap "network-manager=$NM_CHANNEL" \
    "${args[@]}" 2>&1 | tee build.log; then
    break
  fi
  need="$(grep -oE '(default provider|base) "[a-z0-9-]+"' build.log | head -1 | grep -oE '"[a-z0-9-]+"' | tr -d '"' || true)"
  if [ -z "$need" ]; then echo "image build failed" >&2; exit 1; fi
  echo "adding prerequisite snap: $need"
  extra+=("$need")
done
echo "prerequisites added: ${extra[*]:-none}"

ls -la img
img="$(ls img/*.img | head -1)"
mv "$img" "$out/mantel-os-pc-amd64.img"
cp img/seed.manifest "$out/" 2>/dev/null || true
echo "$out/mantel-os-pc-amd64.img"
