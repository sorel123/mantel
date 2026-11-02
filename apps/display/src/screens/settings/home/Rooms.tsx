import type { DiscoveredEntity, HomeConfig, HomeDiscovery } from '@mantel/shared';
import { useMemo, useState } from 'react';
import { TextInput } from '../controls';
import {
  controllable,
  entityIncluded,
  moveRoom,
  patchEntity,
  refOf,
  removeRoom,
  renameRoom,
  roomEntities,
  roomRows,
  setEntity,
  setRoom,
  showable,
  type RoomRow,
} from './model';

const KIND_LABEL: Record<string, string> = {
  light: 'Light',
  switch: 'Switch',
  climate: 'Thermostat',
  lock: 'Lock',
  cover: 'Door',
  sensor: 'Sensor',
  camera: 'Camera',
  scene: 'Scene',
};

const KIND_ORDER = ['light', 'switch', 'scene', 'climate', 'lock', 'cover', 'camera', 'sensor'];
const KIND_PLURAL: Record<string, string> = {
  light: 'Lights',
  switch: 'Switches',
  climate: 'Thermostats',
  lock: 'Locks',
  cover: 'Doors',
  sensor: 'Sensors',
  camera: 'Cameras',
  scene: 'Scenes',
};

type Edit = (next: HomeConfig) => void;

/**
 * The rooms list: one row per Home Assistant area (and per hand-made room) with a switch, a
 * drag handle to order the shown ones, and an expander for the devices inside.
 */
