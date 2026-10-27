import type { MetaPreview } from '@bannertv/protocol';
import type { CSSProperties } from 'react';
import { Artwork } from './Artwork';
import { Pressable } from './Pressable';
import styles from './Tile.module.css';

export type TileShape = 'poster' | 'landscape';

// Brand violets, so tiles without artwork are easy to tell apart.
const FALLBACK_ART = [
  ['#4B23C8', '#C9B5FF'],
  ['#261C42', '#7B4DFF'],
  ['#3D1AA8', '#A98BFF'],
  ['#1B1430', '#6A3BF0'],
  ['#5B2FE0', '#F1EDFF'],
  ['#120E20', '#9C7BFF'],
] as const;

export function fallbackArt(index: number, angle = 160): string {
  const [from, to] = FALLBACK_ART[index % FALLBACK_ART.length]!;
  return `linear-gradient(${angle}deg, ${from}, ${to})`;
}

interface TileProps {
  focusKey: string;
  /** Undefined while the row is loading: a focusable placeholder. */
  item: MetaPreview | undefined;
  shape: TileShape;
  index: number;
  loadingLabel: string;
  style?: CSSProperties;
  onFocus: () => void;
  onPress: () => void;
}

/**
 * A title in a row. Posters show the poster; landscape tiles show the
 * backdrop with the title logo, the Netflix way. The name sits underneath as
 * text, so a missing image still leaves a readable tile.
 */
export function Tile({
  focusKey,
  item,
  shape,
  index,
  loadingLabel,
  style,
  onFocus,
  onPress,
}: TileProps) {
  const label = item ? [item.name, item.releaseInfo].filter(Boolean).join(', ') : loadingLabel;
  const className = `${styles.tile} ${styles[shape]}${item ? '' : ` ${styles.loading}`}`;

  return (
    <Pressable
      focusKey={focusKey}
      label={label}
      className={className}
      focusedClassName={styles.focused}
      style={item ? { ...style, backgroundImage: fallbackArt(index) } : style}
      onFocus={onFocus}
      onPress={onPress}
    >
      {item && shape === 'poster' && (
        <>
          <span className={styles.caption}>{item.name}</span>
          <Artwork key={item.poster} src={item.poster} className={styles.image} />
        </>
      )}
      {item && shape === 'landscape' && (
        <>
          <Artwork key={item.background} src={item.background} className={styles.image} />
          <span className={styles.shade} />
          <Artwork
            key={item.logo}
            src={item.logo}
            className={styles.logo}
            fallback={<span className={styles.landscapeName}>{item.name}</span>}
          />
        </>
      )}
    </Pressable>
  );
}

interface MoreTileProps {
  focusKey: string;
  shape: TileShape;
  label: string;
  style?: CSSProperties;
  onFocus: () => void;
  onPress: () => void;
}

/** The last tile of a row: opens the whole catalog. */
export function MoreTile({ focusKey, shape, label, style, onFocus, onPress }: MoreTileProps) {
  return (
    <Pressable
      focusKey={focusKey}
      label={label}
      className={`${styles.tile} ${styles[shape]} ${styles.more}`}
      focusedClassName={styles.focused}
      style={style}
      onFocus={onFocus}
      onPress={onPress}
    >
      <span className={styles.moreLabel}>{label}</span>
    </Pressable>
  );
}
