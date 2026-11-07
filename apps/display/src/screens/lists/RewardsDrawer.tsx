import { ApiRequestError, type Person, type Reward, type StarLedgerEntry } from '@mantel/shared';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { SheetHeader, useOverlay } from '../../app/overlay';
import { api } from '../../lib/api';
import { Avatar } from './Avatar';
import type { CelebrateApi } from './celebrate';
import { Star } from './ChoreChart';
import { rewardsFor, useRewards, useStars } from './data';
import { ChoreIconSvg } from './icons';

/** The PIN box inside the confirm dialog. Reports every keystroke to the caller. */
function PinField({ onChange }: { onChange: (pin: string) => void }) {
  return (
    <span className="pinfield">
      <span>A grown-up enters the admin PIN to approve.</span>
      <input
        className="input tnum"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]*"
        maxLength={8}
        aria-label="Admin PIN"
        placeholder="PIN"
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      />
    </span>
  );
}

const errorText = (err: unknown) =>
  err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : String(err);

/**
 * The Rewards drawer, opened from a star total: everyone's banked stars, the rewards with their
 * costs, and the last few entries for the chosen person. Redeeming asks for the admin PIN; the
 * server debits the bank and the wall celebrates.
 */
export function RewardsDrawer({
  people,
  initialPersonId,
  celebrate,
  close,
}: {
  /** People with chores or stars, in order. */
  people: Person[];
  initialPersonId?: string;
  celebrate: CelebrateApi;
  close: () => void;
}) {
  const overlay = useOverlay();
  const { balances, put } = useStars();
  const { rewards } = useRewards();
  const [personId, setPersonId] = useState(initialPersonId ?? people[0]?.id ?? '');
  const [recent, setRecent] = useState<StarLedgerEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const pin = useRef('');
  const person = people.find((p) => p.id === personId);
  const balance = balances?.find((b) => b.personId === personId);
  const have = balance?.stars ?? 0;

  useEffect(() => {
    if (!personId) return;
    let live = true;
    api
      .call('starsLedger', { query: { personId, limit: 5 } })
      .then((r) => live && setRecent(r.entries))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [personId, have]);

  const redeem = async (reward: Reward) => {
    if (!person || busy) return;
    pin.current = '';
    const ok = await overlay.confirm({
      title: `${reward.title} for ${person.name}?`,
      body: (
        <>
          <span className="pinline">
            Spends <b className="tnum">{reward.cost}</b> of {person.name}&rsquo;s{' '}
            <b className="tnum">{have}</b> stars.
          </span>
          <PinField onChange={(v) => (pin.current = v)} />
        </>
      ),
      confirmLabel: 'Redeem',
    });
    if (!ok) return;
    if (!/^\d{4,8}$/.test(pin.current)) {
      overlay.toast('Enter the admin PIN (4 to 8 digits) to redeem');
      return;
    }
    setBusy(true);
    try {
      const res = await api.call('rewardRedeem', {
        params: { id: reward.id },
        body: { personId: person.id, pin: pin.current },
      });
      put(res.balance);
      close();
      celebrate.banner(`${person.name} got ${reward.title}!`, person.id);
    } catch (err) {
      overlay.toast(errorText(err));
    } finally {
      pin.current = '';
      setBusy(false);
    }
  };

  const mine = rewards ? rewardsFor(rewards, personId) : null;

  return (
    <div className="rewards" data-no-swipe>
      <SheetHeader
        title={
          <span className="rw-total">
            <Star />
            <span className="tnum">{have}</span>
          </span>
        }
        subtitle={person ? `${person.name}'s stars` : 'Rewards'}
        onClose={close}
      />
      <div className="rw-people" role="group" aria-label="Whose stars">
        {people.map((p) => {
          const b = balances?.find((x) => x.personId === p.id)?.stars ?? 0;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={p.id === personId}
              onClick={() => setPersonId(p.id)}
              style={{ '--pc': p.color } as CSSProperties}
            >
              <Avatar person={p} />
              <span>{p.name}</span>
              <b className="tnum">
                <Star />
                {b}
              </b>
            </button>
          );
        })}
      </div>
      {balance && (
        <p className="rw-week">
          <span className="tnum">{balance.week}</span> earned this week
        </p>
      )}
      <h3 className="eyebrow">Rewards</h3>
      {mine === null ? (
        <p className="rw-none">Loading rewards</p>
      ) : mine.length === 0 ? (
        <p className="rw-none">
          No rewards yet. A grown-up adds them in Settings, under Chores and rewards.
        </p>
      ) : (
        <ul className="rw-list">
          {mine.map((r) => {
            const short = r.cost - have;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  className={`rw-item${short > 0 ? ' short' : ''}`}
                  disabled={busy}
                  aria-label={`${r.title}, ${r.cost} stars${short > 0 ? `, ${short} more needed` : ''}`}
                  onClick={() =>
                    short > 0
                      ? overlay.toast(`${short} more ${short === 1 ? 'star' : 'stars'} to go`)
                      : void redeem(r)
                  }
                >
                  <ChoreIconSvg icon={r.icon} className="rw-icon" />
                  <span className="rw-title">
                    {r.title}
                    <small>{short > 0 ? `${short} more to go` : 'Tap to redeem'}</small>
                  </span>
                  <span className="rw-cost tnum">
                    <Star />
                    {r.cost}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {recent.length > 0 && (
        <>
          <h3 className="eyebrow">Lately</h3>
          <ul className="rw-recent">
            {recent.map((e) => (
              <li key={e.id}>
                <span>{e.note ?? e.reason}</span>
                <b className={`tnum ${e.delta < 0 ? 'neg' : 'pos'}`}>
                  {e.delta > 0 ? `+${e.delta}` : e.delta}
                </b>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
