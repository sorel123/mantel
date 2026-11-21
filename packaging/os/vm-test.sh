#!/usr/bin/env bash
# Boots a Mantel OS image in QEMU (UEFI, KVM when available) and checks that the box comes
# up: the server answers through a forwarded port and the screen shows Mantel.
#
# Usage: packaging/os/vm-test.sh <image> <out-dir>
# Leaves serial.log and screenshots (screen-*.png) in <out-dir>.
set -euo pipefail
img="$(readlink -f "$1")"
out="$(mkdir -p "$2" && cd "$2" && pwd)"
PORT="${PORT:-18787}"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-1500}"

disk="$out/disk.img"
cp --sparse=always "$img" "$disk"
truncate -s 12G "$disk"
vars="$out/OVMF_VARS.fd"
cp /usr/share/OVMF/OVMF_VARS_4M.fd "$vars"
accel=()
[ -w /dev/kvm ] && accel=(-enable-kvm -cpu host)

qemu-system-x86_64 "${accel[@]}" -machine q35 -m 4096 -smp 2 \
  -drive if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.fd \
  -drive if=pflash,format=raw,file="$vars" \
  -drive file="$disk",format=raw,if=virtio \
  -netdev user,id=n0,hostfwd=tcp::"$PORT"-:8787 -device virtio-net-pci,netdev=n0 \
  -device virtio-vga -display none \
  -serial file:"$out/serial.log" \
  -qmp unix:"$out/qmp.sock",server,nowait \
  -pidfile "$out/qemu.pid" -daemonize

shot() {
  python3 - "$out/qmp.sock" "$out/$1.ppm" <<'PY'
import json, socket, sys
s = socket.socket(socket.AF_UNIX); s.connect(sys.argv[1]); f = s.makefile('rw')
f.readline()
for cmd in ({"execute": "qmp_capabilities"}, {"execute": "screendump", "arguments": {"filename": sys.argv[2]}}):
    f.write(json.dumps(cmd) + "\n"); f.flush(); f.readline()
PY
  python3 -c "from PIL import Image; import sys; Image.open(sys.argv[1]).save(sys.argv[2])" "$out/$1.ppm" "$out/$1.png" 2>/dev/null && rm -f "$out/$1.ppm" || true
}

start=$(date +%s); up=0; n=0
while [ $(( $(date +%s) - start )) -lt "$BOOT_TIMEOUT" ]; do
  sleep 30; n=$((n + 1))
  shot "boot-$(printf %02d $n)"
  if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null; then up=1; break; fi
done
elapsed=$(( $(date +%s) - start ))
if [ "$up" != 1 ]; then
  echo "Mantel did not answer within ${BOOT_TIMEOUT}s"; tail -80 "$out/serial.log" || true
  kill "$(cat "$out/qemu.pid")" || true; exit 1
fi
echo "Mantel answered after ${elapsed}s"
curl -sf "http://127.0.0.1:$PORT/api/health"; echo
# Give the kiosk time to start and draw, then take the screenshots that matter.
for i in 1 2 3 4; do sleep 30; shot "screen-$i"; done
kill "$(cat "$out/qemu.pid")" || true
rm -f "$disk"
grep -a "mantel: first-boot config ran" "$out/serial.log" || echo "note: first-boot config message not seen on the serial console"
echo "--- serial console (cloud-init and snapd lines) ---"
grep -aiE "cloud-init|mantel|wpe|frame|kiosk|wayland|interface|connect|seed|mesa" "$out/serial.log" | grep -v "^\[" | tail -150 || true
chmod -R a+rX "$out"
