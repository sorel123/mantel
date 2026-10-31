import type { HomeEntity } from '@mantel/shared';
import { useEffect, useRef, useState } from 'react';
import { HVAC_ACTION, HVAC_LABEL, isUnavailable, numAttr } from './format';
import type { CallFn } from './useHome';

/** The dial's arc: 270° of a r=52 circle, as in the mockup. */
const ARC = 245;
const SETTLE_MS = 900;

type Target = { kind: 'single'; t: number } | { kind: 'range'; low: number; high: number } | null;

function targetOf(e: HomeEntity): Target {
  const t = numAttr(e, 'temperature');
  const low = numAttr(e, 'target_temp_low');
  const high = numAttr(e, 'target_temp_high');
  if (e.state === 'off' || isUnavailable(e)) return null;
  if (t !== null) return { kind: 'single', t };
  if (low !== null && high !== null) return { kind: 'range', low, high };
  return null;
}

/**
 * Thermostats (the ecobees): a tab per thermostat, the mockup's dial with − and +, and the
 * HVAC modes it supports. Setpoint taps are gathered and sent once they stop.
 */
export function ClimateCard({ entities, call }: { entities: HomeEntity[]; call: CallFn }) {
  const [selected, setSelected] = useState(entities[0]?.id);
  const e = entities.find((x) => x.id === selected) ?? entities[0];
  if (!e) return null;
  return (
    <div className="card hm-room hm-climate">
      <div className="hm-rh">
        <span className="nm">{entities.length > 1 ? 'Thermostats' : e.name}</span>
        <span className="st">{statusLine(e, entities.length > 1)}</span>
      </div>
      {entities.length > 1 && (
        <div className="hm-tabs" role="tablist">
          {entities.map((x) => {
            const cur = numAttr(x, 'current_temperature');
            return (
              <button
                key={x.id}
                role="tab"
                aria-selected={x.id === e.id}
                onClick={() => setSelected(x.id)}
              >
                <span>{x.name}</span>
                {cur !== null && <b className="tnum">{Math.round(cur)}°</b>}
              </button>
            );
          })}
        </div>
      )}
      <Dial key={e.id} e={e} call={call} />
    </div>
  );
}

/** "Heating · 66° now"; with tabs, which already show the temperature, just "Heating". */
function statusLine(e: HomeEntity, short: boolean) {
  if (isUnavailable(e)) return 'Unavailable';
  const action = typeof e.attrs.hvac_action === 'string' ? HVAC_ACTION[e.attrs.hvac_action] : null;
  const cur = numAttr(e, 'current_temperature');
  const parts = [
    action ?? HVAC_LABEL[e.state] ?? e.state,
    cur !== null && !short ? `${Math.round(cur)}° now` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}

function Dial({ e, call }: { e: HomeEntity; call: CallFn }) {
  const min = numAttr(e, 'min_temp') ?? 45;
  const max = numAttr(e, 'max_temp') ?? 95;
  const unit = e.attrs.unit_of_measurement === '°C' ? '°C' : '°F';
  const step = numAttr(e, 'target_temp_step') ?? (unit === '°C' ? 0.5 : 1);
  const server = targetOf(e);
  const [pending, setPending] = useState<Target>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const target = pending ?? server;
  const disabled = e.attrs.read_only === true || isUnavailable(e);

  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const nudge = (dir: 1 | -1) => {
    if (!target) return;
    const next: Target =
      target.kind === 'single'
        ? { kind: 'single', t: clamp(target.t + dir * step) }
        : {
            kind: 'range',
            low: clamp(target.low + dir * step),
            high: clamp(target.high + dir * step),
          };
    setPending(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const data =
        next.kind === 'single'
          ? { temperature: next.t }
          : { target_temp_low: next.low, target_temp_high: next.high };
      void call(e, 'set_temperature', data, { attrs: data }).finally(() => setPending(null));
    }, SETTLE_MS);
  };

  const cur = numAttr(e, 'current_temperature');
  const shown = target
    ? target.kind === 'single'
      ? target.t
      : (target.low + target.high) / 2
    : cur;
  const frac = shown === null ? 0 : Math.max(0, Math.min(1, (shown - min) / (max - min)));
  const action = String(e.attrs.hvac_action ?? '');
  const tone =
    action === 'cooling' || e.state === 'cool'
      ? 'cool'
      : action === 'heating' || e.state === 'heat'
        ? 'heat'
        : 'auto';
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const modes = (Array.isArray(e.attrs.hvac_modes) ? e.attrs.hvac_modes : []).filter(
    (m): m is string => typeof m === 'string' && m in HVAC_LABEL,
  );

  return (
    <div className="hm-therm">
      <div className={`hm-dial ${tone}`}>
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="trk" cx="60" cy="60" r="52" strokeDasharray={`${ARC} 327`} />
          {target && (
            <circle
              className="val"
              cx="60"
              cy="60"
              r="52"
              strokeDasharray={`${ARC} 327`}
              style={{ strokeDashoffset: ARC * (1 - frac) }}
            />
          )}
        </svg>
        <div className="rd">
          <div>
            {target?.kind === 'range' ? (
              <b
                className="tnum range"
                aria-label={`Set to ${fmt(target.low)} to ${fmt(target.high)} degrees`}
              >
                {fmt(target.low)}–{fmt(target.high)}°
              </b>
            ) : (
              <b className="tnum" aria-live="polite">
                {target ? fmt(target.t) : cur !== null ? fmt(Math.round(cur)) : '–'}°
              </b>
            )}
            <span>{target ? 'set to' : e.state === 'off' ? 'off · now' : 'now'}</span>
          </div>
        </div>
      </div>
      <div className="hm-pm">
        <button aria-label="Cooler" disabled={disabled || !target} onClick={() => nudge(-1)}>
          −
        </button>
        <button aria-label="Warmer" disabled={disabled || !target} onClick={() => nudge(1)}>
          +
        </button>
      </div>
      {modes.length > 1 && (
        <div className="hm-modes" role="radiogroup" aria-label={`${e.name} mode`}>
          {modes.map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={e.state === m}
              disabled={disabled}
              onClick={() =>
                e.state !== m && void call(e, 'set_hvac_mode', { hvac_mode: m }, { state: m })
              }
            >
              {HVAC_LABEL[m]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
