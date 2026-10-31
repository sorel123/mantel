import { describe, expect, it } from 'vitest';
import { parseHeadlines } from './headlines.js';

describe('news headlines', () => {
  it('reads RSS and Atom titles, skipping the feed title and repeats', () => {
    const rss = `<rss><channel><title>NPR Topics: News</title>
      <item><title><![CDATA[Tesla demos a flying car &amp; promises Mars]]></title></item>
      <item><title>Scientists find a new species of very small frog</title></item>
      <item><title>Scientists find a new species of very small frog</title></item>
      <item><title>Short</title></item>
    </channel></rss>`;
    expect(parseHeadlines(rss)).toEqual([
      'Tesla demos a flying car & promises Mars',
      'Scientists find a new species of very small frog',
    ]);
    const atom = `<feed><title>Feed</title><entry><title type="html">Robot vacuum wins a chess match&#8217;s final</title></entry></feed>`;
    expect(parseHeadlines(atom)).toEqual(['Robot vacuum wins a chess match’s final']);
  });
});
