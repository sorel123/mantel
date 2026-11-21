/**
 * Settings, Plugins (v4 G): a gallery of every plugin that draws on the wall (the plugin pack,
 * trash day, timers). Each tile shows a live preview of its Today card, turns on or off in one
 * tap, adds its card to Today in one tap, and opens its setup form in place.
 */
import {
  cardMin,
  findSpot,
  type TodayCard,
  type IntegrationStatus,
  type PluginBlocks,
  type PluginCardKind,
  type PluginManifest,
  type Settings,
  PluginBlocks as PluginBlocksSchema,
} from '@mantel/shared';
import { pluginBlocks as legacySamples, pluginPackSamples } from '@mantel/shared/fixtures';
import { useMemo, useState } from 'react';
import { OverlayProvider } from '../../../app/overlay';
import { api } from '../../../lib/api';
import { previewUrl } from '../../../lib/preview';
import { BlocksView } from '../../../features/plugins/Blocks';
import { PluginIcon } from '../../../features/plugins/icons';
import { todayCardOf, usePluginBlocks } from '../../../features/plugins/store';
import { errorText } from '../client';
import { Section, Seg, StatusBadge } from '../controls';
import { IntegrationCard } from '../Integrations';
import './plugins.css';

/** Plugins with a card of their own (the gallery), in the order families reach for them. */
const ORDER = [
  'birthdays',
  'pets',
  'poll',
  'habits',
  'school',
  'sports',
  'qotd',
  'sky',
  'housestatus',
  'trash',
  'timers',
];

const rank = (id: string) => {
  const i = ORDER.indexOf(id);
  return i < 0 ? ORDER.length : i;
};

/** A sample card for a plugin that is off (it answers nothing then). */
function sample(id: string): PluginBlocks | null {
  const raw =
    pluginPackSamples()[id] ??
    legacySamples()[`${id}/card`] ??
    legacySamples()[`${id}/sheet`] ??
    null;
  const parsed = raw ? PluginBlocksSchema.safeParse(raw) : null;
  return parsed?.success ? parsed.data : null;
}

export function PluginsSection({
  draft,
  set,
  plugins,
  statuses,
  onStatus,
}: {
  draft: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  plugins: PluginManifest[];
  statuses: Record<string, IntegrationStatus>;
  onStatus: (s: IntegrationStatus) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all');
  const gallery = useMemo(
    () =>
      plugins
        .filter((p) => todayCardOf(p) || typeof p.contributes.dockChip === 'object')
        .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name)),
    [plugins],
  );
  const shown = gallery.filter((p) => {
    const on = statuses[p.id]?.enabled ?? true;
    return filter === 'all' || (filter === 'on') === on;
  });
  const onToday = (id: string) => draft.layout.todayCards.some((c) => c.kind === `plugin:${id}`);

  return (
    <Section
      id="plugins"
      title="Plugins"
      hint="Small cards for the wall. Turn one on, add its card to Today, and set it up here. A plugin that is off leaves every screen."
    >
      <div className="plg-filter">
        <Seg
          label="Show"
          value={filter}
          options={[
            ['all', 'All'],
            ['on', 'On'],
            ['off', 'Off'],
          ]}
          onChange={setFilter}
        />
      </div>
      {gallery.length === 0 && (
        <div className="plg-grid" aria-label="Loading plugins">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="plg-tile skeleton" style={{ minHeight: 280 }} />
          ))}
        </div>
      )}
      {gallery.length > 0 && shown.length === 0 && (
        <p className="set-hint">
          {filter === 'on' ? 'No plugins are on yet.' : 'Every plugin is on.'}
        </p>
      )}
      {/* Live previews press real buttons; their toasts need an overlay on this page. */}
      <OverlayProvider>
        <div className="plg-grid">
          {shown.map((p) => (
            <PluginTile
              key={p.id}
              manifest={p}
              status={statuses[p.id]}
              onStatus={onStatus}
              onToday={onToday(p.id)}
              layout={draft.layout}
              setLayout={(layout) => set('layout', layout)}
            />
          ))}
        </div>
      </OverlayProvider>
      {gallery.some((p) => onToday(p.id)) && draft.layout.todayPreset === 'custom' && (
        <p className="set-hint">
          <a
            href={previewUrl({ layout: draft.layout, screen: 'today' })}
            target="_blank"
            rel="noreferrer"
          >
            Preview Today with these cards
          </a>{' '}
          before you save.
        </p>
      )}
    </Section>
  );
}

