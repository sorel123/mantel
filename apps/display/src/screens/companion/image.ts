/**
 * A photo from the camera or the library, made ready to send: decoded by the browser (Safari
 * reads HEIC itself), turned the right way up, shrunk to at most `max` on its long side and
 * re-encoded as a JPEG. That keeps a 12-megapixel shot under a megabyte.
 */
export async function readPhoto(file: File, max = 1600): Promise<string> {
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name))
    throw new Error('That is not a photo. Take a picture or pick one from the library.');
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Older browsers, or a format createImageBitmap refuses: let <img> try.
    bitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(
          new Error(
            'This browser cannot read that photo. HEIC works on an iPhone; elsewhere use a JPEG or PNG.',
          ),
        );
      };
      img.src = url;
    });
  }
  const w = 'naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width;
  const h = 'naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height;
  if (!w || !h) throw new Error('That photo is empty.');
  const k = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot prepare the photo.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if ('close' in bitmap) bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}