export function RoomsPicker({
  config,
  discovery,
  onChange,
}: {
  config: HomeConfig;
  discovery: HomeDiscovery | null;
  onChange: Edit;
}) {
  const rows = useMemo(() => roomRows(config, discovery), [config, discovery]);
  const [open, setOpen] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const shown = rows.filter((r) => r.on);
  const hidden = rows.filter((r) => !r.on);

  const drop = (to: number) => {
    if (dragging !== null) onChange(moveRoom(config, dragging, to));
    setDragging(null);
  };

  return (
    <div className="hs-rooms">
      <ul className="hs-room-list" aria-label="Rooms on the Home screen">
        {shown.map((row, i) => (
          <li
            key={row.key}
            className={`hs-room${open === row.key ? ' open' : ''}${dragging === i ? ' dragging' : ''}`}
            draggable={shown.length > 1}
            onDragStart={() => setDragging(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drop(i)}
            onDragEnd={() => setDragging(null)}
          >
            <RoomHead
              row={row}
              index={i}
              count={shown.length}
              config={config}
              discovery={discovery}
              open={open === row.key}
              onToggleOpen={() => setOpen(open === row.key ? null : row.key)}
              onChange={onChange}
            />
            {open === row.key && row.room && (
              <RoomBody row={row} config={config} discovery={discovery} onChange={onChange} />
            )}
          </li>
        ))}
        {shown.length === 0 && (
          <li className="hs-empty set-hint">
            No rooms yet. Turn on a room below to put it on the Home screen.
          </li>
        )}
      </ul>
      {hidden.length > 0 && (
        <>
          <div className="hs-sub eyebrow">Not shown</div>
          <ul className="hs-room-list muted" aria-label="Rooms not on the Home screen">
            {hidden.map((row) => (
              <li key={row.key} className="hs-room off">
                <div className="hs-room-head">
                  <span className="hs-grip" aria-hidden="true" />
                  <button
                    type="button"
                    role="switch"
                    aria-checked={false}
                    aria-label={`Show ${row.name}`}
                    className="sw"
                    onClick={() => row.area && onChange(setRoom(config, row.area, true))}
                  />
                  <span className="hs-room-name">{row.name}</span>
                  <span className="set-hint">
                    {countIn(row, discovery)} {countIn(row, discovery) === 1 ? 'device' : 'devices'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function countIn(row: RoomRow, discovery: HomeDiscovery | null) {
  if (!discovery || !row.area) return 0;
  const id = row.area.id;
  return discovery.entities.filter((e) => e.areaId === id && showable(e)).length;
}

function RoomHead({
  row,
  index,
  count,
  config,
  discovery,
  open,
  onToggleOpen,
  onChange,
}: {
  row: RoomRow;
  index: number;
  count: number;
  config: HomeConfig;
  discovery: HomeDiscovery | null;
  open: boolean;
  onToggleOpen: () => void;
  onChange: Edit;
}) {
  const room = row.room!;
  const all = roomEntities(room, discovery, row.area);
  const on = all.filter((e) => entityIncluded(room, e, row.area)).length;
  const summary = discovery
    ? all.length
      ? `${on} of ${all.length} shown`
      : 'Nothing in it yet'
    : `${room.entities.length} listed`;

  return (
    <div className="hs-room-head">
      <span className="hs-grip" title="Drag to reorder" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
        </svg>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={true}
        aria-label={`Show ${row.name}`}
        className="sw on"
        onClick={() =>
          onChange(row.area ? setRoom(config, row.area, false) : removeRoom(config, room.id))
        }
      />
      <TextInput
        label={`${row.name} room name`}
        value={room.name}
        onChange={(name) => onChange(renameRoom(config, room.id, name || room.name))}
      />
      <span className="set-hint hs-count">{summary}</span>
      <span className="hs-order">
        <button
          type="button"
          className="set-btn quiet"
          aria-label={`Move ${row.name} up`}
          disabled={index === 0}
          onClick={() => onChange(moveRoom(config, index, index - 1))}
        >
          ↑
        </button>
        <button
          type="button"
          className="set-btn quiet"
          aria-label={`Move ${row.name} down`}
          disabled={index === count - 1}
          onClick={() => onChange(moveRoom(config, index, index + 1))}
        >
          ↓
        </button>
      </span>
      <button
        type="button"
        className="set-btn quiet hs-expand"
        aria-expanded={open}
        aria-label={`${open ? 'Hide' : 'Choose'} devices in ${row.name}`}
        onClick={onToggleOpen}
      >
        {open ? 'Done' : 'Devices'}
      </button>
    </div>
  );
}

function RoomBody({
  row,
  config,
  discovery,
  onChange,
}: {
  row: RoomRow;
  config: HomeConfig;
  discovery: HomeDiscovery | null;
  onChange: Edit;
}) {
  const room = row.room!;
  const entities = roomEntities(room, discovery, row.area);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  const [kind, setKind] = useState<string>('all');
  const [onlyLoose, setOnlyLoose] = useState(false);

  const q = query.trim().toLowerCase();
  const areaName = useMemo(
    () => new Map((discovery?.areas ?? []).map((a) => [a.id, a.name])),
    [discovery],
  );
  // Everything already on the Home screen in some room, for "not in a room yet".
  const placed = useMemo(() => {
    const ids = new Set<string>();
    for (const r of roomRows(config, discovery))
      if (r.room)
        for (const e of roomEntities(r.room, discovery, r.area))
          if (entityIncluded(r.room, e, r.area)) ids.add(e.id);
    return ids;
  }, [config, discovery]);
  const pool = (discovery?.entities ?? []).filter(
    (e) =>
      showable(e) &&
      !entities.some((x) => x.id === e.id) &&
      (!onlyLoose || !placed.has(e.id)) &&
      (!q || e.name.toLowerCase().includes(q) || e.id.includes(q)),
  );
  const kinds = KIND_ORDER.filter((k) => pool.some((e) => e.kind === k));
  const candidates = pool
    .filter((e) => kind === 'all' || e.kind === kind)
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind ?? '') - KIND_ORDER.indexOf(b.kind ?? '') ||
        a.name.localeCompare(b.name),
    );
  const addAll = () => {
    let next = config;
    for (const e of candidates) next = setEntity(next, room.id, e, true, row.area);
    onChange(next);
  };

  return (
    <div className="hs-room-body">
      {entities.length === 0 && !adding && (
        <p className="set-hint">
          Home Assistant has nothing in this area. Add devices from elsewhere below.
        </p>
      )}
      {entities.map((e) => (
        <EntityRow key={e.id} e={e} row={row} config={config} onChange={onChange} />
      ))}
      {adding ? (
        <div className="hs-add">
          <TextInput
            label={`Search devices to add to ${room.name}`}
            placeholder="Search by name, or type an id like sensor.porch_temperature"
            value={query}
            onChange={setQuery}
          />
          <div className="hs-filter" role="group" aria-label="Show">
            {['all', ...kinds].map((k) => (
              <button
                key={k}
                type="button"
                className="set-btn quiet"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
              >
                {k === 'all'
                  ? `All (${pool.length})`
                  : `${KIND_PLURAL[k]} (${pool.filter((e) => e.kind === k).length})`}
              </button>
            ))}
            <label className="hs-loose">
              <input
                type="checkbox"
                checked={onlyLoose}
                onChange={(ev) => setOnlyLoose(ev.target.checked)}
              />
              Only ones not in a room yet
            </label>
          </div>
          {kind !== 'all' && candidates.length > 1 && (
            <button type="button" className="set-btn" onClick={addAll}>
              Add all {candidates.length} {KIND_PLURAL[kind]?.toLowerCase()}
            </button>
          )}
          <div className="hs-candidates" aria-label="Devices to add">
            {candidates.map((e) => (
              <button
                key={e.id}
                type="button"
                className="set-btn"
                onClick={() => {
                  onChange(setEntity(config, room.id, e, true, row.area));
                  setQuery('');
                }}
              >
                {e.name}
                <small>
                  {e.kind ? KIND_LABEL[e.kind] : e.domain}
                  {e.areaId && areaName.get(e.areaId) ? ` · ${areaName.get(e.areaId)}` : ''}
                </small>
              </button>
            ))}
            {candidates.length === 0 && /^[a-z_]+\.[a-z0-9_]+$/.test(q) && (
              <button
                type="button"
                className="set-btn"
                onClick={() => {
                  onChange(
                    setEntity(
                      config,
                      room.id,
                      { id: q, domain: q.split('.')[0]!, name: q, areaId: null, state: 'unknown' },
                      true,
                      row.area,
                    ),
                  );
                  setQuery('');
                }}
              >
                Add {q}
              </button>
            )}
            {candidates.length === 0 && q && !/^[a-z_]+\.[a-z0-9_]+$/.test(q) && (
              <span className="set-hint">Nothing matches.</span>
            )}
          </div>
          <button type="button" className="set-btn quiet" onClick={() => setAdding(false)}>
            Done adding
          </button>
        </div>
      ) : (
        <button type="button" className="set-btn" onClick={() => setAdding(true)}>
          Add a device from elsewhere
        </button>
      )}
    </div>
  );
}

function EntityRow({
  e,
  row,
  config,
  onChange,
}: {
  e: DiscoveredEntity;
  row: RoomRow;
  config: HomeConfig;
  onChange: Edit;
}) {
  const room = row.room!;
  const included = entityIncluded(room, e, row.area);
  const ref = refOf(room, e.id);
  const readOnly = ref?.read_only === true;
  const kind = e.kind ? KIND_LABEL[e.kind] : e.domain;
  return (
    <div className={`hs-entity${included ? '' : ' off'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={included}
        aria-label={`Show ${e.name}`}
        className={`sw${included ? ' on' : ''}`}
        onClick={() => onChange(setEntity(config, room.id, e, !included, row.area))}
      />
      <span className="hs-entity-name">
        {included ? (
          <TextInput
            label={`${e.name} name on the display`}
            placeholder={e.name}
            value={ref?.name ?? ''}
            onChange={(name) => onChange(patchEntity(config, room.id, e, { name }, row.area))}
          />
        ) : (
          <span>{e.name}</span>
        )}
        <small className="set-hint">
          {kind} · {e.id}
          {e.state && e.state !== 'unknown' && e.state !== 'unavailable' ? ` · ${e.state}` : ''}
        </small>
      </span>
      {included && controllable(e) && (
        <label className={`hs-ro${readOnly ? ' on' : ''}`}>
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(ev) =>
              onChange(patchEntity(config, room.id, e, { read_only: ev.target.checked }, row.area))
            }
          />
          Read-only
        </label>
      )}
    </div>
  );
}
