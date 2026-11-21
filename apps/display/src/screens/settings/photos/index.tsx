/**
 * Settings, Photos (v4 S): where the slideshow's photos come from and how they mix. The four
 * sources (iCloud shared album, Immich, Google Photos, a folder on the server) are ordinary
 * plugin cards; under them, how much of the slideshow each gets, "On this day", captions, and
 * Google Photos picking with a QR code for the phone. Mounted by `../Optional.tsx`.
 */
import {
  DEFAULT_PHOTO_SETTINGS,
  captionText,
  type GooglePickSession,
  type GooglePickStatus,
  type IntegrationStatus,
  type PhotoSettings,
  type PhotoSourceInfo,
  type PhotoWeight,
  type PluginManifest,
  type Settings,
} from '@mantel/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { QrCode } from '../../setup/Qr';
import { errorText } from '../client';
import { CopyRow, Field, Section, Seg, Toggle } from '../controls';
import { IntegrationCard } from '../Integrations';
import '../../../features/photos/photos.css';
import './photos.css';

export const PHOTO_PLUGINS = ['photos', 'immich', 'google-photos', 'photo-folder'];

const WEIGHTS: Array<[PhotoWeight, string]> = [
  ['off', 'Off'],
  ['less', 'Less'],
  ['normal', 'Normal'],
  ['more', 'More'],
];

const STATE_TEXT: Record<PhotoSourceInfo['state'], string> = {
  ready: 'Ready',
  syncing: 'Downloading…',
  not_set_up: 'Not set up',
  error: 'Needs attention',
  disabled: 'Turned off',
};

