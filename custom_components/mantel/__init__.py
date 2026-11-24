"""Mantel, the family wall calendar, in Home Assistant.

Sensors (dinner tonight, next event, chores and stars per person, grocery and inbox counts), a
calendar per Mantel calendar, events on the bus when a chore is done or a reward redeemed, and
the services mantel.say, mantel.add_item and mantel.post_note.

To-do entities for Mantel's lists belong to the lists workstream: add Platform.TODO to
PLATFORMS and a todo.py reading coordinator.data["state"]["lists"].
"""

from __future__ import annotations

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_URL, Platform
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import MantelClient, MantelError
from .const import CONF_TOKEN, DOMAIN, SERVICE_ADD_ITEM, SERVICE_POST_NOTE, SERVICE_SAY
from .coordinator import MantelCoordinator

PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.CALENDAR]

type MantelConfigEntry = ConfigEntry[MantelCoordinator]

SAY_SCHEMA = vol.Schema({vol.Required("text"): cv.string})
ADD_ITEM_SCHEMA = vol.Schema({vol.Required("item"): cv.string, vol.Optional("list"): cv.string})
NOTE_SCHEMA = vol.Schema({vol.Required("text"): cv.string})


async def async_setup_entry(hass: HomeAssistant, entry: MantelConfigEntry) -> bool:
    client = MantelClient(
        async_get_clientsession(hass), entry.data[CONF_URL], entry.data[CONF_TOKEN]
    )
    coordinator = MantelCoordinator(hass, entry, client)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    _register_services(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: MantelConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


def _coordinator(hass: HomeAssistant) -> MantelCoordinator:
    entries = [e for e in hass.config_entries.async_loaded_entries(DOMAIN)]
    if not entries:
        raise HomeAssistantError("Mantel is not set up")
    return entries[0].runtime_data


def _register_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, SERVICE_SAY):
        return

    async def say(call: ServiceCall) -> ServiceResponse:
        coordinator = _coordinator(hass)
        try:
            result = await coordinator.client.say(call.data["text"])
        except MantelError as err:
            raise HomeAssistantError(str(err)) from err
        await coordinator.async_request_refresh()
        return {"ok": result.get("ok", False), "speech": result.get("speech", "")}

    async def add_item(call: ServiceCall) -> None:
        coordinator = _coordinator(hass)
        try:
            await coordinator.client.add_item(call.data["item"], call.data.get("list"))
        except MantelError as err:
            raise HomeAssistantError(str(err)) from err
        await coordinator.async_request_refresh()

    async def post_note(call: ServiceCall) -> None:
        coordinator = _coordinator(hass)
        try:
            await coordinator.client.post_note(call.data["text"])
        except MantelError as err:
            raise HomeAssistantError(str(err)) from err

    hass.services.async_register(
        DOMAIN, SERVICE_SAY, say, schema=SAY_SCHEMA, supports_response=SupportsResponse.OPTIONAL
    )
    hass.services.async_register(DOMAIN, SERVICE_ADD_ITEM, add_item, schema=ADD_ITEM_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_POST_NOTE, post_note, schema=NOTE_SCHEMA)
