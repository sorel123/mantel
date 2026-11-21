#!/usr/bin/env python3
"""Adds Mantel's defaults and connections to an unpacked pc gadget's meta/gadget.yaml.

Usage: gadget.py <gadget-dir> <ids.json>
ids.json maps snap names to snap ids, e.g. {"wpe-webkit-mir-kiosk": "...", "ubuntu-frame": "..."}.
Gadget defaults are keyed by snap id, so only snaps from the store can be configured here.
"""
import json
import sys

import yaml

gadget_dir, ids_file = sys.argv[1], sys.argv[2]
ids = json.load(open(ids_file))
path = f"{gadget_dir}/meta/gadget.yaml"
gadget = yaml.safe_load(open(path))

defaults = gadget.setdefault("defaults", {}) or {}
gadget["defaults"] = defaults

# The kiosk browser opens the Mantel server on this box. Local pairing (loopback only) means
# no code to type.
kiosk = ids.get("wpe-webkit-mir-kiosk")
if kiosk:
    defaults[kiosk] = {"url": "http://localhost:8787/", "daemon": True}

# System settings: install updates in a quiet window at night.
system = defaults.setdefault("system", {})
system["refresh"] = {"timer": "03:00-05:00"}
# No remote login on a family's box (there are no user accounts either).
system["service"] = {"ssh": {"disable": True}}
# Restart the box if the system ever hangs (PCs with a hardware watchdog).
system["watchdog"] = {"runtime-timeout": "60s"}

connections = gadget.setdefault("connections", []) or []
gadget["connections"] = connections
frame = ids.get("ubuntu-frame")
if kiosk and frame:
    connections.append({"plug": f"{kiosk}:wayland", "slot": f"{frame}:wayland"})

# ubuntu-seed holds a copy of every snap in the image (the recovery system). The stock 1.2 GB
# is sized for a bare Ubuntu Core; the kiosk, its graphics stacks and their bases need more.
SEED_SIZE = "3500M"
for volume in gadget.get("volumes", {}).values():
    for part in volume.get("structure", []):
        if part.get("name") == "ubuntu-seed" or part.get("role") == "system-seed":
            print(f"ubuntu-seed: {part.get('size')} -> {SEED_SIZE}")
            part["size"] = SEED_SIZE

yaml.safe_dump(gadget, open(path, "w"), sort_keys=False)
print(yaml.safe_dump({"defaults": defaults, "connections": connections}, sort_keys=False))
