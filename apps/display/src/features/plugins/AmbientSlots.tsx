import { useEffect } from 'react';
import { registerAmbientSlot } from '../../app/ambient';
import { BlocksView } from './Blocks';
import { usePluginOn } from './PluginCard';
import { ambientSlotOf, usePluginBlocks, usePluginManifests } from './store';

/**
 * Registers an Ambient slot for every plugin that contributes one (`contributes.ambientSlot`).
 * Renders nothing itself; mounted by the shell's feature layers so it runs on every display.
 */
export function PluginAmbientLayer() {
  const manifests = usePluginManifests();
  const on = usePluginOn();
  const wanted = manifests
    .map((m) => ({ id: m.id, slot: ambientSlotOf(m) }))
    .filter((x) => x.slot && on(x.id));
  const key = wanted.map((w) => `${w.id}:${w.slot!.id}:${w.slot!.data}:${w.slot!.order}`).join('|');
  useEffect(() => {
    const offs = wanted.map(({ id, slot }) =>
      registerAmbientSlot({
        id: `plugin:${id}:${slot!.id}`,
        order: slot!.order,
        Component: () => <AmbientBlocks id={id} name={slot!.data} />,
      }),
    );
    return () => offs.forEach((off) => off());
    // `key` says everything `wanted` holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

function AmbientBlocks({ id, name }: { id: string; name: string }) {
  const { value } = usePluginBlocks(id, name);
  if (!value) return null;
  return (
    <div className="nx plugin-ambient">
      <BlocksView plugin={id} blocks={value} variant="ambient" />
    </div>
  );
}
