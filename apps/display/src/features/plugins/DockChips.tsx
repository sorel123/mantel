import type { PluginManifest } from '@mantel/shared';
import { SheetHeader, useOverlay } from '../../app/overlay';
import { BlocksView, Countdown } from './Blocks';
import { PluginIcon } from './icons';
import { usePluginOn } from './PluginCard';
import { dockChipOf, usePluginBlocks, usePluginChip, usePluginManifests } from './store';
import './plugins.css';

/** The chips plugins put in the dock, right of the clock (`contributes.dockChip`). */
export function PluginChips() {
  const on = usePluginOn();
  const list = usePluginManifests().filter((m) => dockChipOf(m) && on(m.id));
  return (
    <>
      {list.map((m) => (
        <Chip key={m.id} manifest={m} />
      ))}
    </>
  );
}

function Chip({ manifest }: { manifest: PluginManifest }) {
  const def = dockChipOf(manifest)!;
  const overlay = useOverlay();
  const { value } = usePluginChip(manifest.id, def.data);
  const chip = value ?? def.idle ?? null;
  if (!chip) return null;
  const open = def.sheet
    ? () =>
        overlay.openSheet(
          (close) => (
            <>
              <SheetHeader title={manifest.name} onClose={close} />
              <SheetBody id={manifest.id} name={def.sheet!} />
            </>
          ),
          { label: manifest.name },
        )
    : undefined;
  return (
    <button
      type="button"
      className="pchip"
      data-tone={chip.tone}
      data-plugin={manifest.id}
      aria-label={chip.label ?? chip.text}
      onClick={open}
      disabled={!open}
    >
      <PluginIcon name={chip.icon} />
      {chip.countdownTo && (
        <b>
          <Countdown to={chip.countdownTo} />
        </b>
      )}
      {chip.text && <span>{chip.text}</span>}
    </button>
  );
}

function SheetBody({ id, name }: { id: string; name: string }) {
  const { value, loaded, error } = usePluginBlocks(id, name);
  if (!value)
    return <p className="pb-empty">{!loaded ? 'Loading…' : (error ?? 'Nothing to show.')}</p>;
  return <BlocksView plugin={id} blocks={value} variant="sheet" hideTitle />;
}
