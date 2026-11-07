import type { PluginCardKind } from '@mantel/shared';
import { useBootstrapState } from '../../lib/bootstrap';
import { BlocksView } from './Blocks';
import { PluginIcon } from './icons';
import { todayCardOf, usePluginBlocks, usePluginManifests } from './store';

/** Whether a plugin is on, from the loaded bootstrap (on when unknown). */
export function usePluginOn(): (id: string) => boolean {
  const { state } = useBootstrapState();
  const toggles = state.status === 'ready' ? state.data.settings.integrations : undefined;
  return (id) =>
    (toggles as Record<string, { enabled?: boolean }> | undefined)?.[id]?.enabled !== false;
}

/**
 * A plugin's card on the custom Today layout (`plugin:<id>`), drawn from its blocks. Nothing
 * when the plugin is turned off; a quiet placeholder while it loads or when it is gone.
 */
export function PluginCard({ kind }: { kind: PluginCardKind }) {
  const id = kind.slice('plugin:'.length);
  const manifest = usePluginManifests().find((m) => m.id === id);
  const on = usePluginOn()(id);
  const card = manifest ? todayCardOf(manifest) : null;
  if (!on) return null;
  return (
    <div className="card plugin-card" data-plugin={id}>
      {card && manifest ? (
        <Live id={id} name={card.data} title={card.name} />
      ) : (
        <div className="pb" data-variant="card">
          <div className="pb-head">
            <PluginIcon name="info" />
            <b>{manifest?.name ?? id}</b>
          </div>
        </div>
      )}
    </div>
  );
}

function Live({ id, name, title }: { id: string; name: string; title: string }) {
  const { value, loaded, error } = usePluginBlocks(id, name);
  if (value) return <BlocksView plugin={id} blocks={value} variant="card" />;
  return (
    <div className="pb" data-variant="card">
      <div className="pb-head">
        <PluginIcon name="info" />
        <b>{title}</b>
      </div>
      <p className="pb-empty">
        {!loaded ? 'Loading…' : error ? 'Not reachable right now.' : 'Nothing to show.'}
      </p>
    </div>
  );
}
