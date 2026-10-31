/**
 * Weather quips: the voice (or off), news jokes, and the Claude key. Lines show under the
 * weather on Today and in Ambient; they change through the day.
 */
import type { IntegrationStatus, PluginManifest, Settings } from '@mantel/shared';
import { Field, Section, Seg, Toggle } from './controls';
import { IntegrationCard } from './Integrations';

type Personality = Settings['weather']['personality'];

const VOICES: Array<[Personality, string]> = [
  ['off', 'Off'],
  ['friendly', 'Friendly'],
  ['snarky', 'Snarky'],
];

/** One line per voice so the choice can be heard before saving. */
const SAMPLE: Record<Personality, string> = {
  off: 'No quip. The weather card shows a plain outlook, like “Rain after 1 pm”.',
  friendly: 'Sun and clouds taking turns. Both are welcome.',
  snarky: 'Partly cloudy, which is weather for people who cannot commit.',
};
const NEWS_SAMPLE =
  'Flying cars are here. Someone strap the CEO in and set the autopilot for Mars. Or the sun. Either is fine.';

export function QuipsSection({
  value,
  onChange,
  plugin,
  status,
  onStatus,
}: {
  value: Settings['weather'];
  onChange: (v: Settings['weather']) => void;
  plugin: PluginManifest | undefined;
  status: IntegrationStatus | undefined;
  onStatus: (s: IntegrationStatus) => void;
}) {
  const hasKey = Boolean(status?.enabled && status.hasSecrets.includes('claudeApiKey'));
  const on = value.personality !== 'off';
  return (
    <Section
      id="quips"
      title="Weather quips"
      hint="A line of weather humour under the weather on Today and on the Ambient screen. It changes through the day."
    >
      <Field label="Personality" hint="Off shows a plain outlook instead.">
        <Seg<Personality>
          label="Quip personality"
          value={value.personality}
          options={VOICES}
          onChange={(personality) => onChange({ ...value, personality })}
        />
      </Field>
      <p className="set-quip-sample" aria-live="polite">
        {SAMPLE[value.personality]}
      </p>
      <Toggle
        label="Jokes about the news"
        hint={
          hasKey ? (
            <>
              In the afternoon the quip riffs on a light story from the day’s headlines (never the
              headline itself, and never sad news). For example: “{NEWS_SAMPLE}”
            </>
          ) : (
            <>Needs a Claude API key: paste one on the card below.</>
          )
        }
        checked={value.newsJokes}
        disabled={!on || (!hasKey && !value.newsJokes)}
        onChange={(newsJokes) => onChange({ ...value, newsJokes })}
      />
      <div className="set-sub wide">
        <div className="set-label">
          Fresh lines from Claude
          <span className="set-hint">
            Without a key, quips come from a built-in library of about 200 lines that fit the sky,
            the temperature, the time of day and the season. With a key, Claude writes a new line
            each morning, afternoon and evening from the forecast and the calendar.
          </span>
        </div>
        {plugin ? (
          <IntegrationCard manifest={plugin} status={status} onStatus={onStatus} />
        ) : (
          <p className="set-hint">The server has not reported the quips integration yet.</p>
        )}
      </div>
    </Section>
  );
}
