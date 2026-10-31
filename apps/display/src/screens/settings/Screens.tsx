import { useState } from 'react';
import { DEFAULT_SCREENS, type ScreenConfig } from '@mantel/shared';
import { SCREEN_LABELS } from './contract';
import { Field, Section, TextInput } from './controls';

/**
 * Screens and the dock: which screens show, in what order (drag the handle, or use the arrows
 * on a touch screen), what each is called, and which one the wall starts on.
 */
export function ScreensSection({
  screens,
  defaultScreen,
  onChange,
}: {
  screens: ScreenConfig[] | undefined;
  defaultScreen: string | undefined;
  onChange: (screens: ScreenConfig[], defaultScreen: string) => void;
}) {
  const list = [...(screens?.length ? screens : DEFAULT_SCREENS)].sort((a, b) => a.order - b.order);
  const def = defaultScreen ?? list.find((s) => s.enabled)?.id ?? 'today';
  const [dragging, setDragging] = useState<string | null>(null);

  const commit = (next: ScreenConfig[], nextDefault = def) => {
    const ordered = next.map((s, i) => ({ ...s, order: i }));
    const stillOn = ordered.find((s) => s.id === nextDefault && s.enabled)
      ? nextDefault
      : (ordered.find((s) => s.enabled)?.id ?? 'today');
    onChange(ordered, stillOn);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    commit(next);
  };

  return (
    <Section
      id="screens"
      title="Screens and dock"
      hint="The dock is built from this list. Drag the handle to reorder, or use the arrows."
    >
      <ul className="set-screens">
        {list.map((s, i) => (
          <li
            key={s.id}
            className={`set-screen-row${dragging === s.id ? ' dragging' : ''}`}
            draggable
            onDragStart={(e) => {
              setDragging(s.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!dragging) return;
              move(
                list.findIndex((x) => x.id === dragging),
                i,
              );
              setDragging(null);
            }}
          >
            <span className="set-handle" aria-hidden="true" title="Drag to reorder">
              ⋮⋮
            </span>
            <span className="set-pair">
              <button
                type="button"
                className="set-btn sm quiet"
                aria-label={`Move ${SCREEN_LABELS[s.id] ?? s.id} up`}
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="set-btn sm quiet"
                aria-label={`Move ${SCREEN_LABELS[s.id] ?? s.id} down`}
                disabled={i === list.length - 1}
                onClick={() => move(i, i + 1)}
              >
                ↓
              </button>
            </span>
            <TextInput
              label={`${SCREEN_LABELS[s.id] ?? s.id} label`}
              value={s.label ?? ''}
              placeholder={SCREEN_LABELS[s.id] ?? s.id}
              maxLength={16}
              onChange={(label) =>
                commit(list.map((x) => (x.id === s.id ? { ...x, label: label || undefined } : x)))
              }
            />
            <label className="set-pair set-hint">
              <input
                type="radio"
                name="default-screen"
                className="set-radio"
                aria-label={`Start on ${SCREEN_LABELS[s.id] ?? s.id}`}
                disabled={!s.enabled}
                checked={def === s.id}
                onChange={() => commit(list, s.id)}
              />
              Start here
            </label>
            <button
              type="button"
              role="switch"
              aria-checked={s.enabled}
              aria-label={`${SCREEN_LABELS[s.id] ?? s.id} shown`}
              className={`sw${s.enabled ? ' on' : ''}`}
              onClick={() =>
                commit(list.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)))
              }
            />
          </li>
        ))}
      </ul>
      <Field
        label="Default screen"
        hint="Where the wall starts, and where it returns after Ambient."
      >
        <span className="set-hint">{SCREEN_LABELS[def] ?? def}</span>
      </Field>
    </Section>
  );
}
