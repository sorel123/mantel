"""A small async client for Mantel's open API (token auth)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

import aiohttp


class MantelError(Exception):
    """Mantel answered with an error, or could not be reached."""


class MantelAuthError(MantelError):
    """The token is wrong, revoked, or lacks a scope."""


class MantelClient:
    """Talks to one Mantel server with one API token."""

    def __init__(self, session: aiohttp.ClientSession, url: str, token: str) -> None:
        self._session = session
        self.url = url.rstrip("/")
        self._token = token

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        headers = {"authorization": f"Bearer {self._token}"}
        try:
            async with self._session.request(
                method,
                f"{self.url}/api{path}",
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=20),
                **kwargs,
            ) as resp:
                if resp.status in (401, 403):
                    body = await resp.json(content_type=None)
                    message = (body or {}).get("error", {}).get("message", "not allowed")
                    raise MantelAuthError(message)
                if resp.status >= 400:
                    raise MantelError(f"Mantel answered {resp.status} for {path}")
                if resp.content_type == "application/json":
                    return await resp.json()
                return await resp.text()
        except aiohttp.ClientError as err:
            raise MantelError(f"Could not reach Mantel at {self.url}: {err}") from err
        except TimeoutError as err:
            raise MantelError(f"Mantel at {self.url} did not answer in time") from err

    async def state(self) -> dict[str, Any]:
        """Everything the sensors show, in one call."""
        return await self._request("GET", "/open/state")

    async def events(self, start: datetime, end: datetime) -> list[dict[str, Any]]:
        """Calendar events between two times."""
        data = await self._request(
            "GET",
            "/calendar",
            params={"from": start.isoformat(), "to": end.isoformat()},
        )
        return data["events"]

    async def say(self, text: str) -> dict[str, Any]:
        """Natural add: 'milk and eggs', 'dentist Tuesday at 3'."""
        return await self._request("POST", "/say", json={"text": text, "source": "voice"})

    async def lists(self) -> list[dict[str, Any]]:
        return (await self._request("GET", "/lists"))["lists"]

    async def add_item(self, item: str, list_name: str | None = None) -> str:
        """Add one item to a list by name (the grocery list when none is given)."""
        lists = await self.lists()
        chosen = None
        if list_name:
            chosen = next((l for l in lists if l["name"].lower() == list_name.lower()), None)
            if chosen is None:
                raise MantelError(f"There is no list called {list_name}")
        else:
            chosen = next(
                (l for l in lists if "grocer" in l["name"].lower() or "shopping" in l["name"].lower()),
                lists[0] if lists else None,
            )
            if chosen is None:
                raise MantelError("Mantel has no lists yet")
        await self._request("POST", f"/lists/{chosen['id']}/items", json={"text": item})
        return chosen["name"]

    async def post_note(self, text: str) -> None:
        await self._request("POST", "/notes", json={"text": text})
