/** Sending a file from the phone to the inbox (the Inbox tab and the share sheet). */
import { patchItem } from '../../../features/inbox';
import { api } from '../../../lib/api';
import { readPhoto } from '../image';

/** A PDF or calendar file as a data URL the server accepts. */
export async function readDocument(file: File): Promise<string> {
  if (file.size > 11_000_000) throw new Error('That file is over 11 MB. Send a smaller one.');
  const name = file.name.toLowerCase();
  const type =
    file.type === 'application/pdf' || name.endsWith('.pdf')
      ? 'application/pdf'
      : file.type === 'text/calendar' || name.endsWith('.ics')
        ? 'text/calendar'
        : file.type.startsWith('text/')
          ? 'text/plain'
          : null;
  if (!type) throw new Error('Send a photo, a PDF or a calendar (.ics) file.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

/** Send one file to the inbox: photos are shrunk on the phone first. */
export async function sendFile(file: File, source: 'share' | 'photo' = 'share') {
  const isPhoto = file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name);
  const data = isPhoto ? await readPhoto(file) : await readDocument(file);
  const { item } = await api.call('inboxCreate', {
    body: { file: data, name: file.name || undefined, source: isPhoto ? 'photo' : source },
  });
  patchItem(item);
  return item;
}
