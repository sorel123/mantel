import { useEffect, useState } from 'react';

/** Scale factor that fits a fixed-size panel inside the viewport (letterboxed, never above 1 on desktop dev). */
export function useFitScale(width: number, height: number): number {
  const compute = () => Math.min(window.innerWidth / width, window.innerHeight / height);
  const [scale, setScale] = useState(compute);
  useEffect(() => {
    const onResize = () => setScale(compute());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);
  return scale;
}
