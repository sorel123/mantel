# Deploying Mantel: from Unraid to a paired tablet

This walks through the whole setup once: the container on Unraid, the first paired display,
the settings page, and kiosk mode on an iPad or a Surface Pro. Allow about 30 minutes.

What you end up with:

- One container, `mantel`, on Unraid next to Home Assistant and Homebridge. It serves the
  wall display and its API on port 8787 and keeps everything in `/mnt/user/appdata/mantel`.
- A tablet on the wall that opens `http://UNRAID-IP:8787`, paired once with a 6-digit code.
- A settings page at `http://UNRAID-IP:8787/settings` for the screen schedule, people,
  leave-by places, features and paired displays.

Replace `192.168.1.10` below with your Unraid server's IP address (Unraid's Dashboard shows it).
Give the Unraid server a fixed IP (a DHCP reservation in your router) so the tablet's
bookmark keeps working.

## 1. The image

Every merge to `main` builds the container and pushes it to GitHub's registry as
`ghcr.io/sorel123/mantel:latest` (the **Publish image** workflow). The repository is private,
so the image is private too, and Unraid needs to be allowed to pull it. Pick one:

- **Make the image public (simplest).** On GitHub open your profile, **Packages**, `mantel`,
  **Package settings**, **Change visibility**, Public. The code stays private; the image
  holds the built app but no secrets, since every key and password goes in the container's
  settings on Unraid.
- **Keep it private.** Create a GitHub personal access token (classic) with only the
  `read:packages` scope. In the Unraid terminal run
  `docker login ghcr.io -u sorel123` and paste the token as the password. Unraid keeps
  `/root` in memory, so to survive a reboot also run
  `mkdir -p /boot/config/docker-auth && cp /root/.docker/config.json /boot/config/docker-auth/`
  and add this line to `/boot/config/go`:
  `mkdir -p /root/.docker && cp /boot/config/docker-auth/config.json /root/.docker/`

## 2. Install the container

