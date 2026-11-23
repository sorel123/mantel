/** v4 S: the photo sources list and Google Photos picking, for Settings, Slideshow. */
import type { AppDeps } from '../../app.js';
import type { Handle } from '../../contract.js';
import { HttpError } from '../../errors.js';

export function registerPhotoSourceRoutes(handle: Handle, deps: AppDeps) {
  const photos = () => deps.providers.photos;
  const picker = () => {
    const p = photos().picker;
    if (!p) throw new HttpError('bad_request', 'Google Photos is not available on this server.');
    return p;
  };

  handle('photoSources', async () => ({ sources: (await photos().sources?.()) ?? [] }));
  handle('googlePhotosPick', async () => picker().start());
  handle('googlePhotosPickStatus', async ({ params }) => picker().status(params.id ?? ''));
  handle('googlePhotosClear', async () => ({ removed: await picker().clear() }));
  handle('googlePhotosCallback', async ({ c }) => {
    const back = (q: string) => c.redirect(`/settings?${q}#photos`, 302);
    try {
      await picker().callback(c.req.url);
      return back('googlePhotos=connected');
    } catch (err) {
      return back(
        `googlePhotosError=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`,
      );
    }
  });
}
