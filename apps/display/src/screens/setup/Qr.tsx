import QR from 'qrcode';
import { useEffect, useState } from 'react';

/** A QR code as inline SVG, drawn in the current ink colour. */
export function QrCode({
  text,
  size = 160,
  label,
}: {
  text: string;
  size?: number;
  label?: string;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QR.toString(text, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#0000' },
    })
      .then((s) => {
        if (!cancelled) setSvg(s);
      })
      .catch(() => setSvg(null));
    return () => {
      cancelled = true;
    };
  }, [text]);
  if (!svg) return <div className="qr" style={{ width: size, height: size }} aria-hidden="true" />;
  return (
    <div
      className="qr"
      role="img"
      aria-label={label ?? `QR code for ${text}`}
      style={{ width: size, height: size }}
      // The library's SVG; its black becomes `currentColor` so it follows the look.
      dangerouslySetInnerHTML={{ __html: svg.replace(/#000000/g, 'currentColor') }}
    />
  );
}
