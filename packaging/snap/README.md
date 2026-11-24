# The Mantel snap

The Mantel server packaged as a [snap](https://snapcraft.io/docs), for Mantel OS (Ubuntu Core)
and for anyone on ordinary Ubuntu. It is built from the same bundle as the Linux download
(`packaging/build-bundle.mjs`: Node, the server as one file plus its native packages, the built display),
so there is no second build of the app to keep in step.

| File                | What it is                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `snap.yaml`         | The snap's metadata (`meta/snap.yaml`). `build.sh` fills in the version and architecture. |
| `bin/mantel-server` | Starts the server: port from `snap set`, data in `$SNAP_DATA`, local pairing on.          |
| `bin/mantel-health` | `sudo mantel.health` prints `/api/health`.                                                |
| `hooks/configure`   | Checks `snap set mantel ...` values and restarts the server.                              |
| `build.sh`          | Copies the bundle, adds the files above and runs `snap pack`.                             |

## Build and try it

```sh
pnpm install && pnpm build
node packaging/build-bundle.mjs dist/bundle 0.3.0
packaging/snap/build.sh dist/bundle 0.3.0 dist/snap
sudo snap install --dangerous dist/snap/mantel_0.3.0_amd64.snap
```

Then open http://localhost:8787. `snap logs mantel` shows the server log.
`sudo snap set mantel port=8790` moves it to another port.

CI (`.github/workflows/os.yml`) does the same on every pull request that touches the OS build:
it installs the snap on the runner, checks health, local pairing, the display, that data lands in
`/var/snap/mantel/current`, and that changing the port works. The `.snap` file is attached to the
run as an artifact.

## Where data lives

`DATA_DIR` is `$SNAP_DATA` (`/var/snap/mantel/current`, the database, `secret.key`, caches).
snapd copies that folder before each update and keeps the previous copy, so if an update is
reverted, Mantel goes back to the data it had with that version.

## Not here yet

Publishing to the Snap Store (needs the `mantel` name registered to Mantel's Ubuntu One account),
arm64 builds for the Raspberry Pi, and the box features Mantel OS adds in later stages (Wi-Fi
setup, screen dimming, the update health check).
