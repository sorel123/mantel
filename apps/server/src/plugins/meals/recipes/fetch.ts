/**
 * Fetching a page or a photo someone pasted a link to, carefully: http and https only, every
 * address the name resolves to checked (no loopback, LAN, link-local or other private ranges,
 * on every redirect hop, at connect time so a DNS answer cannot change in between), a timeout
 * and a size cap.
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}

export type PageFetcher = (
  url: string,
  opts?: { accept?: string; maxBytes?: number },
) => Promise<FetchedPage>;

/** Why a link could not be fetched, as a sentence for the person. */
export class FetchError extends Error {}

const ipv4Private = (ip: string): boolean => {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
};

/** Loopback, private, link-local, carrier NAT, multicast, reserved: anything not on the internet. */
export function isPrivateAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return ipv4Private(ip);
  if (v !== 6) return true;
  const s = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return ipv4Private(mapped[1]!);
  if (s === '::' || s === '::1') return true;
  const first = parseInt(s.split(':')[0] || '0', 16);
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xff00) === 0xff00 || // multicast
    s.startsWith('64:ff9b:') || // NAT64 can reach private v4
    s.startsWith('2001:db8:')
  );
}

const blocked = () =>
  new FetchError('That link points inside a private network. Paste a link to a public web page.');

/** A DNS lookup that refuses private answers; used by the socket itself. */
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 4);
    const list = addresses as unknown as LookupAddress[];
    if (list.length === 0 || list.some((a) => isPrivateAddress(a.address)))
      return callback(blocked(), '', 4);
    if ((options as { all?: boolean }).all)
      return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Mantel/1.0';

function once(
  url: URL,
  accept: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<{ status: number; location?: string; contentType: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: 'GET',
        lookup: safeLookup,
        timeout: timeoutMs,
        headers: {
          'user-agent': UA,
          accept,
          'accept-language': 'en;q=0.9, *;q=0.5',
          'accept-encoding': 'gzip, deflate, br',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({
            status,
            location: res.headers.location,
            contentType: '',
            body: Buffer.alloc(0),
          });
        }
        const declared = Number(res.headers['content-length'] ?? 0);
        if (declared > maxBytes) {
          res.destroy();
          return reject(new FetchError('That page is too large to read.'));
        }
        const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
        const stream =
          enc === 'gzip'
            ? res.pipe(zlib.createGunzip())
            : enc === 'deflate'
              ? res.pipe(zlib.createInflate())
              : enc === 'br'
                ? res.pipe(zlib.createBrotliDecompress())
                : res;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy();
            reject(new FetchError('That page is too large to read.'));
            return;
          }
          chunks.push(c);
        });
        stream.on('end', () =>
          resolve({
            status,
            contentType: String(res.headers['content-type'] ?? ''),
            body: Buffer.concat(chunks),
          }),
        );
        stream.on('error', () => reject(new FetchError('That page could not be read.')));
      },
    );
    req.on('timeout', () =>
      req.destroy(new FetchError('That site took too long to answer. Try again.')),
    );
    req.on('error', (err) =>
      reject(
        err instanceof FetchError
          ? err
          : new FetchError(
              'Could not reach that site. Check the link and the internet connection.',
            ),
      ),
    );
    req.end();
  });
}

/** Check a link before any socket opens: scheme, credentials, literal private addresses. */
export function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError('That does not look like a link. Copy it from the address bar.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new FetchError('Only web links (http or https) can be read.');
  if (url.username || url.password) throw new FetchError('Links with a password cannot be read.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isPrivateAddress(host)) throw blocked();
  if (/^(localhost|.*\.local|.*\.internal|.*\.lan|.*\.home\.arpa)$/i.test(host)) throw blocked();
  return url;
}

/** GET a public page or photo, following up to four redirects. */
export const fetchPublic: PageFetcher = async (raw, opts = {}) => {
  const accept = opts.accept ?? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5';
  const maxBytes = opts.maxBytes ?? 4_000_000;
  let url = checkUrl(raw);
  for (let hop = 0; hop < 5; hop++) {
    const res = await once(url, accept, maxBytes, 12_000);
    if (res.location) {
      url = checkUrl(new URL(res.location, url).href);
      continue;
    }
    if (res.status === 403 || res.status === 401)
      throw new FetchError(
        'That site would not let Mantel read the page. Paste the recipe text or a photo of it instead.',
      );
    if (res.status === 404) throw new FetchError('That page was not found. Check the link.');
    if (res.status >= 400)
      throw new FetchError(`That site answered with an error (${res.status}). Try again later.`);
    return { url: url.href, status: res.status, contentType: res.contentType, body: res.body };
  }
  throw new FetchError('That link redirects too many times.');
};
