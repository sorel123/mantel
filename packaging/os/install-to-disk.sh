#!/usr/bin/env bash
# Installs Mantel OS onto a PC's internal disk. Run it from an Ubuntu live USB ("Try Ubuntu"):
#
#   wget -qO- https://raw.githubusercontent.com/sorel123/mantel/main/packaging/os/install-to-disk.sh | sudo bash
#
# or with an image you already have:  sudo bash install-to-disk.sh /media/ubuntu/USB/mantel-os-pc-amd64.img.xz
#
# It lists the disks, asks which one to use and asks you to type ERASE. Everything on that disk
# is replaced. Then shut down, take the USB stick out and turn the PC on.
set -euo pipefail

IMAGE="${1:-}"
DEFAULT_URL="https://github.com/sorel123/mantel/releases/latest/download/mantel-os-pc-amd64.img.xz"

if [ "$(id -u)" != 0 ]; then echo "Run it with sudo." >&2; exit 1; fi
exec </dev/tty # read answers from the keyboard even when the script arrives through a pipe

# The disk the live system booted from is never offered.
live_disk="$(lsblk -no PKNAME "$(findmnt -no SOURCE /cdrom 2>/dev/null || findmnt -no SOURCE /run/live/medium 2>/dev/null || echo /dev/null)" 2>/dev/null || true)"

echo
echo "Mantel OS installer"
echo "-------------------"
echo "Disks in this PC:"
echo
mapfile -t disks < <(lsblk -dnpo NAME,TYPE,RM,TRAN | awk '$2=="disk" {print $1}' | grep -v -E '/dev/(loop|sr|zram)' || true)
choices=()
for d in "${disks[@]}"; do
  name="${d#/dev/}"
  [ -n "$live_disk" ] && [ "$name" = "$live_disk" ] && continue
  size="$(lsblk -dno SIZE "$d")"; model="$(lsblk -dno MODEL "$d" | xargs)"; tran="$(lsblk -dno TRAN "$d")"
  choices+=("$name")
  printf '  %-10s %8s  %-6s %s\n' "$name" "$size" "${tran:-}" "${model:-}"
done
echo
if [ "${#choices[@]}" = 0 ]; then echo "No disk found to install on." >&2; exit 1; fi

read -rp "Install Mantel OS on which disk? (type its name, e.g. ${choices[0]}): " target
target="${target#/dev/}"
ok=0; for c in "${choices[@]}"; do [ "$c" = "$target" ] && ok=1; done
if [ "$ok" != 1 ]; then echo "\"$target\" is not one of the disks listed." >&2; exit 1; fi
dev="/dev/$target"

echo
echo "Everything on $dev ($(lsblk -dno SIZE "$dev") $(lsblk -dno MODEL "$dev" | xargs)) will be erased."
read -rp "Type ERASE to continue: " confirm
[ "$confirm" = "ERASE" ] || { echo "Stopped. Nothing was changed."; exit 1; }

# Unmount anything the live system mounted from that disk.
for p in $(lsblk -lnpo NAME "$dev" | tail -n +2); do umount "$p" 2>/dev/null || true; done

if [ -z "$IMAGE" ]; then
  echo "Downloading and writing Mantel OS (about 1 GB)..."
  wget -qO- --show-progress "$DEFAULT_URL" | xz -dc | dd of="$dev" bs=4M conv=fsync iflag=fullblock status=none
else
  echo "Writing $IMAGE..."
  case "$IMAGE" in
    *.xz) xz -dc "$IMAGE" | dd of="$dev" bs=4M conv=fsync iflag=fullblock status=progress ;;
    *) dd if="$IMAGE" of="$dev" bs=4M conv=fsync status=progress ;;
  esac
fi
sync
echo
echo "Done. Shut down, remove the USB stick, and turn the PC on. The first start takes a few"
echo "minutes while Mantel OS sets itself up (and encrypts the disk if the PC has a TPM chip)."
