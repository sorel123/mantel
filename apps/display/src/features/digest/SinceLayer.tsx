import { wallScreenFor } from '@mantel/shared';
import { useEffect, useState } from 'react';
import { registerAmbientSlot } from '../../app/ambient';
import { useNav } from '../../app/nav';
import { useBootstrap } from '../../lib/bootstrap';
import { useSince } from './since';
import { SinceStrip } from './SinceStrip';

const WOKE = 'mantel:ambient-end';

/** Renders nothing on Ambient; when Ambient goes away (someone woke the wall) it says so. */
function AmbientWatch() {
  useEffect(() => () => void window.dispatchEvent(new Event(WOKE)), []);
  return null;
}

/**
 * The wall's "since you last looked" strip, over the bottom of the Today screen. It looks
 * again whenever Today comes back or the wall wakes from Ambient. Tapping a line opens the
 * screen that shows it; the strip clears itself after a while on screen.
 */
export function SinceLayer() {
  const boot = useBootstrap();
  const nav = useNav();
  const on =
    boot.settings.sinceStrip !== false && boot.settings.integrations.digest?.enabled !== false;
  const onToday = nav.current === 'today';
  const [wakes, setWakes] = useState(0);

  useEffect(() => {
    if (!on) return;
    const unregister = registerAmbientSlot({
      id: 'since-watch',
      order: 999,
      Component: AmbientWatch,
    });
    const woke = () => setWakes((n) => n + 1);
    window.addEventListener(WOKE, woke);
    return () => {
      unregister();
      window.removeEventListener(WOKE, woke);
    };
  }, [on]);

  const since = useSince('wall', on, onToday, wakes);
  if (!on || !onToday) return null;
  return (
    <SinceStrip since={since} people={boot.people} onOpen={(link) => nav.go(wallScreenFor(link))} />
  );
}
