/**
 * Settings export and import. The bundle is plain JSON; secrets ride along only when the
 * user types a passphrase, encrypted with a key derived from it (scrypt) under AES-256-GCM.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { SettingsBundle } from '@mantel/shared';

type Blob = NonNullable<SettingsBundle['secrets']>;
type Secrets = Record<string, Record<string, string>>;

const derive = (passphrase: string, salt: Buffer) =>
  scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

export function encryptSecrets(secrets: Secrets, passphrase: string): Blob {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derive(passphrase, salt), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(secrets), 'utf8'), cipher.final()]);
  return {
    cipher: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

/** Throws when the passphrase is wrong (the authentication tag does not match). */
export function decryptSecrets(blob: Blob, passphrase: string): Secrets {
  const key = derive(passphrase, Buffer.from(blob.salt, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const text = Buffer.concat([
    decipher.update(Buffer.from(blob.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(text) as Secrets;
}
