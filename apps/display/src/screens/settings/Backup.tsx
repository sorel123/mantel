import { SettingsBundle } from '@mantel/shared';
import { useState } from 'react';
import { api } from '../../lib/api';
import { errorText } from './client';
import { Field, Result, Section, TextInput } from './controls';

/**
 * Backup: one file with settings, integration config and (with a passphrase) the sign-ins, so
 * moving from a Surface to a server or rebuilding after a wipe is a two-minute job.
 */
export function BackupSection() {
  const [passphrase, setPassphrase] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const download = async () => {
    setBusy(true);
    setResult(null);
    try {
      const bundle = await api.call('settingsExport', {
        body: passphrase ? { passphrase } : undefined,
      });
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `mantel-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      setResult({
        ok: true,
        message: passphrase
          ? 'Backup downloaded with the sign-ins locked by the passphrase. Keep both.'
          : 'Backup downloaded without sign-ins. Add a passphrase to include them.',
      });
    } catch (err) {
      setResult({ ok: false, message: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const parsed = SettingsBundle.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new SyntaxError('not a bundle');
      const res = await api.call('settingsImport', {
        body: { bundle: parsed.data, ...(passphrase ? { passphrase } : {}) },
      });
      setResult({
        ok: true,
        message: `Restored. ${res.secretsRestored.length ? `Sign-ins restored for ${res.secretsRestored.join(', ')}.` : 'No sign-ins were in the file.'} Displays reload with the new settings.`,
      });
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof SyntaxError ? 'That file is not a Mantel backup.' : errorText(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      id="backup"
      title="Backup and restore"
      hint="Everything in one file: settings, integrations and, with a passphrase, the sign-ins. Lists and chores stay in the database file."
    >
      <Field
        label="Passphrase"
        hint="Locks the sign-ins inside a backup, and opens them again. Optional."
      >
        <TextInput
          label="Backup passphrase"
          type="password"
          value={passphrase}
          onChange={setPassphrase}
          placeholder="At least 8 characters"
        />
      </Field>
      <div className="set-field">
        <span className="set-label">
          Download a backup
          <span className="set-hint">A .json file you can keep anywhere.</span>
        </span>
        <button
          type="button"
          className="set-btn"
          disabled={busy || (passphrase.length > 0 && passphrase.length < 8)}
          onClick={() => void download()}
        >
          Download
        </button>
      </div>
      <div className="set-field">
        <span className="set-label">
          Restore from a backup
          <span className="set-hint">Replaces the settings on this server with the file’s.</span>
        </span>
        <span className="set-pair">
          <label className="set-btn">
            {file ? file.name : 'Choose file'}
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            type="button"
            className="set-btn danger"
            disabled={busy || !file}
            onClick={() => void restore()}
          >
            Restore
          </button>
        </span>
      </div>
      <Result result={result} />
    </Section>
  );
}