1. Copy [`unraid/mantel.xml`](unraid/mantel.xml) to the flash drive as
   `config/plugins/dockerMan/templates-user/my-mantel.xml`. From a Mac: Finder, Go, Connect
   to Server, `smb://tower/flash` (or the server's IP), then that folder.
2. Unraid **Docker** tab, **Add Container**, **Template**: choose `mantel` under User templates.
3. Fill in:
   - **Public URL**: `http://192.168.1.10:8787`.
   - **Home Assistant URL**: `http://192.168.1.10:8123`. Home Assistant runs with host
     networking, so from Mantel's container it is at the Unraid IP, not `homeassistant.local`.
   - **Home Assistant token**, **Google**, **iCloud** and the rest as you get them. Leave a
     field empty until you have it; that part of the display waits until it is filled in.
   - **Mock mode** `1` if you want to see the display working on sample data first. Set it
     back to `0` for the real house.
4. **Apply**. Unraid pulls the image and starts it. The Docker tab shows it healthy within
   half a minute.

Check it from any browser: `http://192.168.1.10:8787/api/health` answers
`{"ok":true,...}`.

To change a value later, click the container icon, **Edit**, change it, **Apply**. Mantel
restarts in a few seconds and the tablets reconnect on their own.

## 3. Pair the first display

Each display holds its own key; nothing on the tablet ever sees a Google, iCloud or Home
Assistant credential.

1. On the tablet (or a laptop, for now) open `http://192.168.1.10:8787`. It asks for a code.
2. On Unraid, click the `mantel` container icon, **Logs**. The newest line reading
   `Pairing code: 123456` is the code. It changes every 15 minutes and works once.
3. Enter it. The display loads.

After that, any paired display can hand out a code for the next one: settings page,
**Displays**, **Show a code**. In mock mode no pairing is needed, and `000000` also pairs.

## 4. The settings page

Open `http://192.168.1.10:8787/settings` from a laptop or phone (pair that browser the same
way the first time). It has:

- **Home**: look (Auto, Daylight, Dusk), units, timezone and location for weather.
- **Screen schedule**: seconds to Ambient, evening Ambient, screen off overnight, the nightly
  reload time (04:00 by default) and brightness steps through the day.
- **People**: name, initial, colour and which calendars are theirs.
- **Leave-by places**: address, arrive-by time, weekdays and who goes there.
- **Features**: countdowns, meals, leave-by, chores, now playing, doorbell pop-over and
  Alexa announcements.
- **Displays**: every paired display with when it was last seen. Rename one, revoke one (tap
  twice; it is signed out at once and shows the pairing screen), show a pairing code, or
  reload every display.

**Save** stores the settings and reloads every display so they apply straight away.

From the wall itself: hold the clock in the dock for about a second, confirm **Open settings**,
and the display opens this page; **Back to the display** returns. Nothing on screen points at
it, so it stays out of the way of guests and children.

## 5. Kiosk mode on an iPad

1. In Safari open `http://192.168.1.10:8787`, then **Share**, **Add to Home Screen**. Open
   Mantel from its home-screen icon: it runs full screen with no browser bar. Pair it there;
   the home-screen app keeps its own storage, separate from Safari.
2. **Settings, Display & Brightness, Auto-Lock**: Never.
3. **Settings, Accessibility, Guided Access**: on. Set a passcode, and set **Display
   Auto-Lock** to Never.
4. Open Mantel, triple-click the top button, **Start**. The iPad now stays in Mantel. Triple-
   click and enter the passcode to leave.
5. Power: if your iPad offers **Settings, Battery, Charging** with an 80% limit, turn it on.
   Otherwise a smart plug Home Assistant switches on below 40% and off above 80% does the job.

**Brightness and night.** Safari cannot set the backlight, so the display handles the
schedule on screen (Ambient, then black overnight) and the iPad's own brightness stays as set.
To dim the backlight too, add Shortcuts automations: **Shortcuts, Automation, New, Time of
Day**, pick the time, **Run Immediately**, action **Set Brightness**. One per brightness step
on the settings page (for example 35% at 21:00, 0% at 23:00, 60% at 06:00). Check after the
first evening that they fire while Guided Access is on; if they do not on your iPadOS
version, a kiosk browser app such as Kiosker Pro (App Store) can replace the home-screen app
and Guided Access, with its own screensaver and auto-reload.

## 6. Kiosk mode on a Surface Pro

Fully Kiosk Browser only runs on Android, and Edge's built-in kiosk mode runs InPrivate, which
forgets the display's key on every restart. Chrome in kiosk mode on its own Windows account
keeps the key and is the setup to use.

1. **A kiosk account.** Settings, Accounts, Other users, add a local account named
   `Mantel` (no Microsoft account). Sign in to it once.
2. **Sign in automatically.** Settings, Accounts, Sign-in options: turn off "For improved
   security, only allow Windows Hello sign-in". Then press Win+R, run `netplwiz`, untick
   "Users must enter a user name and password", and enter the Mantel account's password.
3. **Never sleep.** Settings, System, Power: screen and sleep both Never when plugged in.
   Settings, System, Notifications: off. Settings, Windows Update, Active hours: set them to
   cover the day, so restarts happen at night.
4. **Install Chrome**, open `http://192.168.1.10:8787` and pair the Surface. Close Chrome.
5. **Start Chrome in kiosk mode at sign-in.** Press Win+R, run `shell:startup`, right-click,
   New, Shortcut, and paste as the location (one line):

   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk http://192.168.1.10:8787 --no-first-run --disable-pinch --overscroll-history-navigation=0 --disable-features=TranslateUI --noerrdialogs --disable-session-crashed-bubble
   ```

   Sign out and back in: Mantel fills the screen. Alt+F4 with a keyboard leaves kiosk mode.

6. **Brightness schedule.** Copy [`kiosk/surface/mantel-brightness.ps1`](kiosk/surface/mantel-brightness.ps1)
   to the Surface, open PowerShell with **Run as administrator** in that folder, and run:

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\mantel-brightness.ps1 -Install -Server http://192.168.1.10:8787 -Code 123456
   ```

   using a fresh pairing code. It pairs itself as "SURFACE-NAME brightness" and installs a
   task that sets the panel's backlight from the schedule every five minutes, down to 0
   while the screen is off. `-Uninstall` removes it.

7. Power: Surface models with **Battery Limit** in the UEFI (or "Smart Charging" in the
   Surface app) cap the charge at 50 to 80%; turn it on for a device that never leaves the
   wall.

## How the schedule reaches the screen

- The display reads the schedule at load and applies it on screen: Ambient after the idle
  time and from the evening hour, black overnight.
- The server pushes `display.sleep` at the screen-off time, `display.wake` at the screen-on
  time and `display.reload` at the nightly reload time, so every display stays in step and
  picks up new versions.
- `GET /api/display/state` (with a device key) answers what the screen should be doing now:
  `{"screen":"on","ambient":false,"brightness":100}`. The Surface helper uses it; Home
  Assistant can too, for example to switch a charging plug or a hallway light with the
  screen:

  ```yaml
  # configuration.yaml in Home Assistant
  rest:
    - resource: http://192.168.1.10:8787/api/display/state
      headers:
        x-mantel-device-key: !secret mantel_device_key
      scan_interval: 300
      sensor:
        - name: Mantel brightness
          value_template: '{{ value_json.brightness }}'
          unit_of_measurement: '%'
      binary_sensor:
        - name: Mantel screen
          value_template: "{{ value_json.screen == 'on' }}"
  ```

  A key for Home Assistant comes from pairing it like a display:
  `curl -X POST http://192.168.1.10:8787/api/pair -H 'content-type: application/json' -d '{"code":"123456","name":"Home Assistant"}'`.

## Updating, backups and trouble

- **Update**: Unraid Docker tab, **Check for Updates**, then **Apply update** on `mantel`
  (or let the CA Auto Update Applications plugin do it nightly). Displays reload themselves at
  the nightly reload time; **Reload all displays** on the settings page does it at once.
- **Backup**: everything lives in `/mnt/user/appdata/mantel` (`mantel.db` and `home.yaml`).
  The Appdata Backup plugin covers it.
- **A display shows the pairing screen**: its key was revoked or its storage cleared. Pair it
  again with a new code.
- **"Can't reach the server"**: check `http://192.168.1.10:8787/api/health` from the
  tablet's browser, and that the container is running.
- **Home Assistant parts are empty**: Mantel's container must reach Home Assistant at the
  URL you gave. Open the container's **Console** and run
  `node -e "fetch(process.env.HA_URL+'/api/',{headers:{authorization:'Bearer '+process.env.HA_TOKEN}}).then(r=>console.log(r.status))"`;
  200 means it can.
- **Run without Unraid**: `docker compose up -d` from a checkout uses the same image and a
  local `.env` (see `.env.example`).
