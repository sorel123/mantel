#!/bin/sh
# Starts Mantel. Double-click start.command on a Mac, or run ./start.sh.
# Your settings live in ./data beside this file. Ctrl+C stops it.
cd "$(dirname "$0")" || exit 1
export DATA_DIR="${DATA_DIR:-$PWD/data}"
export DISPLAY_DIST="$PWD/app/display"
export NODE_ENV=production
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8787}"
export LOCAL_PAIR=1
mkdir -p "$DATA_DIR"
# Settings you want to type by hand (advanced) go in a .env file in this folder.
echo "Mantel is starting. Open http://localhost:$PORT on this computer."
echo "Other devices on your network use this computer's address, for example http://$(hostname):$PORT"
if [ "$(uname)" = "Darwin" ]; then (sleep 3; open "http://localhost:$PORT") & fi
exec ./node app/dist/index.js
