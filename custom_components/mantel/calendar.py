"""One Home Assistant calendar per Mantel calendar."""

from __future__ import annotations

from datetime import datetime

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from . import MantelConfigEntry
from .api import MantelError
from .entity import MantelEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: MantelConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    coordinator = entry.runtime_data
    async_add_entities(
        MantelCalendar(coordinator, cal["id"], cal["name"])
        for cal in coordinator.data["state"]["calendars"]
    )


def _to_event(raw: dict) -> CalendarEvent:
    start = dt_util.parse_datetime(raw["start"])
    end = dt_util.parse_datetime(raw["end"])
    if raw.get("allDay"):
        return CalendarEvent(
            summary=raw["title"],
            start=start.date(),
            end=end.date(),
            location=raw.get("location"),
            uid=raw["id"],
        )
    return CalendarEvent(
        summary=raw["title"], start=start, end=end, location=raw.get("location"), uid=raw["id"]
    )


class MantelCalendar(MantelEntity, CalendarEntity):
    _attr_icon = "mdi:calendar"

    def __init__(self, coordinator, calendar_id: str, name: str) -> None:
        super().__init__(coordinator, f"calendar_{calendar_id}")
        self._calendar_id = calendar_id
        self._attr_name = name

    @property
    def event(self) -> CalendarEvent | None:
        now = dt_util.now()
        upcoming = []
        for raw in self.coordinator.data["events"]:
            if raw["calendarId"] != self._calendar_id:
                continue
            ev = _to_event(raw)
            if ev.end_datetime_local > now:
                upcoming.append(ev)
        upcoming.sort(key=lambda e: e.start_datetime_local)
        return upcoming[0] if upcoming else None

    async def async_get_events(
        self, hass: HomeAssistant, start_date: datetime, end_date: datetime
    ) -> list[CalendarEvent]:
        try:
            events = await self.coordinator.client.events(start_date, end_date)
        except MantelError as err:
            raise HomeAssistantError(str(err)) from err
        return [_to_event(e) for e in events if e["calendarId"] == self._calendar_id]
