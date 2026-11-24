/**
 * Just enough EXIF to caption a photo: when it was taken (DateTimeOriginal, else DateTime).
 * Reads the raw EXIF block sharp hands back (`metadata().exif`, starting `Exif\0\0` then a
 * TIFF header) or a bare TIFF header. GPS is deliberately not read: turning coordinates into
 * a place name would mean sending the family's locations to an outside geocoder.
 */

const TAG_DATETIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;

/** `YYYY-MM-DDTHH:mm` local wall time from EXIF, or null when the photo has no usable date. */
export function exifTakenAt(exif: Uint8Array | undefined | null): string | null {
  if (!exif || exif.length < 14) return null;
  const buf = Buffer.from(exif.buffer, exif.byteOffset, exif.byteLength);
  let base = 0;
  if (buf.toString('latin1', 0, 4) === 'Exif') base = 6;
  const order = buf.toString('latin1', base, base + 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const inBounds = (o: number, n: number) => o >= 0 && o + n <= buf.length;

  /** The tags of one IFD as offset-of-entry by tag. */
  const readIfd = (offset: number): Map<number, number> => {
    const out = new Map<number, number>();
    const at = base + offset;
    if (!inBounds(at, 2)) return out;
    const count = u16(at);
    for (let i = 0; i < count && i < 512; i++) {
      const entry = at + 2 + i * 12;
      if (!inBounds(entry, 12)) break;
      out.set(u16(entry), entry);
    }
    return out;
  };
  const ascii = (entry: number): string | null => {
    const type = u16(entry + 2);
    const count = u32(entry + 4);
    if (type !== 2 || count < 19) return null;
    const at = count <= 4 ? entry + 8 : base + u32(entry + 8);
    if (!inBounds(at, 19)) return null;
    return buf.toString('latin1', at, at + 19);
  };

  try {
    if (!inBounds(base + 4, 4)) return null;
    const ifd0 = readIfd(u32(base + 4));
    let raw: string | null = null;
    const exifPtr = ifd0.get(TAG_EXIF_IFD);
    if (exifPtr !== undefined) {
      const sub = readIfd(u32(exifPtr + 8));
      const original = sub.get(TAG_DATETIME_ORIGINAL);
      if (original !== undefined) raw = ascii(original);
    }
    if (!raw) {
      const dt = ifd0.get(TAG_DATETIME);
      if (dt !== undefined) raw = ascii(dt);
    }
    return raw ? parseExifDate(raw) : null;
  } catch {
    return null;
  }
}

/** `2019:07:04 18:22:05` to `2019-07-04T18:22`; null for blanks and zeros. */
export function parseExifDate(raw: string): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const year = Number(y);
  if (year < 1900 || year > 2200 || Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1) return null;
  return `${y}-${mo}-${d}T${h}:${mi}`;
}
