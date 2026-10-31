import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** Small form controls for the settings page, sized for touch (56 px rows). */

export function Section({
  title,
  hint,
  action,
  id,
  children,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section className="set-sec card" id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="set-sec-head">
        <div>
          <h2 className="h2" id={id ? `${id}-title` : undefined}>
            {title}
          </h2>
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
  stack,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  /** Put the control under the label (for wide inputs) instead of beside it. */
  stack?: boolean;
}) {
  return (
    <label className={`set-field${stack ? ' stack' : ''}`}>
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
  disabled,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
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
        disabled={disabled}
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

/**
 * A number field that is safe to type into: while the text is not yet a number ("-", "42.",
 * "") nothing is sent up, so a half-typed negative longitude never lands as NaN in the draft.
 * The field keeps what was typed until it loses focus, then shows the stored value again.
 */
export function NumberInput({
  value,
  onChange,
  label,
  onPasteText,
}: {
  value: number;
  onChange: (v: number) => void;
  /** Kept for callers; a free-text field does not clamp while typing, the schema check does. */
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  /** Return true to take over a paste (for example "lat, lng" into the latitude field). */
  onPasteText?: (text: string) => boolean;
}) {
  const shown = Number.isFinite(value) ? String(value) : '';
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  const display = editing ? text : shown;
  return (
    <input
      className="set-input tnum"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-label={label}
      value={display}
      onFocus={() => {
        setText(shown);
        setEditing(true);
      }}
      onBlur={() => setEditing(false)}
      onPaste={(e) => {
        if (onPasteText?.(e.clipboardData.getData('text'))) {
          e.preventDefault();
          setEditing(false);
        }
      }}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const n = Number(next.trim().replace(/,$/, ''));
        if (next.trim() !== '' && Number.isFinite(n)) onChange(n);
      }}
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
  type = 'text',
  onPasteText,
  onKeyDown,
  autoFocus,
  className,
  disabled,
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
  maxLength?: number;
  list?: string;
  type?: 'text' | 'password' | 'url' | 'email';
  /** Return true to take over a paste. */
  onPasteText?: (text: string) => boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  className?: string;
  disabled?: boolean;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'url' | 'email';
}) {
  return (
    <input
      className={`set-input${className ? ` ${className}` : ''}`}
      type={type}
      aria-label={label}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      list={list}
      autoFocus={autoFocus}
      disabled={disabled}
      inputMode={inputMode}
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      onKeyDown={onKeyDown}
      onPaste={(e) => {
        if (onPasteText?.(e.clipboardData.getData('text'))) e.preventDefault();
      }}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * A secret (token, password, client secret). The stored value never comes back from the server;
 * the field shows "Set" with a Replace button, or an input when nothing is stored yet.
 */
export function SecretInput({
  label,
  isSet,
  value,
  onChange,
  placeholder,
  onPasteText,
}: {
  label: string;
  /** The server has a value for this secret. */
  isSet: boolean;
  /** The new value being typed (empty when untouched). */
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onPasteText?: (text: string) => boolean;
}) {
  const [replacing, setReplacing] = useState(false);
  const [show, setShow] = useState(false);
  if (isSet && !replacing && !value)
    return (
      <span className="set-pair">
        <span className="set-badge good">Set</span>
        <span className="set-secret-dots" aria-hidden="true">
          ••••••••••
        </span>
        <button type="button" className="set-btn quiet" onClick={() => setReplacing(true)}>
          Replace
        </button>
      </span>
    );
  return (
    <span className="set-pair grow">
      <TextInput
        label={label}
        type={show ? 'text' : 'password'}
        value={value}
        placeholder={placeholder ?? 'Paste it here'}
        onChange={onChange}
        onPasteText={onPasteText}
        className="grow"
      />
      <button
        type="button"
        className="set-btn quiet"
        aria-label={show ? `Hide ${label}` : `Show ${label}`}
        onClick={() => setShow((s) => !s)}
      >
        {show ? 'Hide' : 'Show'}
      </button>
      {isSet && (
        <button
          type="button"
          className="set-btn quiet"
          onClick={() => {
            setReplacing(false);
            onChange('');
          }}
        >
          Keep current
        </button>
      )}
    </span>
  );
}

/** Copies `text` to the clipboard and says so for a moment. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1800);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className="set-btn sm"
      aria-label={`${label}: ${text}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // Clipboard needs a secure context; fall back to a selection the user can copy.
          const range = document.createRange();
          const span = document.createElement('span');
          span.textContent = text;
          document.body.append(span);
          range.selectNodeContents(span);
          getSelection()?.removeAllRanges();
          getSelection()?.addRange(range);
          document.execCommand?.('copy');
          span.remove();
        }
        setDone(true);
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

/** A value to paste somewhere else, with its Copy button. */
export function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="set-copy">
      <span className="set-hint">{label}</span>
      <code className="set-code-inline">{value}</code>
      <CopyButton text={value} />
    </div>
  );
}

