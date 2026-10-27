import { type ReactNode, useState } from 'react';

interface ArtworkProps {
  src: string | undefined;
  /** Tried when `src` fails: the addon's own address when `src` asked for another size. */
  retrySrc?: string;
  className?: string;
  /** Drawn instead when there is no image or it fails to load. */
  fallback?: ReactNode;
  onLoad?: (image: HTMLImageElement) => void;
}

/**
 * An addon image. Addons often point at artwork that does not exist, so a
 * failed load quietly shows the fallback (usually the title as text). Give it
 * `key={src}` so a new image starts fresh.
 */
export function Artwork({ src, retrySrc, className, fallback = null, onLoad }: ArtworkProps) {
  const [failures, setFailures] = useState(0);
  const sources = retrySrc && retrySrc !== src ? [src, retrySrc] : [src];
  const current = sources[failures];
  if (!current) return <>{fallback}</>;
  return (
    <img
      key={current}
      className={className}
      src={current}
      alt=""
      decoding="async"
      draggable={false}
      onLoad={onLoad && ((event) => onLoad(event.currentTarget))}
      onError={() => setFailures((count) => count + 1)}
    />
  );
}
