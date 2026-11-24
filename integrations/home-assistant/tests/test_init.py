"""Set up Mantel against the mock server: the flow, sensors, calendars, services and events."""

from __future__ import annotations

from datetime import timedelta
import json
import urllib.request

import pytest

from homeassistant import config_entries
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import CONF_URL
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_capture_events

from custom_components.mantel.const import CONF_TOKEN, DOMAIN, EVENT_CHORE_DONE


async def _setup(hass: HomeAssistant, server: dict[str, str], token: str | None = None):
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id=server["url"],
        data={CONF_URL: server["url"], CONF_TOKEN: token or server["token"]},
    )
    entry.add_to_hass(hass)
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_config_flow(hass: HomeAssistant, mantel_server) -> None:
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.FORM

    bad = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_URL: mantel_server["url"], CONF_TOKEN: "mtl_wrong"}
    )
    assert bad["errors"] == {CONF_TOKEN: "invalid_auth"}

    nowhere = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_URL: "http://127.0.0.1:9", CONF_TOKEN: mantel_server["token"]}
    )
    assert nowhere["errors"] == {CONF_URL: "cannot_connect"}

    done = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_URL: mantel_server["url"] + "/", CONF_TOKEN: mantel_server["token"]}
    )
    assert done["type"] is FlowResultType.CREATE_ENTRY
    assert done["data"][CONF_URL] == mantel_server["url"]


async def test_sensors_and_calendars(hass: HomeAssistant, mantel_server) -> None:
    entry = await _setup(hass, mantel_server)
    assert entry.state is ConfigEntryState.LOADED

    grocery = hass.states.get("sensor.mantel_grocery_list")
    assert grocery is not None and int(grocery.state) >= 0
    assert "lists" in grocery.attributes
    assert hass.states.get("sensor.mantel_dinner_tonight") is not None
    assert hass.states.get("sensor.mantel_next_event") is not None
    # The mock mailbox fills the inbox a second after start (workstream K).
    inbox = hass.states.get("sensor.mantel_inbox")
    assert inbox is not None and inbox.state.isdigit()
    leo = hass.states.get("sensor.mantel_leo_chores_left")
    assert leo is not None and leo.state.isdigit()
    assert hass.states.get("sensor.mantel_leo_stars") is not None

    calendars = [s for s in hass.states.async_all("calendar")]
    assert len(calendars) >= 3
    family = hass.states.get("calendar.mantel_family")
    assert family is not None
    now = dt_util.now()
    events = await hass.services.async_call(
        "calendar",
        "get_events",
        {"start_date_time": now - timedelta(days=1), "end_date_time": now + timedelta(days=7)},
        target={"entity_id": [s.entity_id for s in calendars]},
        blocking=True,
        return_response=True,
    )
    assert sum(len(v["events"]) for v in events.values()) > 0


async def test_services(hass: HomeAssistant, mantel_server) -> None:
    await _setup(hass, mantel_server)
    before = int(hass.states.get("sensor.mantel_grocery_list").state)

    said = await hass.services.async_call(
        DOMAIN, "say", {"text": "oat milk and figs"}, blocking=True, return_response=True
    )
    assert said["ok"] is True
    assert said["speech"].startswith("Added oat milk and figs to ")

    await hass.services.async_call(DOMAIN, "add_item", {"item": "Capers"}, blocking=True)
    await hass.services.async_call(DOMAIN, "post_note", {"text": "Back at 5"}, blocking=True)
    await hass.config_entries.async_entries(DOMAIN)[0].runtime_data.async_refresh()
    await hass.async_block_till_done()
    assert int(hass.states.get("sensor.mantel_grocery_list").state) == before + 3


async def test_chore_done_fires_an_event(hass: HomeAssistant, mantel_server) -> None:
    entry = await _setup(hass, mantel_server)
    events = async_capture_events(hass, EVENT_CHORE_DONE)
    req = urllib.request.Request(
        f"{mantel_server['url']}/api/chores/chore-table/done",
        data=json.dumps({}).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    await hass.async_add_executor_job(urllib.request.urlopen, req)
    # The server gathers chore changes for a moment before it records them.
    for _ in range(30):
        await entry.runtime_data.async_refresh()
        await hass.async_block_till_done()
        if events:
            break
        await hass.async_add_executor_job(__import__("time").sleep, 0.2)
    assert events, "no mantel_chore_done event"
    assert events[0].data["title"]


async def test_read_only_token_cannot_add(hass: HomeAssistant, mantel_server) -> None:
    await _setup(hass, mantel_server, mantel_server["read_token"])
    from homeassistant.exceptions import HomeAssistantError

    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            DOMAIN, "say", {"text": "milk"}, blocking=True, return_response=True
        )
