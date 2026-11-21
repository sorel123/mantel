"""Run the tests against a real Mantel server in mock mode (no accounts, sample family)."""

from __future__ import annotations

from collections.abc import Generator
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import urllib.request

import pytest
import pytest_socket

pytest_plugins = "pytest_homeassistant_custom_component"

ROOT = Path(__file__).resolve().parents[3]
SERVER = ROOT / "apps" / "server" / "dist" / "index.js"


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


@pytest.fixture(autouse=True)
def local_sockets():
    """Home Assistant's test plugin blocks sockets before each test; allow the local server."""
    pytest_socket.enable_socket()
    pytest_socket.socket_allow_hosts(["127.0.0.1"], allow_unix_socket=True)
    yield


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _post(url: str, body: dict, headers: dict | None = None) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", **(headers or {})},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


@pytest.fixture(scope="session")
def mantel_server() -> Generator[dict[str, str]]:
    """Start `node apps/server/dist/index.js` with MOCK=1 and make tokens on it."""
    # The Home Assistant test plugin blocks sockets; this suite talks to a local server only.
    pytest_socket.enable_socket()
    if not SERVER.exists():
        pytest.fail(f"Build the server first (pnpm build): {SERVER} is missing")
    port = _free_port()
    env = {
        **os.environ,
        "MOCK": "1",
        "HOST": "127.0.0.1",
        "PORT": str(port),
        "DATA_DIR": ":memory:",
        "LOG_LEVEL": "warn",
    }
    proc = subprocess.Popen(["node", str(SERVER)], env=env, cwd=ROOT)
    url = f"http://127.0.0.1:{port}"
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(f"{url}/api/health", timeout=1)
                break
            except OSError:
                time.sleep(0.1)
        else:
            pytest.fail("the Mantel mock server did not start")
        ha = _post(
            f"{url}/api/open/tokens",
            {"name": "Home Assistant", "scopes": ["read", "lists", "chores", "capture"]},
        )
        read = _post(f"{url}/api/open/tokens", {"name": "Read only", "scopes": ["read"]})
        yield {"url": url, "token": ha["secret"], "read_token": read["secret"]}
    finally:
        proc.terminate()
        proc.wait(timeout=10)
