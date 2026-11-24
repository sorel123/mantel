"""Polls Mantel's state and turns its activity feed into Home Assistant events."""

from __future__ import annotations

from datetime import timedelta
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .api import MantelAuthError, MantelClient, MantelError
from .const import ACTIVITY_EVENTS, DOMAIN, SCAN_INTERVAL

_LOGGER = logging.getLogger(__name__)


class MantelCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """State plus the next week of events, every 30 seconds."""

    config_entry: ConfigEntry

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, client: MantelClient) -> None:
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=DOMAIN,
            update_interval=SCAN_INTERVAL,
        )
        self.client = client
        self._seen: set[str] | None = None

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            state = await self.client.state()
            now = dt_util.now()
            try:
                events = await self.client.events(now - timedelta(hours=12), now + timedelta(days=7))
            except MantelAuthError:
                events = []
        except MantelAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except MantelError as err:
            raise UpdateFailed(str(err)) from err
        self._fire_new_activity(state.get("activity", []))
        return {"state": state, "events": events}

    def _fire_new_activity(self, activity: list[dict[str, Any]]) -> None:
        ids = {a["id"] for a in activity}
        if self._seen is None:
            # The first poll only learns what has already happened.
            self._seen = ids
            return
        for item in activity:
            if item["id"] in self._seen:
                continue
            event_type = ACTIVITY_EVENTS.get(item.get("type", ""))
            if event_type:
                self.hass.bus.async_fire(
                    event_type,
                    {
                        "person_id": item.get("personId"),
                        "person": item.get("personName"),
                        "title": item.get("title"),
                        "stars": item.get("stars"),
                        "at": item.get("at"),
                    },
                )
        self._seen = ids
