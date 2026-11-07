/**
 * Plugin contributions on the display (v3 X): what a server plugin's manifest lists under
 * `contributes` is drawn here from the blocks it serves, so a plugin ships no screen code.
 *
 * - `PluginCard` is the custom Today layout's `plugin:<id>` card (Today's default case).
 * - `PluginChips` sit in the dock right of the clock; a chip with a sheet opens it.
 * - `PluginAmbientLayer` registers Ambient slots; `PluginAlertLayer` shows `plugin.alert`
 *   banners and chimes. Both mount through the shell's feature layers (exports ending `Layer`).
 */
export { PluginAlertLayer } from './AlertLayer';
export { PluginAmbientLayer } from './AmbientSlots';
export { BlocksView, Countdown, formatCountdown } from './Blocks';
export { PluginChips } from './DockChips';
export { PluginIcon } from './icons';
export { PluginCard, usePluginOn } from './PluginCard';
export { loadPluginManifests, setPluginManifests, todayCardOf, usePluginManifests } from './store';
