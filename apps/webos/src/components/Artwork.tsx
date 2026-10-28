import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { tuning } from '../platform/tuning';

interface ArtworkProps {
  src: string | undefined;
  /** Tried when `src` fails: the addon's own address when `src` asked for another size. */
  retrySrc?: string;
  className?: string;
  /** Drawn instead when there is no image or it fails to load. */
  fallback?: ReactNode;
  onLoad?: (image: HTMLImageElement) => void;
  /** Every address failed, and the fallback shows. */
  onFail?: () => void;
}

const DECODING = tuning.decoding === 'async' ? 'async' : undefined;

/**
 * An addon image. Addons often point at artwork that does not exist, so a
 * failed load quietly shows the fallback (usually the title as text). Give it
 * `key={src}` so a new image starts fresh.
 *
 * No `decoding="async"`: on the TV's Chromium 87 that draws each big image
 * blank first and then redraws it once decoded, and every redraw holds up the
 * next frame. Without it the image arrives with the first draw. The
 * `decoding` tuning switch brings it back, to compare the two on the TV.
 */
export function Artwork({
  src,
  retrySrc,
  className,
  fallback = null,
  onLoad,
  onFail,
}: ArtworkProps) {
  const [failures, setFailures] = useState(0);
  const image = useRef<HTMLImageElement>(null);
  // The address whose load or error has been handled, so each is handled once.
  const handled = useRef<string>(undefined);
  const sources = retrySrc && retrySrc !== src ? [src, retrySrc] : [src];
  const current = sources[failures];

  const loaded = (node: HTMLImageElement) => {
    if (handled.current === current) return;
    handled.current = current;
    onLoad?.(node);
  };
  const failed = () => {
    if (handled.current === current) return;
    handled.current = current;
    setFailures(failures + 1);
    if (failures + 1 === sources.length) onFail?.();
  };

  // React drops a load or error event that fires before it has added the
  // image to the page, which a cached image can do while a long render (a Home
  // row) pauses. So look again once it is there. A finished image with no size
  // failed, unless it is an SVG that has none, which decoding tells apart.
  useLayoutEffect(() => {
    const node = image.current;
    if (!node?.complete) return;
    if (node.naturalWidth > 0) loaded(node);
    else if (typeof node.decode === 'function') node.decode().then(() => loaded(node), failed);
    // Checked once, when the image for this address is first on the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  if (!current) return <>{fallback}</>;
  return (
    <img
      key={current}
      ref={image}
      className={className}
      src={current}
      alt=""
      decoding={DECODING}
      draggable={false}
      onLoad={(event) => loaded(event.currentTarget)}
      onError={failed}
    />
  );
}
