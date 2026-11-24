"""Mantel sensors: tonight's dinner, the next event, lists, inbox, and each person's chores and stars."""

from __future__ import annotations

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from . import MantelConfigEntry
from .entity import MantelEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: MantelConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    coordinator = entry.runtime_data
    entities: list[SensorEntity] = [
        DinnerSensor(coordinator),
        NextEventSensor(coordinator),
        NextEventTimeSensor(coordinator),
        GrocerySensor(coordinator),
        InboxSensor(coordinator),
    ]
    for person in coordinator.data["state"]["people"]:
        entities.append(ChoresSensor(coordinator, person["id"], person["name"]))
        entities.append(StarsSensor(coordinator, person["id"], person["name"]))
    async_add_entities(entities)


class DinnerSensor(MantelEntity, SensorEntity):
    _attr_translation_key = "dinner"
    _attr_icon = "mdi:silverware-fork-knife"

    def __init__(self, coordinator) -> None:
        super().__init__(coordinator, "dinner_tonight")

    @property
    def native_value(self) -> str | None:
        return self.state_data["tonight"]["dinner"]


class NextEventSensor(MantelEntity, SensorEntity):
    _attr_translation_key = "next_event"
    _attr_icon = "mdi:calendar-clock"

    def __init__(self, coordinator) -> None:
        super().__init__(coordinator, "next_event")

    @property
    def native_value(self) -> str | None:
        nxt = self.state_data["nextEvent"]
        return nxt["title"] if nxt else None

    @property
    def extra_state_attributes(self) -> dict:
        nxt = self.state_data["nextEvent"] or {}
        return {
            "start": nxt.get("start"),
            "all_day": nxt.get("allDay"),
            "people": nxt.get("personIds", []),
        }


class NextEventTimeSensor(MantelEntity, SensorEntity):
    _attr_translation_key = "next_event_time"
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, coordinator) -> None:
        super().__init__(coordinator, "next_event_time")

    @property
    def native_value(self):
        nxt = self.state_data["nextEvent"]
        return dt_util.parse_datetime(nxt["start"]) if nxt else None


class GrocerySensor(MantelEntity, SensorEntity):
    _attr_translation_key = "grocery"
    _attr_icon = "mdi:cart"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "items"

    def __init__(self, coordinator) -> None:
        super().__init__(coordinator, "grocery_open")

    @property
    def native_value(self) -> int | None:
        g = self.state_data["groceryList"]
        return g["open"] if g else None

    @property
    def extra_state_attributes(self) -> dict:
        return {"lists": {l["name"]: l["open"] for l in self.state_data["lists"]}}


class InboxSensor(MantelEntity, SensorEntity):
    _attr_translation_key = "inbox"
    _attr_icon = "mdi:inbox"
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator) -> None:
        super().__init__(coordinator, "inbox")

    @property
    def native_value(self) -> int:
        return self.state_data["inboxCount"]


class _PersonSensor(MantelEntity, SensorEntity):
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator, person_id: str, name: str, key: str) -> None:
        super().__init__(coordinator, f"{key}_{person_id}")
        self._person_id = person_id
        self._attr_translation_placeholders = {"person": name}

    def _person(self) -> dict | None:
        return next((p for p in self.state_data["people"] if p["id"] == self._person_id), None)

    @property
    def available(self) -> bool:
        return super().available and self._person() is not None


class ChoresSensor(_PersonSensor):
    _attr_translation_key = "chores_open"
    _attr_icon = "mdi:broom"

    def __init__(self, coordinator, person_id: str, name: str) -> None:
        super().__init__(coordinator, person_id, name, "chores")

    @property
    def native_value(self) -> int | None:
        p = self._person()
        return p["choresOpen"] if p else None

    @property
    def extra_state_attributes(self) -> dict:
        p = self._person() or {}
        return {"done": p.get("choresDone"), "person_id": self._person_id}


class StarsSensor(_PersonSensor):
    _attr_translation_key = "stars"
    _attr_icon = "mdi:star"

    def __init__(self, coordinator, person_id: str, name: str) -> None:
        super().__init__(coordinator, person_id, name, "stars")

    @property
    def native_value(self) -> int | None:
        p = self._person()
        return p["stars"] if p else None
