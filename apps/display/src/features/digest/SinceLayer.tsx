import { wallScreenFor } from '@mantel/shared';
import { useNav } from '../../app/nav';
import { useBootstrap } from '../../lib/bootstrap';
import { useSince } from './since';
import { SinceStrip } from './SinceStrip';

/**
 * The wall's "since you last looked" strip, over the bottom of the Today screen. Tapping a line
 * opens the screen that shows it; the strip clears itself after a while on screen.
 */
export function SinceLayer() {
  const boot = useBootstrap();
  const nav = useNav();
  const on =
    boot.settings.sinceStrip !== false && boot.settings.integrations.digest?.enabled !== false;
  const since = useSince('wall', on);
  if (!on || nav.current !== 'today') return null;
  return (
    <SinceStrip since={since} people={boot.people} onOpen={(link) => nav.go(wallScreenFor(link))} />
  );
}
