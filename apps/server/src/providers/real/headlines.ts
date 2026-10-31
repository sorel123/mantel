/**
 * The day's headlines, for quips that riff on the news. Any RSS or Atom feed works; the
 * default is NPR's top stories. Only titles are read, and only to inspire a joke: the wall
 * never shows a headline.
 */
export const DEFAULT_NEWS_FEED = 'https://feeds.npr.org/1001/rss.xml';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  mdash: '—',
  ndash: '–',
  hellip: '…',
};

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Item (RSS) or entry (Atom) titles, in feed order, without the feed's own title. */
export function parseHeadlines(xml: string, max = 15): string[] {
  const out: string[] = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const block of blocks) {
    const m = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const title = m ? decode(m[1]!) : '';
    if (title.length >= 12 && title.length <= 200 && !out.includes(title)) out.push(title);
    if (out.length >= max) break;
  }
  return out;
}

export async function fetchHeadlines(
  url: string,
  doFetch: typeof fetch = (...a) => fetch(...a),
): Promise<string[]> {
  const res = await doFetch(url, {
    headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`news feed answered ${res.status}`);
  return parseHeadlines(await res.text());
}
