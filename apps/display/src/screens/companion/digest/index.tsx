/**
 * The companion's digest page (v4 D), opened by the morning notification (`/app#digest/morning:sam`)
 * or the sun button at the top: the person's day, with Today and Tomorrow, and a person switch.
 */
import type { Digest, DigestKind, Person } from '@mantel/shared';
import { useEffect, useState } from 'react';
import { DigestSkeleton, DigestView } from '../../../features/digest';
import { api } from '../../../lib/api';
import { useServerEvent } from '../../../lib/events';
import { PersonChips } from '../ListsTab';
import './digest-page.css';

export { focusDeep, useDeepFocus } from './deep';

/** `morning:sam` → kind and person. */
export function parseDigestId(id: string | undefined): { kind: DigestKind; personId?: string } {
  const [k, p] = (id ?? '').split(':');
  return { kind: k === 'evening' ? 'evening' : 'morning', ...(p ? { personId: p } : {}) };
}

export function DigestPage({ id, people }: { id?: string; people: Person[] }) {
  const initial = parseDigestId(id);
  const [kind, setKind] = useState<DigestKind>(initial.kind);
  const [personId, setPersonId] = useState<string | undefined>(initial.personId);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Follow a new notification while the page is open.
  useEffect(() => {
    const next = parseDigestId(id);
    setKind(next.kind);
    if (next.personId) setPersonId(next.personId);
  }, [id]);

  useEffect(() => {
    let live = true;
    setError(null);
    api
      .call('digest', { query: { kind, ...(personId ? { personId } : {}) } })
      .then((r) => {
        if (!live) return;
        setDigest(r.digest);
        if (!personId && r.digest.personId) setPersonId(r.digest.personId);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [kind, personId, tick]);

  const refresh = () => setTick((t) => t + 1);
  useServerEvent('chores.changed', refresh);
  useServerEvent('calendar.changed', refresh);

  return (
    <div className="cdigest">
      <div className="arow cdigest-bar">
        <div className="seg" role="group" aria-label="Which day">
          {(['morning', 'evening'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              className="btn"
              onClick={() => setKind(k)}
            >
              {k === 'morning' ? 'Today' : 'Tomorrow'}
            </button>
          ))}
        </div>
      </div>
      {people.length > 1 && (
        <PersonChips
          people={people}
          value={personId}
          onChange={(p) => setPersonId(p)}
          allowNone={false}
        />
      )}
      {error && !digest ? (
        <section className="card apanel">
          <h2 className="h2">Can't load your day</h2>
          <p className="amuted">{error}</p>
          <button type="button" className="abtn" onClick={refresh}>
            Try again
          </button>
        </section>
      ) : digest && digest.kind === kind && (!personId || digest.personId === personId) ? (
        <DigestView digest={digest} people={people} />
      ) : (
        <DigestSkeleton />
      )}
    </div>
  );
}