/** "Get it here" link to the exact page a value comes from. Opens in a new tab. */
export function GetItHere({ label, url }: { label: string; url: string }) {
  return (
    <a className="set-link" href={url} target="_blank" rel="noopener noreferrer">
      {label}
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
      </svg>
    </a>
  );
}

/** A state pill: Connected, Not set up, Problem, Off. */
export function StatusBadge({
  state,
  text,
}: {
  state: 'connected' | 'not_set_up' | 'error' | 'disabled' | 'pending';
  text?: string;
}) {
  const labels = {
    connected: 'Connected',
    not_set_up: 'Not set up',
    error: 'Problem',
    disabled: 'Off',
    pending: 'Checking',
  };
  return <span className={`set-badge state-${state}`}>{text ?? labels[state]}</span>;
}

/** Numbered directions in a side panel beside the fields. */
export function Directions({
  title = 'How to get it',
  steps,
}: {
  title?: string;
  steps: Array<{ text: ReactNode; url?: string }>;
}) {
  return (
    <aside className="set-directions">
      <div className="eyebrow">{title}</div>
      <ol>
        {steps.map((s, i) => (
          <li key={i}>
            {s.text}
            {s.url && (
              <>
                {' '}
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  Open
                </a>
              </>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}

/** A collapsed group: Advanced, or the long walkthroughs in Help. */
export function Collapse({
  title,
  hint,
  children,
  open: initial = false,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  open?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  const id = useId();
  return (
    <div className={`set-collapse${open ? ' open' : ''}`}>
      <button
        type="button"
        className="set-collapse-head"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="set-label">
          {title}
          {hint && <span className="set-hint">{hint}</span>}
        </span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div id={id} className="set-collapse-body">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Type-to-search over a long list (timezones). A plain input with a filtered list under it, so
 * it works with a keyboard, a finger and a screen reader without a dropdown of 400 entries.
 */
export function Combobox({
  label,
  value,
  options,
  onChange,
  placeholder,
  format = (v) => v,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
  format?: (v: string) => string;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setText(value), [value]);

  const q = text.trim().toLowerCase().replace(/\s+/g, '_');
  const matches = (
    q
      ? options.filter((o) => o.toLowerCase().includes(q) || format(o).toLowerCase().includes(q))
      : options
  ).slice(0, 8);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setText(v);
    setOpen(false);
  };

  return (
    <div className="set-combo" ref={box}>
      <input
        className="set-input"
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => {
          // Keep an exact match typed by hand.
          if (options.includes(text)) onChange(text);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, matches.length - 1));
            setOpen(true);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open && matches[active]) {
            e.preventDefault();
            pick(matches[active]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && matches.length > 0 && (
        <ul className="set-combo-list" role="listbox" id={listId}>
          {matches.map((m, i) => (
            <li
              key={m}
              role="option"
              aria-selected={i === active}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(m)}
            >
              {format(m)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="set-btn quiet" aria-label={label} onClick={onClick}>
      Remove
    </button>
  );
}

/** A short result line after a Test or Save: one sentence, green or amber. */
export function Result({ result }: { result: { ok: boolean; message: string } | null }) {
  if (!result) return null;
  return (
    <p className={`set-result ${result.ok ? 'ok' : 'bad'}`} role="status">
      {result.message}
    </p>
  );
}

export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
