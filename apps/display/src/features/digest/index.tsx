/**
 * v4 D on the display: the "since you last looked" strip (the wall's `SinceLayer`, mounted by
 * the shell's feature layers, and `SinceStrip` for the phone), and `DigestView`, which the
 * phone's digest page and the Settings preview draw a digest with. The wall card and the Ambient
 * line come from the digest plugin's blocks, so they need no code here.
 */
export { DigestSkeleton, DigestView, clockOf, sinceLabel } from './DigestView';
export { SinceLayer } from './SinceLayer';
export { SinceStrip, SINCE_AUTO_CLEAR_MS } from './SinceStrip';
export { readMark, useSince, writeMark, type Since } from './since';
