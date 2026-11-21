#!/usr/bin/env python3
"""Prints a small JPEG of a VM screenshot as base64 between markers, so the CI log carries a
picture of what the box's screen showed (artifacts need a browser to look at)."""
import base64
import io
import sys

from PIL import Image

for path in sys.argv[1:]:
    img = Image.open(path).convert("RGB")
    img.thumbnail((640, 640))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=55)
    print(f"----- BEGIN SCREEN {path} -----")
    data = base64.b64encode(buf.getvalue()).decode()
    for i in range(0, len(data), 120):
        print(data[i : i + 120])
    print(f"----- END SCREEN {path} -----")
