# Mantel OS

A ready-to-flash system that turns a 64-bit PC into a Mantel wall display. It is Ubuntu Core 24
(read-only, signed, self-updating) with three things on top:

| Snap                   | What it does                                                    | From       |
| ---------------------- | --------------------------------------------------------------- | ---------- |
| `mantel`               | The Mantel server and display (`packaging/snap`)                | This repo  |
| `ubuntu-frame`         | Shows one app full screen, handles touch, mouse and keyboard    | Canonical  |
| `wpe-webkit-mir-kiosk` | The kiosk browser, opening `http://localhost:8787/` on this box | Snap Store |

Our copy of the `pc` gadget carries the settings that tie them together (`gadget.py`): the
kiosk's address, the kiosk-to-Frame connection, and the 3 to 5 am update window.

How to flash and test an image is in [`docs/mantel-os.md`](../../docs/mantel-os.md).

## Files

| File                                          | What it is                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `models/ubuntu-core-24-amd64-dangerous.model` | Canonical's reference "dangerous" (test grade) model, unchanged. Lets the image add our snaps. |
| `gadget.py`                                   | Adds Mantel's defaults and connections to the store's `pc` gadget.                             |
| `build-image.sh`                              | Builds `mantel-os-pc-amd64.img` with `ubuntu-image`.                                           |
| `vm-test.sh`                                  | Boots an image in QEMU (UEFI), waits for Mantel to answer and takes screenshots.               |

CI (`.github/workflows/os.yml`, job "PC image") builds the image from the snap made in the
same run, boots it in a VM, and attaches `mantel-os-pc-amd64.img.xz` plus the VM screenshots.

## Build it yourself

On Ubuntu 24.04 with snapd:

```sh
sudo snap install ubuntu-image --classic
sudo apt install squashfs-tools python3-yaml qemu-system-x86 ovmf python3-pil
sudo packaging/os/build-image.sh dist/snap/mantel_*.snap dist/os
sudo packaging/os/vm-test.sh dist/os/mantel-os-pc-amd64.img dist/vm
```

## Test grade, for now

Until Mantel has its own Ubuntu One brand account, images use Canonical's reference
"dangerous" model. Everything works the same, but the image is not tied to a Mantel signing key
and the `mantel` snap inside it is a local copy that does not update from the store. Stage 4
(store channels) and stage 5 (Mantel's own signed model, secure boot and disk encryption)
replace both.
