import { type ReactNode, useState } from 'react';

interface ArtworkProps {
  src: string | undefined;
  className?: string;
  /** Drawn instead when there is no image or it fails to load. */
  fallback?: ReactNode;
  onLoad?: () => void;
}

/**
 * An addon image. Addons often point at artwork that does not exist, so a
 * failed load quietly shows the fallback (usually the title as text). Give it
 * `key={src}` so a new image starts fresh.
 */
export function Artwork({ src, className, fallback = null, onLoad }: ArtworkProps) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <>{fallback}</>;
  return (
    <img
      className={className}
      src={src}
      alt=""
      decoding="async"
      draggable={false}
      onLoad={onLoad}
      onError={() => setFailed(true)}
    />
  );
}
