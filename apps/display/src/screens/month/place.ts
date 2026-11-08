/**
 * "Where" on quick add follows the same rules as leave-by places: one line, an address or a
 * pasted coordinate pair. An address copied from Google or Apple Maps arrives on several lines
 * (name, street, town, sometimes "Directions" or a phone number); it is joined with commas.
 */

const NOISE = /^(directions|open in maps|get directions|call|website|share)$/i;
const PHONE = /^\+?[\d\s().-]{7,}$/;

export function tidyPlace(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && !NOISE.test(l) && !PHONE.test(l))
    .join(', ')
    .replace(/,\s*,/g, ',')
    .slice(0, 300);
}

/**
 * True when the server's leave-by maths will try to route to it (see `routableLocation` in the
 * server's commute code): a number or a comma, and not a video call.
 */
export function looksRoutable(place: string): boolean {
  const s = place.trim();
  if (s.length < 6) return false;
  if (/https?:\/\/|www\.|\b(zoom|teams|meet|webex|facetime|online|virtual|tbd|tba)\b/i.test(s))
    return false;
  return /\d/.test(s) || s.includes(',');
}
