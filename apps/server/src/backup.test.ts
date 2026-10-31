import { describe, expect, it } from 'vitest';
import { decryptSecrets, encryptSecrets } from './backup.js';

describe('backup secrets', () => {
  it('round-trips with the passphrase and refuses another', () => {
    const secrets = { google: { clientSecret: 'abc' }, homeassistant: { token: 'tok' } };
    const blob = encryptSecrets(secrets, 'correct horse');
    expect(JSON.stringify(blob)).not.toContain('abc');
    expect(decryptSecrets(blob, 'correct horse')).toEqual(secrets);
    expect(() => decryptSecrets(blob, 'wrong')).toThrow();
  });
});
