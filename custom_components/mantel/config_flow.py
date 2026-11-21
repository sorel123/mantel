"""Set up Mantel with its address and an API token."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.const import CONF_URL
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import MantelAuthError, MantelClient, MantelError
from .const import CONF_TOKEN, DOMAIN

SCHEMA = vol.Schema({vol.Required(CONF_URL): str, vol.Required(CONF_TOKEN): str})


class MantelConfigFlow(ConfigFlow, domain=DOMAIN):
    """Ask for the address and token, check them, done."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            url = user_input[CONF_URL].strip().rstrip("/")
            if not url.startswith(("http://", "https://")):
                url = f"http://{url}"
            token = user_input[CONF_TOKEN].strip()
            await self.async_set_unique_id(url.lower())
            self._abort_if_unique_id_configured()
            client = MantelClient(async_get_clientsession(self.hass), url, token)
            try:
                await client.state()
            except MantelAuthError:
                errors[CONF_TOKEN] = "invalid_auth"
            except MantelError:
                errors[CONF_URL] = "cannot_connect"
            else:
                return self.async_create_entry(
                    title="Mantel", data={CONF_URL: url, CONF_TOKEN: token}
                )
        return self.async_show_form(
            step_id="user",
            data_schema=self.add_suggested_values_to_schema(SCHEMA, user_input or {}),
            errors=errors,
        )
