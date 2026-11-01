# Packaging: Mantel as a downloadable app

Mantel is a small server plus a display that opens in a browser. A tablet can only be the
display; the server has to run on a computer that stays on. These downloads put the server on
one, with no Docker and no terminal. (Unraid, Synology and anyone with Docker keep using the
container; see [`deploy/README.md`](../deploy/README.md).)

| Download                          | For                                             | What you get                                                                                                                                                                |
| --------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Mantel-x.y.z-windows-setup.exe`  | A Windows PC or Surface that is on all the time | Installs the server as a background task that starts at boot, a **Mantel (full screen)** Start Menu shortcut, optional full-screen at sign-in, optional brightness schedule |
| `mantel-x.y.z-macos-arm64.tar.gz` | A Mac (Apple silicon)                           | Unpack, run `start.command`                                                                                                                                                 |
| `mantel-x.y.z-linux-x64.tar.gz`   | Linux box                                       | Unpack, run `./start.sh` (add it to systemd to keep it running)                                                                                                             |

Everything is on the [Releases page](https://github.com/sorel123/mantel/releases/latest).

## Installing on Windows

1. Run the setup file (Windows may warn about an unknown publisher: the installer is not
   code-signed. **More info**, **Run anyway**).
2. Leave **Open Mantel** ticked. The display opens, pairs itself (it is the same computer), and
   the setup wizard walks through the rest.
3. For a wall display, also tick **Open Mantel full screen when I sign in**, and install
   Chrome first (kiosk mode uses it; Edge's kiosk mode forgets the display's key).
4. A small icon appears near the clock (the **Mantel status icon**; it starts at sign-in). It
   is green while the server answers and grey when it does not, with a balloon when that
   changes. Right-click it for the address and port (click the address to copy it), **Open
   Mantel** full screen, in a window or Settings, a **Start when Windows starts** checkbox,
   **Start/Stop server**, and **Change port**. Starting, stopping and the port change ask
   Windows for permission once each time. Closing the icon leaves the server running.
5. Tablets and phones on the home network open `http://<this PC's name or IP>:8787` and enter the
   admin PIN chosen in the wizard. Windows asks to allow the network once; the installer opens
   the port (8787 unless you change it) for private networks only.

Settings, keys and photos live in `C:\ProgramData\Mantel`. Upgrades and uninstalls leave that
folder alone; the log is `server.log` there. To update, run the newer setup file over the old
one. Settings › Health says when a newer release is out.

## How it works

- `build-bundle.mjs` assembles a folder: the Node that built it, the server with production
  `node_modules` (SQLite and image processing are native, so each platform is built on its own
  runner), the built display, and a `builtin.env` holding the version and Mantel's shared Google
  sign-in client (see [`docs/google-shared-client.md`](../docs/google-shared-client.md)).
- `windows/Mantel.iss` (Inno Setup) wraps it; `windows/service.ps1` registers a
  **Mantel server** scheduled task that runs `run-server.cmd` as SYSTEM at boot and restarts it.
- `LOCAL_PAIR=1` (set by the launchers) lets a browser on the same computer pair itself:
  `POST /api/pair/local` accepts only a loopback connection with no proxy headers. The kiosk
  shortcut and the brightness helper use it, so there is no code to type.
- `.github/workflows/package.yml` builds all three on a version tag (`git tag v0.2.0 && git push
--tags`), smoke-tests each bundle (starts it, checks health and local pairing), and publishes
  the Release. It also runs on pull requests that touch this folder.

## Not here yet

macOS app bundle with a login item, signed installers (Windows SmartScreen and Mac Gatekeeper
warn on first run), Linux `.deb`, Raspberry Pi image, and in-place auto-update (Settings only
points at the new download).
