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
2. If the PC refuses to boot it, turn off **Secure Boot** in the firmware settings for now.
   (Ubuntu's boot chain is signed, so it should boot either way; tell me if it does not.)
3. Plug in a network cable for this first test. Wi-Fi setup comes in stage 3.

The first boot installs itself onto the stick and restarts once. That takes 3 to 10 minutes
depending on the stick, with a black screen or Ubuntu text for part of it. After that the screen
shows Mantel full screen, and later boots take under a minute.

## What to check (stage 2)

1. **It gets there by itself.** From power-on to Mantel with no keyboard. Note roughly how long.
2. **Setup.** The first screen is Mantel's welcome and setup wizard. Go through it (admin PIN,
   home location). With no keyboard on a touchscreen, note whether an on-screen keyboard
   appears when you tap a text box.
3. **Picture.** Text sharp, nothing cut off at the edges, right way up.
4. **Touch or mouse.** Tap or click through Today, Month, Lists and Home. Swipe between screens.
5. **Animations.** Screen changes slide smoothly; Ambient's photo cross-fade is smooth.
6. **Cameras** (if Home Assistant is set up): the live view or snapshot shows.
7. **Power cut.** Pull the power, plug it back in: it should come back to Mantel by itself with
   your settings kept.
8. **From another device.** On a phone or laptop on the same network, open
   `http://<the box's address>:8787`. Your router's device list shows the address; the box
   names itself `ubuntu`.

Tell me what you saw for each, plus a phone photo of anything that looks wrong.

## Known gaps in this stage

- Wired network only; Wi-Fi and phone setup come in stage 3.
- No screen dimming or "screen only" role yet (stage 3).
- The image is test grade: Mantel itself does not update from the store yet (stage 4), and
  there is no disk encryption or secure-boot lock-down yet (stage 5).
- There is no way to log in to the box, by design. If something goes wrong, re-flash.
