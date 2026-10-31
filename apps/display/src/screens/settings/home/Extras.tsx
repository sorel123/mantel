import type { DiscoveredEntity, HomeConfig, HomeDiscovery, Person } from '@mantel/shared';
import { Chips, NumberInput, RemoveButton, TextInput, Toggle } from '../controls';
import {
  EMPTY_DOORBELL,
  parseEventTypes,
  patchDoorbell,
  presenceEntity,
  setPresence,
  setScene,
  triggerCandidates,
} from './model';

type Edit = (next: HomeConfig) => void;

/** Scene and script chips across the top of the Home screen. */
export function ScenesPicker({
  config,
  discovery,
  onChange,
}: {
  config: HomeConfig;
  discovery: HomeDiscovery | null;
  onChange: Edit;
}) {
  const known = (discovery?.entities ?? []).filter((e) => e.kind === 'scene');
  const options = [
    ...known.map((e) => ({ value: e.id, text: e.name })),
    // Keep configured scenes HA no longer reports, so they can be unticked.
    ...config.scenes
      .filter((s) => !known.some((e) => e.id === s.id))
      .map((s) => ({ value: s.id, text: s.id })),
  ];
  return (
    <div className="hs-block">
      <div className="set-label">
        Scenes
        <span className="set-hint">Chips across the top of the Home screen, in this order.</span>
      </div>
      <Chips
        label="Scenes"
        options={options}
        selected={config.scenes.map((s) => s.id)}
        onChange={(ids) => {
          let next = config;
          for (const id of ids) next = setScene(next, id, true);
          for (const s of config.scenes)
            if (!ids.includes(s.id)) next = setScene(next, s.id, false);
          onChange(next);
        }}
      />
    </div>
  );
}

const label = (e: DiscoveredEntity) => `${e.name} (${e.id})`;

/** Which camera pops over the screen, and what rings it. */
export function DoorbellPicker({
  config,
  discovery,
  onChange,
}: {
  config: HomeConfig;
  discovery: HomeDiscovery | null;
  onChange: Edit;
}) {
  const cameras = (discovery?.entities ?? []).filter((e) => e.kind === 'camera');
  const triggers = triggerCandidates(discovery);
  const bells = config.doorbells;
  return (
    <div className="hs-block">
      <div className="set-sec-head hs-block-head">
        <div className="set-label">
          Doorbell
          <span className="set-hint">
            When the trigger fires, the camera's live view pops over every screen.
          </span>
        </div>
        <button
          type="button"
          className="set-btn"
          onClick={() => onChange({ ...config, doorbells: [...bells, { ...EMPTY_DOORBELL }] })}
        >
          Add a doorbell
        </button>
      </div>
      {bells.length === 0 && <p className="set-hint">No doorbell yet.</p>}
      {bells.map((bell, i) => {
        const isEvent = bell.trigger.startsWith('event.');
        return (
          <div className="set-item hs-bell" key={i}>
            <div className="set-row">
              <label className="hs-select">
                <span className="set-hint">Camera</span>
                <select
                  className="set-input"
                  aria-label={`Doorbell ${i + 1} camera`}
                  value={bell.camera}
                  onChange={(e) => onChange(patchDoorbell(config, i, { camera: e.target.value }))}
                >
                  <option value="">Choose a camera…</option>
                  {cameras.map((c) => (
                    <option key={c.id} value={c.id}>
                      {label(c)}
                    </option>
                  ))}
                  {bell.camera && !cameras.some((c) => c.id === bell.camera) && (
                    <option value={bell.camera}>{bell.camera}</option>
                  )}
                </select>
              </label>
              <label className="hs-select">
                <span className="set-hint">Rings when</span>
                <select
                  className="set-input"
                  aria-label={`Doorbell ${i + 1} trigger`}
                  value={bell.trigger}
                  onChange={(e) =>
                    onChange(
                      patchDoorbell(config, i, {
                        trigger: e.target.value,
                        event_types: e.target.value.startsWith('event.')
                          ? bell.event_types
                          : undefined,
                      }),
                    )
                  }
                >
                  <option value="">Choose a trigger…</option>
                  {triggers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {label(t)}
                    </option>
                  ))}
                  {bell.trigger && !triggers.some((t) => t.id === bell.trigger) && (
                    <option value={bell.trigger}>{bell.trigger}</option>
                  )}
                </select>
              </label>
            </div>
            <div className="set-row">
              {isEvent && (
                <label className="hs-select">
                  <span className="set-hint">Event types (blank for any)</span>
                  <TextInput
                    label={`Doorbell ${i + 1} event types`}
                    placeholder="ding"
                    value={bell.event_types?.join(', ') ?? ''}
                    onChange={(text) =>
                      onChange(patchDoorbell(config, i, { event_types: parseEventTypes(text) }))
                    }
                  />
                </label>
              )}
              <label className="hs-select">
                <span className="set-hint">Seconds on screen</span>
                <NumberInput
                  label={`Doorbell ${i + 1} seconds`}
                  value={bell.seconds}
                  min={5}
                  max={300}
                  onChange={(seconds) =>
                    onChange(
                      patchDoorbell(config, i, {
                        seconds: Math.max(1, Math.min(300, Math.round(seconds))),
                      }),
                    )
                  }
                />
              </label>
              <RemoveButton
                label={`Remove doorbell ${i + 1}`}
                onClick={() => onChange({ ...config, doorbells: bells.filter((_, j) => j !== i) })}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Who is home: each person in settings matched to an HA `person.*`. */
export function PresencePicker({
  config,
  discovery,
  people,
  onChange,
}: {
  config: HomeConfig;
  discovery: HomeDiscovery | null;
  people: Person[];
  onChange: Edit;
}) {
  const persons = (discovery?.entities ?? []).filter((e) => e.domain === 'person');
  const ids = people.map((p) => p.id);
  return (
    <div className="hs-block">
      <div className="set-label">
        Who is home
        <span className="set-hint">
          Each person's phone, through the Home Assistant companion app. Automatic picks
          person.&lt;id&gt; when it exists.
        </span>
      </div>
      {people.length === 0 && <p className="set-hint">Add people in the People section first.</p>}
      {people.map((p) => {
        const chosen = presenceEntity(config, p.id, discovery);
        return (
          <div className="set-row hs-person" key={p.id}>
            <span className="hs-person-name">
              <i style={{ background: p.color }} />
              {p.name || p.id}
            </span>
            <select
              className="set-input"
              aria-label={`${p.name || p.id} presence entity`}
              value={chosen ?? ''}
              onChange={(e) =>
                onChange(setPresence(config, ids, p.id, e.target.value || null, discovery))
              }
            >
              <option value="">Not tracked</option>
              {persons.map((e) => (
                <option key={e.id} value={e.id}>
                  {label(e)}
                </option>
              ))}
              {chosen && !persons.some((e) => e.id === chosen) && (
                <option value={chosen}>{chosen}</option>
              )}
            </select>
          </div>
        );
      })}
      <Toggle
        label="Wake the screen when someone gets home"
        checked={config.presence_display.wake_on_arrival}
        onChange={(wake_on_arrival) =>
          onChange({
            ...config,
            presence_display: { ...config.presence_display, wake_on_arrival },
          })
        }
      />
      <Toggle
        label="Sleep the screen when everyone is out"
        checked={config.presence_display.sleep_when_away}
        onChange={(sleep_when_away) =>
          onChange({
            ...config,
            presence_display: { ...config.presence_display, sleep_when_away },
          })
        }
      />
    </div>
  );
}
