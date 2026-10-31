import { useCallback, useEffect, useMemo, useState } from 'react';
import { calendarSetupState, errorText, saveCalendarPrefs, syncCalendars } from './client';
import type { IntegrationStatus, PluginManifest } from '@mantel/shared';
import type { CalendarPrefs, CalendarSetupState } from './contract';
import { Chips, Result, Section, TextInput } from './controls';
import { IntegrationCard } from './Integrations';

const SOURCE_LABEL: Record<string, string> = {
  google: 'Google',
  icloud: 'iCloud',
  ical: 'Calendar link',
};

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString([], {
        hour: 'numeric',
        minute: '2-digit',
        month: 'short',
        day: 'numeric',
      })
    : 'never';

/**
 * Calendars: the Google and iCloud cards (from their plugin manifests) and the picker that used to
 * live on `/api/calendar/setup`: which calendars show, their name and colour, whose they are, which
 * one is the meal plan and where quick add writes.
 */
export function CalendarsSection({
  plugins,
  statuses,
  onStatus,
  wizard = false,
}: {
  plugins: PluginManifest[];
  statuses: Record<string, IntegrationStatus>;
  onStatus: (s: IntegrationStatus) => void;
  wizard?: boolean;
}) {
  const [state, setState] = useState<CalendarSetupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<CalendarPrefs>({ calendars: {} });
  const [busy, setBusy] = useState<'save' | 'sync' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const fromState = (s: CalendarSetupState): CalendarPrefs => ({
    calendars: Object.fromEntries(
      s.calendars.map((c) => [
        c.id,
        {
          enabled: c.enabled,
          name: c.name,
          color: c.color,
          personIds: c.personIds,
          isMeals: c.isMeals,
        },
      ]),
    ),
    ...(s.defaultCalendarId ? { defaultCalendarId: s.defaultCalendarId } : {}),
  });

  const load = useCallback(() => {
    calendarSetupState()
      .then((s) => {
        setState(s);
        setPrefs(fromState(s));
        setError(null);
      })
      .catch((err: unknown) => setError(errorText(err)));
  }, []);
  useEffect(load, [load]);

  // After a Google sign-in the server sends the browser back here with ?google=connected.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const g = q.get('google');
    if (!g) return;
    setResult(
      g === 'connected'
        ? { ok: true, message: 'Google is connected. Your calendars are listed below.' }
        : { ok: false, message: q.get('message') || 'The Google sign-in did not finish.' },
    );
    q.delete('google');
    q.delete('message');
    history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}${location.hash}`);
  }, []);

  const dirty = useMemo(
    () => state && JSON.stringify(prefs) !== JSON.stringify(fromState(state)),
    [prefs, state],
  );

  const save = async () => {
    setBusy('save');
    setResult(null);
    try {
      const s = await saveCalendarPrefs(prefs);
      setState(s);
      setPrefs(fromState(s));
      setResult({ ok: true, message: 'Saved. The wall updates in a moment.' });
    } catch (err) {
      setResult({ ok: false, message: errorText(err) });
    } finally {
      setBusy(null);
    }
  };
  const sync = async () => {
    setBusy('sync');
    setResult(null);
    try {
      const s = await syncCalendars();
      setState(s);
      setPrefs(fromState(s));
      setResult({
        ok: true,
        message: `Synced. ${s.calendars.length} calendar${s.calendars.length === 1 ? '' : 's'} found.`,
      });
    } catch (err) {
      setResult({ ok: false, message: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  // The Google card needs the redirect URI and account; WS2's state has them until A's status does.
  const withGoogle = (status: IntegrationStatus | undefined): IntegrationStatus | undefined => {
    if (!status || !state) return status;
    const g = state.google;
    return {
      ...status,
      config: {
        redirectUri: g.redirectUri,
        pasteBack: g.pasteBack,
        account: g.account,
        ...status.config,
      },
      summary:
        status.summary ||
        (g.connected ? `Signed in as ${g.account} · synced ${when(g.lastSync)}` : status.summary),
    };
  };

  const sources = plugins.filter((p) => p.category === 'calendar');
  const people = state?.people ?? [];
  const cals = state?.calendars ?? [];
  const set = (id: string, patch: Partial<CalendarPrefs['calendars'][string]>) =>
    setPrefs((p) => ({
      ...p,
      calendars: { ...p.calendars, [id]: { ...p.calendars[id], ...patch } },
    }));

  return (
    <Section
      id="calendars"
      title="Calendars"
      hint={
        wizard
          ? 'Connect at least one account. You can add the other later.'
          : 'Connect Google, iCloud or a calendar link, then choose what shows on the wall and whose it is.'
      }
      action={
        !wizard && state ? (
          <button
            type="button"
            className="set-btn"
            disabled={busy !== null}
            onClick={() => void sync()}
          >
            {busy === 'sync' ? 'Syncing…' : 'Sync now'}
          </button>
        ) : undefined
      }
    >
      {error && <p className="set-err">{error}</p>}
      <div className="set-int-grid">
        {sources.map((p) => (
          <IntegrationCard
            key={p.id}
            manifest={p}
            status={p.id === 'google' ? withGoogle(statuses[p.id]) : statuses[p.id]}
            onStatus={(s) => {
              onStatus(s);
              // A sign-in or new credentials change what the picker shows.
              setTimeout(load, 500);
            }}
          />
        ))}
        {sources.length === 0 && (
          <p className="set-hint">No calendar sources reported by the server.</p>
        )}
      </div>

      <div className="set-sub wide">
        <div className="set-label">
          On the wall
          <span className="set-hint">
            Tick the calendars to show. People: whose events they are (an event naming someone, like
            “Leo soccer”, narrows to that person). The meal plan reads from the calendar marked
            Meals. Quick add writes to the default calendar. Tag an event with ⭐ or #countdown to
            count down to it.
          </span>
        </div>
        {state && cals.length === 0 && (
          <p className="set-hint">
            No calendars yet. Paste a calendar link or connect Google or iCloud above, then Sync
            now.
          </p>
        )}
        {cals.length > 0 && (
          <div className="set-table" role="table" aria-label="Calendars on the wall">
            <div className="set-tr head" role="row">
              <span role="columnheader">Show</span>
              <span role="columnheader">Name</span>
              <span role="columnheader">Colour</span>
              <span role="columnheader">People</span>
              <span role="columnheader">Meals</span>
              <span role="columnheader">Default</span>
            </div>
            {cals.map((c) => {
              const p = prefs.calendars[c.id] ?? {};
              return (
                <div className="set-tr" role="row" key={c.id}>
                  <span role="cell">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={p.enabled ?? c.enabled}
                      aria-label={`Show ${c.name}`}
                      className={`sw${(p.enabled ?? c.enabled) ? ' on' : ''}`}
                      onClick={() => set(c.id, { enabled: !(p.enabled ?? c.enabled) })}
                    />
                  </span>
                  <span role="cell" className="set-td-name">
                    <TextInput
                      label={`${c.sourceName} name on the wall`}
                      value={p.name ?? c.name}
                      placeholder={c.sourceName}
                      onChange={(name) => set(c.id, { name })}
                    />
                    <span className="set-hint">
                      {SOURCE_LABEL[c.source]}
                      {c.readOnly ? ' · read-only' : ''}
                      {c.primary ? ' · primary' : ''}
                    </span>
                  </span>
                  <span role="cell">
                    <input
                      className="set-color"
                      type="color"
                      aria-label={`${c.name} colour`}
                      value={
                        /^#[0-9a-f]{6}$/i.test(p.color ?? c.color)
                          ? (p.color ?? c.color)
                          : '#246b5b'
                      }
                      onChange={(e) => set(c.id, { color: e.target.value })}
                    />
                  </span>
                  <span role="cell">
                    <Chips
                      label={`${c.name} people`}
                      options={people.map((x) => ({ value: x.id, text: x.name, color: x.color }))}
                      selected={p.personIds ?? c.personIds}
                      onChange={(personIds) => set(c.id, { personIds })}
                    />
                  </span>
                  <span role="cell">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={p.isMeals ?? c.isMeals}
                      aria-label={`${c.name} is the meal plan`}
                      className={`sw${(p.isMeals ?? c.isMeals) ? ' on' : ''}`}
                      onClick={() => set(c.id, { isMeals: !(p.isMeals ?? c.isMeals) })}
                    />
                  </span>
                  <span role="cell">
                    <input
                      type="radio"
                      name="default-calendar"
                      className="set-radio"
                      aria-label={`Quick add writes to ${c.name}`}
                      disabled={c.readOnly}
                      checked={prefs.defaultCalendarId === c.id}
                      onChange={() => setPrefs((x) => ({ ...x, defaultCalendarId: c.id }))}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {cals.length > 0 && (
          <div className="set-int-actions">
            <button
              type="button"
              className="set-btn primary"
              disabled={!dirty || busy !== null}
              onClick={() => void save()}
            >
              {busy === 'save' ? 'Saving…' : 'Save calendar choices'}
            </button>
            {state && (
              <span className="set-hint">
                {[
                  state.google.configured && `Google synced ${when(state.google.lastSync)}`,
                  state.icloud.configured && `iCloud synced ${when(state.icloud.lastSync)}`,
                  state.ical?.configured && `Links synced ${when(state.ical.lastSync)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </div>
        )}
        <Result result={result} />
      </div>
    </Section>
  );
}
