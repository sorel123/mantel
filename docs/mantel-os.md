# Mantel OS: flash it and try it

Mantel OS turns a 64-bit PC into a Mantel wall display that boots straight into Mantel and
updates itself. Raspberry Pi images come later.

## What you need

- A 64-bit PC that can boot from USB with UEFI (most PCs from about 2012 on). Any monitor or
  TV; touch is optional.
- A USB stick or USB SSD of 16 GB or more that can be erased. The PC's own disk is not touched.
- [balenaEtcher](https://etcher.balena.io) (Mac, Windows or Linux) to write the image.

## Get the image

Until the first release carries it, the image comes from a CI run:

1. Open the [Mantel OS workflow runs](https://github.com/sorel123/mantel/actions/workflows/os.yml)
   and click the latest green run (or the one linked from the pull request).
2. Under **Artifacts**, download **mantel-os-pc-amd64**. You get a zip holding
   `mantel-os-pc-amd64.img.xz` (about 1 GB).
3. Unzip it. Leave the `.img.xz` as it is; Etcher reads it directly.

## Flash it

1. Open balenaEtcher, **Flash from file**, pick `mantel-os-pc-amd64.img.xz`.
2. **Select target**: the USB stick. Check the size so you do not pick the wrong disk.
3. **Flash!** It takes 5 to 10 minutes.

## Boot it

1. Plug the stick into the PC and turn it on, pressing the boot-menu key (often F12, F11, F10,
   F8 or Esc; Surface: hold volume-down) and choose the USB stick, the **UEFI** entry if
   there are two.
2. Leave **Secure Boot** on if it is on: Ubuntu's boot chain is signed by Microsoft's key, and
   with secure boot and a TPM 2.0 chip the box encrypts its data. If the PC refuses to boot the
   stick, turn Secure Boot off and tell me the PC model.
3. A network cable is the easy way for a first try, but Wi-Fi works too (see below).

The first boot sets itself up on the stick and restarts once or twice. That takes 3 to 10
minutes depending on the stick and PC, with a black screen or Ubuntu text for part of it. Later
boots take under a minute.

## Setting the box up

The screen opens **Set up this box** with three short steps. A touchscreen, a mouse or a
keyboard all work.

1. **Network.** On a cable it says Connected. For Wi-Fi, pick your network and type the password.
   No keyboard and no touch? After about a minute without a network the box opens its own Wi-Fi
   called **Mantel setup** and shows two QR codes: scan the first with your phone to join it,
   the second to open the setup page on the phone, then pick your home Wi-Fi there. (On a cable,
   the screen shows one QR code to continue on your phone.)
2. **Mantel.** **Run Mantel on this box** keeps everything on the box (Mantel's own setup wizard
   follows). **Show a Mantel I already have** asks for your existing Mantel's address, such as
   your Unraid's `http://192.168.1.20:8787`, and then shows its pairing screen; type a code from
   that Mantel's Settings, Displays.
3. **Screen.** Touchscreen, or a monitor or TV. Without touch the display becomes a glance
   screen: it moves through its screens every 30 seconds, hides the add and edit buttons, and
   changes are made from the phone app.

To change any of it later, open `http://<the box's address>:8787/box` (from another device it
asks for the admin PIN).

## What to check

1. **It gets there by itself.** Power-on to the setup screen with no keyboard. Roughly how long?
2. **Wi-Fi from the screen** (touch or mouse plus keyboard): pick, type, connected.
3. **Wi-Fi from a phone**: boot with no cable and no keyboard, wait for the QR codes, finish
   setup on the phone. Note anything confusing.
4. **Both roles.** Run Mantel on the box once; on a second try (re-flash, or `/box` from the box),
   show your Unraid Mantel instead and pair it.
5. **Picture, touch, animations.** Text sharp, nothing cut off, swipes and screen changes
   smooth, Ambient's cross-fade smooth, camera view shows (if Home Assistant is set up).
6. **Glance mode.** Answer "monitor or TV": screens should rotate by themselves.
7. **Dimming.** On a laptop or all-in-one, the backlight should follow Settings, Screen
   schedule. On a monitor, the display dims itself in software.
8. **Power cut.** Pull the power and plug it back in: back to Mantel by itself, settings kept.
9. **Encryption** (PCs with a TPM, secure boot on): nothing to see on screen; tell me the PC
   model and whether secure boot was on, and I'll confirm from the next image's checks.
10. **From another device.** On a phone or laptop, `http://<the box's address>:8787`. Your
    router's device list shows the address; the box names itself `ubuntu`.

Tell me what you saw for each, plus a phone photo of anything that looks wrong.

## Installing on the PC's own disk

Running from the USB stick is fine for trying it. To put Mantel OS on the PC's internal disk
(which erases that disk):

1. Make an Ubuntu USB stick: download Ubuntu Desktop from ubuntu.com and flash it with Etcher.
2. Boot the PC from it and choose **Try Ubuntu**. Connect to the network.
3. Open **Terminal** and run:

   ```sh
   wget -qO- https://raw.githubusercontent.com/sorel123/mantel/main/packaging/os/install-to-disk.sh | sudo bash
   ```

   It lists the disks, asks which one, and asks you to type `ERASE`. It downloads the latest
   released image. To use an image you already have, copy the `.img.xz` to a second USB stick
   and run `sudo bash install-to-disk.sh /media/ubuntu/<stick>/mantel-os-pc-amd64.img.xz` after
   downloading the script.

4. Shut down, remove the stick, turn the PC on. Setup starts as above.

## Updates

Mantel and the system under it update themselves between 3 and 5 am. After a Mantel update the
new version checks itself before it starts; if the check fails, the box goes back to the
previous version and its data. Settings, Health shows the installed revision.

Test images carry a local copy of Mantel that the store cannot update; once the `mantel` snap is
in the Snap Store, new images use the store's copy and update nightly.

## Known gaps

- Test grade: the image uses Canonical's reference test model, not a model signed with
  Mantel's own key, and Mantel itself does not update from the store yet.
- Changing role from the box's screen after setup means opening `/box` (no button for it yet).
- The automatic test only proves part of the screen. In the test machine Mantel starts and the
  screen system starts, but that machine has no graphics chip, so the browser cannot draw
  there. Real PCs have one. If your screen stays plain grey for more than five minutes after
  the first boot, that is the thing to tell me: there is a second browser to try.
- There is no way to log in to the box, by design (no accounts, SSH off). If something goes
  wrong, re-flash.
