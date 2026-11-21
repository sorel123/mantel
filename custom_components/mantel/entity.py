"""The base for every Mantel entity."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import MantelCoordinator


class MantelEntity(CoordinatorEntity[MantelCoordinator]):
    _attr_has_entity_name = True

    def __init__(self, coordinator: MantelCoordinator, key: str) -> None:
        super().__init__(coordinator)
        entry = coordinator.config_entry
        self._attr_unique_id = f"{entry.unique_id}_{key}"
        version = (coordinator.data or {}).get("state", {}).get("version")
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.unique_id or entry.entry_id)},
            name="Mantel",
            manufacturer="Mantel",
            model="Family wall",
            sw_version=version,
            configuration_url=coordinator.client.url,
        )

    @property
    def state_data(self) -> dict:
        return self.coordinator.data["state"]
