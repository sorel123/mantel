/**
 * v4 K: the capture inbox on the display. `InboxLayer` (mounted by the shell's feature layers)
 * makes the inbox chip in the dock open the review pop-over. The review itself (`InboxReview`)
 * and the store are shared with the phone app's Inbox tab.
 */
import { useEffect } from 'react';
import { useOverlay } from '../../app/overlay';
import { registerChipHandler } from '../plugins';
import { InboxPanel } from './InboxPanel';
import './inbox.css';

export { InboxPanel } from './InboxPanel';
export { InboxReview, InboxRow } from './Review';
export { SourceIcon } from './icons';
export {
  addedSentence,
  dropItem,
  itemTitle,
  loadInbox,
  patchItem,
  timeAgo,
  useInbox,
  useUndo,
} from './store';

export function InboxLayer() {
  const overlay = useOverlay();
  useEffect(
    () =>
      registerChipHandler('inbox', () =>
        overlay.showPopover((close) => <InboxPanel close={close} />, { label: 'Inbox' }),
      ),
    [overlay],
  );
  return null;
}