function PluginTile({
  manifest,
  status,
  onStatus,
  onToday,
  layout,
  setLayout,
}: {
  manifest: PluginManifest;
  status: IntegrationStatus | undefined;
  onStatus: (s: IntegrationStatus) => void;
  onToday: boolean;
  layout: Settings['layout'];
  setLayout: (l: Settings['layout']) => void;
}) {
  const enabled = status?.enabled ?? true;
  const state = enabled ? (status?.state ?? 'not_set_up') : 'disabled';
  const card = todayCardOf(manifest);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [setup, setSetup] = useState(false);
  const fields = manifest.fields.filter((f) => !f.readOnly);
  const fallback = sample(manifest.id);

  const toggle = async () => {
    setBusy(true);
    setNote(null);
    try {
      const { integration } = await api.call('integrationPut', {
        params: { id: manifest.id },
        body: { enabled: !enabled },
      });
      onStatus(integration);
      setNote({
        ok: true,
        text: integration.enabled ? `${manifest.name} is on.` : `${manifest.name} is off.`,
      });
    } catch (err) {
      setNote({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const addToToday = () => {
    if (!card) return;
    const kind = `plugin:${manifest.id}` as PluginCardKind;
    if (onToday) {
      setLayout({ ...layout, todayCards: layout.todayCards.filter((c) => c.kind !== kind) });
      setNote({ ok: true, text: 'Taken off Today. Save to apply.' });
      return;
    }
    const placed = placeCard(layout.todayCards, kind, [card.comfort ?? card.min, card.min]);
    if (placed) {
      setLayout({ ...layout, todayPreset: 'custom', todayCards: placed.cards });
      setNote({
        ok: true,
        text: `Added to Today${placed.shrunk ? `, beside a smaller ${placed.shrunk}` : ''}${layout.todayPreset === 'custom' ? '' : ' (Today now uses Your own layout)'}. Save to put it on the wall.`,
      });
      return;
    }
    setNote({
      ok: false,
      text: 'Today is full. Make room in Settings, Layout, then add it again.',
    });
  };

  return (
    <article
      className={`plg-tile card inset${enabled ? '' : ' off'}`}
      aria-label={manifest.name}
      data-plugin={manifest.id}
    >
      <header className="plg-head">
        <span className="plg-icon">
          <PluginIcon name={fallback?.icon ?? 'info'} />
        </span>
        <div className="grow">
          <h3 className="h3">{manifest.name}</h3>
          <StatusBadge state={state} />
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`${manifest.name} on`}
          disabled={busy || !status}
          className={`sw${enabled ? ' on' : ''}`}
          onClick={() => void toggle()}
        />
      </header>
      <p className="set-hint plg-desc">
        {enabled && status?.summary && status.state === 'connected'
          ? status.summary
          : manifest.description}
      </p>

      <div className="plg-preview" aria-label={`${manifest.name} preview`}>
        {enabled && card ? (
          <Live id={manifest.id} name={card.data} fallback={fallback} />
        ) : fallback ? (
          <Frozen id={manifest.id} blocks={fallback} />
        ) : null}
        {!enabled && <span className="plg-sample">Sample</span>}
      </div>

      {note && (
        <p className={`plg-note${note.ok ? '' : ' bad'}`} role="status">
          {note.text}
        </p>
      )}

      <div className="plg-actions">
        {card && (
          <button
            type="button"
            className={`set-btn${onToday ? ' quiet' : ' primary'}`}
            onClick={addToToday}
            disabled={!enabled}
          >
            <PluginIcon name={onToday ? 'check' : 'plus'} />
            {onToday ? 'On Today' : 'Add to Today'}
          </button>
        )}
        {fields.length > 0 && (
          <button
            type="button"
            className="set-btn quiet"
            aria-expanded={setup}
            onClick={() => setSetup((s) => !s)}
          >
            {setup ? 'Done' : state === 'not_set_up' ? 'Set up' : 'Settings'}
          </button>
        )}
      </div>
      {setup && (
        <div className="plg-setup">
          <IntegrationCard manifest={manifest} status={status} onStatus={onStatus} open />
        </div>
      )}
    </article>
  );
}

/**
 * Put a card on the Today grid: in a free spot if there is one, else by taking room from the
 * edge of the biggest card that can give it up and stay readable. Null when nothing fits.
 */
export function placeCard(
  cards: readonly TodayCard[],
  kind: PluginCardKind,
  sizes: Array<readonly [number, number]>,
): { cards: TodayCard[]; shrunk: string | null } | null {
  for (const [w, h] of sizes) {
    const spot = findSpot(cards, w, h);
    if (spot) return { cards: [...cards, { id: kind, kind, ...spot, w, h }], shrunk: null };
  }
  const biggest = [...cards].sort((a, b) => b.w * b.h - a.w * a.h);
  for (const [w, h] of sizes)
    for (const c of biggest) {
      const [minW, minH] = cardMin(c.kind);
      const others = cards.filter((x) => x !== c);
      const name = c.kind.startsWith('plugin:') ? 'card' : `${c.kind} card`;
      // Take a strip off the bottom, or off the right side.
      if (c.w >= w && c.h - h >= minH)
        return {
          cards: [
            ...others,
            { ...c, h: c.h - h },
            { id: kind, kind, x: c.x, y: c.y + c.h - h, w, h },
          ],
          shrunk: name,
        };
      if (c.h >= h && c.w - w >= minW)
        return {
          cards: [
            ...others,
            { ...c, w: c.w - w },
            { id: kind, kind, x: c.x + c.w - w, y: c.y, w, h },
          ],
          shrunk: name,
        };
    }
  return null;
}

/** The card as the wall draws it right now. */
function Live({ id, name, fallback }: { id: string; name: string; fallback: PluginBlocks | null }) {
  const { value, loaded } = usePluginBlocks(id, name);
  if (value) return <BlocksView plugin={id} blocks={value} variant="card" />;
  if (!loaded)
    return (
      <div className="pb-skel" aria-label="Loading">
        <i className="skeleton" />
        <i className="skeleton" />
      </div>
    );
  return fallback ? (
    <Frozen id={id} blocks={fallback} />
  ) : (
    <p className="pb-empty">Nothing to show yet.</p>
  );
}

/** A sample that cannot be pressed. */
function Frozen({ id, blocks }: { id: string; blocks: PluginBlocks }) {
  return (
    <div className="plg-frozen" aria-hidden="true">
      <BlocksView plugin={id} blocks={blocks} variant="card" />
    </div>
  );
}
