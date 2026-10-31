import { photoPalettes, photoSvg } from '@mantel/shared/fixtures';

export interface SlidePhoto {
  /** Image URL (any scheme the browser can load). */
  url: string;
  /** Dominant colour for the backdrop while the image loads. */
  dominant?: string;
}

/**
 * Generated landscapes in the mockup's ambient palettes, as inline SVG data URLs, for the demo
 * page and tests. The display itself shows the server's album through WS4's `PhotoSlideshow`.
 */
export function placeholderPhotos(count = 8, width = 1180, height = 820): SlidePhoto[] {
  return Array.from({ length: count }, (_, i) => ({
    url: `data:image/svg+xml;utf8,${encodeURIComponent(photoSvg(i, width, height))}`,
    dominant: photoPalettes[i % photoPalettes.length]!.sky[1],
  }));
}