export function PhotosSection({
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
  const value: PhotoSettings = draft.photos ?? DEFAULT_PHOTO_SETTINGS;
  const change = (patch: Partial<PhotoSettings>) => set('photos', { ...value, ...patch });
  const [sources, setSources] = useState<PhotoSourceInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .call('photoSources')
      .then((r) => {
        setSources(r.sources);
        setError(null);
      })
      .catch((err: unknown) => setError(errorText(err)));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const cards = PHOTO_PLUGINS.map((id) => plugins.find((p) => p.id === id)).filter(
    (p): p is PluginManifest => Boolean(p),
  );
  const ready = sources?.filter((s) => s.count > 0 && s.state !== 'disabled') ?? [];
  const total = ready.reduce((n, s) => n + s.count, 0);
  const otd = ready.reduce((n, s) => n + s.onThisDay, 0);
  const googleConnected = statuses['google-photos']?.state === 'connected';

  return (
    <Section
      id="photos"
      title="Photos"
      hint="Everything the slideshow shows on Ambient and the Photo layout. Connect as many places as you like; Mantel mixes them into one slideshow."
    >
      <div className="ph-set-summary" aria-live="polite">
        {sources === null ? (
          <span className="skeleton ph-set-skel" aria-label="Loading photo sources" />
        ) : total > 0 ? (
          <span>
            <b className="tnum">{total.toLocaleString()}</b> photos from {ready.length} place
            {ready.length === 1 ? '' : 's'}
            {otd > 0 && (
              <>
                {' · '}
                <b className="tnum">{otd}</b> from this day in past years
              </>
            )}
          </span>
        ) : (
          <span>
            No photos yet. Connect one of the places below and they appear within minutes.
          </span>
        )}
      </div>

      <div className="set-int-grid">
        {cards.map((p) => (
          <IntegrationCard
            key={p.id}
            manifest={p}
            status={statuses[p.id]}
            onStatus={(s) => {
              onStatus(s);
              load();
            }}
            open={false}
            extra={
              p.id === 'google-photos' && googleConnected ? (
                <GooglePicker onSaved={load} />
              ) : undefined
            }
          />
        ))}
      </div>

      <h3 className="h3">Slideshow</h3>
      <Toggle
        label="Captions"
        hint="A small line in the photo's corner: album, place and when it was taken."
        checked={value.captions}
        onChange={(captions) => change({ captions })}
      />
      <Toggle
        label="On this day"
        hint="About one photo in three is from today's date in an earlier year, marked “3 years ago today”."
        checked={value.onThisDay}
        onChange={(onThisDay) => change({ onThisDay })}
      />
      <CaptionPreview captions={value.captions} />

      <h3 className="h3">How much of each</h3>
      <p className="set-hint">
        Normal shares the slideshow by how many photos each place has, so a small album still turns
        up. More doubles a place's share and Less halves it. Off leaves it out without disconnecting
        it.
      </p>
      {error && <p className="set-err">{error}</p>}
      {sources === null && (
        <div className="ph-weights">
          {[0, 1, 2].map((i) => (
            <span key={i} className="skeleton ph-weight-skel" />
          ))}
        </div>
      )}
      {sources && (
        <div className="ph-weights">
          {sources.map((s) => (
            <Field
              key={s.id}
              label={s.name}
              hint={
                <span className={`ph-src-state ${s.state}`}>
                  {s.state === 'ready' || s.state === 'syncing'
                    ? `${s.count.toLocaleString()} photo${s.count === 1 ? '' : 's'}${s.onThisDay ? `, ${s.onThisDay} on this day` : ''}${s.state === 'syncing' ? ', downloading…' : ''}`
                    : (s.error ?? STATE_TEXT[s.state])}
                </span>
              }
            >
              <Seg
                label={`How much of ${s.name}`}
                value={value.weights[s.id] ?? 'normal'}
                options={WEIGHTS}
                onChange={(w) => change({ weights: { ...value.weights, [s.id]: w } })}
              />
            </Field>
          ))}
        </div>
      )}
    </Section>
  );
}

/** What a caption looks like, on a sample, so the toggle is not a mystery. */
function CaptionPreview({ captions }: { captions: boolean }) {
  const year = new Date().getFullYear();
  const sample = captionText({
    source: 'Immich',
    album: 'Summer at the lake',
    place: 'Traverse City, Michigan',
    takenAt: `${year - 3}-07-04`,
    yearsAgo: 3,
  });
  return (
    <div className={`ph-preview${captions ? '' : ' off'}`} aria-hidden="true">
      <div className="ph-preview-photo">
        <div className="ph-caption otd">
          <span className="ph-otd-dot" />
          <span className="ph-caption-text">{sample}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Pick photos from Google Photos: start a session, show its link as a QR code for the phone,
 * and watch it until the person taps Done and Mantel has saved what they picked.
 */
export function GooglePicker({ onSaved }: { onSaved: () => void }) {
  const [session, setSession] = useState<GooglePickSession | null>(null);
  const [status, setStatus] = useState<GooglePickStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const poll = useCallback(
    (id: string) => {
      api
        .call('googlePhotosPickStatus', { params: { id } })
        .then((s) => {
          setStatus(s);
          if (s.state === 'waiting' || s.state === 'saving')
            timer.current = setTimeout(() => poll(id), s.state === 'saving' ? 1500 : 3000);
          else onSaved();
        })
        .catch((err: unknown) => setError(errorText(err)));
    },
    [onSaved],
  );

  const start = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const s = await api.call('googlePhotosPick');
      setSession(s);
      setStatus({ state: 'waiting', saved: 0 });
      timer.current = setTimeout(() => poll(s.id), 3000);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      const r = await api.call('googlePhotosClear');
      setStatus({ state: 'done', saved: 0, message: `Removed ${r.removed} photos from the wall.` });
      setSession(null);
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const waiting = status?.state === 'waiting' && session;
  const link = session ? `${session.pickerUri.replace(/\/$/, '')}/autoclose` : '';
  return (
    <div className="ph-pick">
      {waiting ? (
        <div className="set-help-top ph-pick-open">
          <div className="set-help-qr">
            <QrCode text={link} size={148} label="QR code for the Google Photos picker" />
            <span className="set-hint">Scan on your phone</span>
          </div>
          <div className="grow">
            <p>
              <b>Choose photos or whole albums in Google Photos, then tap Done.</b> This page saves
              them as soon as you finish.
            </p>
            <CopyRow label="Or open this link" value={link} />
            <p className="set-hint ph-pulse">Waiting for you to pick…</p>
          </div>
        </div>
      ) : (
        <div className="set-pair">
          <button type="button" className="set-btn primary" disabled={busy} onClick={start}>
            {busy ? 'Opening…' : 'Pick photos'}
          </button>
          <button type="button" className="set-btn quiet" disabled={busy} onClick={clear}>
            Remove picked photos
          </button>
        </div>
      )}
      {status?.state === 'saving' && (
        <p className="set-hint" aria-live="polite">
          Saving… {status.saved} so far.
        </p>
      )}
      {status && status.state !== 'waiting' && status.state !== 'saving' && status.message && (
        <p className={status.state === 'done' ? 'ph-ok' : 'set-err'} aria-live="polite">
          {status.message}
        </p>
      )}
      {error && <p className="set-err">{error}</p>}
    </div>
  );
}
