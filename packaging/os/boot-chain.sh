#!/usr/bin/env bash
# Prints what a PC's firmware checks when it boots Mantel OS: the pc gadget's shim and GRUB
# (signatures and SBAT generations) for each channel of the 24 track, next to the revocation
# level Microsoft ships to Windows PCs. A PC refuses a boot loader whose SBAT generation is
# below that level ("Verification failed: Security Violation").
# Usage: packaging/os/boot-chain.sh   (needs snap, unsquashfs, objcopy, sbverify)
set -euo pipefail
work="$(mktemp -d)"; cd "$work"
echo "== Microsoft/shim SBAT revocation levels (shim's SbatLevel_Variable.txt)"
curl -fsSL https://raw.githubusercontent.com/rhboot/shim/main/SbatLevel_Variable.txt | tail -40 || true
for risk in stable candidate beta edge; do
  echo; echo "================ pc 24/$risk"
  rm -rf g pc.snap
  snap download pc --channel="24/$risk" --basename=pc >/dev/null 2>&1 || { echo "(none)"; continue; }
  unsquashfs -q -d g pc.snap
  grep -E '^version' g/meta/snap.yaml || true
  for f in g/shim.efi.signed g/grubx64.efi; do
    [ -f "$f" ] || continue
    echo "-- $f"
    objcopy -O binary --only-section=.sbat "$f" /dev/stdout 2>/dev/null | tr -d '\0' || true
    sbverify --list "$f" 2>/dev/null | grep -E 'subject|issuer' || true
  done
done
echo; echo "================ pc-kernel 24/stable"
snap info pc-kernel | grep -E '^  24/' || true
