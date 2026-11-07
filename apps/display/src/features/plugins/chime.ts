/**
 * A soft two-note chime with Web Audio, repeated while a banner that asked for it is up. Browsers
 * only play sound after someone has touched the page; a wall display has been, and if not the
 * banner still shows.
 */
let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let stopAt = 0;

const REPEAT_MS = 2600;
/** Nobody around: stop chiming after this long, the banner stays. */
const MAX_MS = 2 * 60_000;

function ring() {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
    const t0 = ctx.currentTime;
    for (const [i, freq] of [880, 660].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = t0 + i * 0.32;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1);
    }
  } catch {
    // No audio here; the banner is enough.
  }
}

export function startChime() {
  stopAt = Date.now() + MAX_MS;
  if (timer) return;
  ring();
  timer = setInterval(() => {
    if (Date.now() > stopAt) stopChime();
    else ring();
  }, REPEAT_MS);
}

export function stopChime() {
  clearInterval(timer);
  timer = undefined;
}
