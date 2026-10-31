import type { ReactNode } from 'react';

/** Small form controls for the settings page, sized for touch (56 px rows). */

export function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="set-sec card">
      <div className="set-sec-head">
        <div>
          <h2 className="h2">{title}</h2>
          {hint && <p className="set-hint">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="set-field">
      <span className="set-label">
        {label}
        {hint && <span className="set-hint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="set-field">
      <span className="set-label">
        {label}
        {hint && <span className="set-hint">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`sw${checked ? ' on' : ''}`}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

export function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="set-seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** A row of pressable chips for picking several items. */
export function Chips<T extends string | number>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; text: string; color?: string }>;
  selected: T[];
  onChange: (v: T[]) => void;
}) {
  const toggle = (v: T) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div className="set-chips" role="group" aria-label={label}>
      {options.length === 0 && <span className="set-hint">None yet</span>}
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={selected.includes(o.value)}
          onClick={() => toggle(o.value)}
          style={o.color ? ({ '--chip': o.color } as React.CSSProperties) : undefined}
        >
          {o.color && <i />}
          {o.text}
        </button>
      ))}
    </div>
  );
}

export function TimeInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <input
      className="set-input tnum"
      type="time"
      aria-label={label}
      value={value}
      // Some browsers emit an empty value mid-edit; keep the last good time.
      onChange={(e) => e.target.value && onChange(e.target.value.slice(0, 5))}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}) {
  return (
    <input
      className="set-input tnum"
      type="number"
      inputMode="decimal"
      aria-label={label}
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(e.target.valueAsNumber)}
    />
  );
}

export function TextInput({
  value,
  onChange,
  label,
  placeholder,
  maxLength,
  list,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
  maxLength?: number;
  list?: string;
}) {
  return (
    <input
      className="set-input"
      type="text"
      aria-label={label}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      list={list}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="set-btn quiet" aria-label={label} onClick={onClick}>
      Remove
    </button>
  );
}

export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
