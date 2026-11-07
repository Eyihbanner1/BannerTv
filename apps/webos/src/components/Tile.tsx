import type { MetaPreview } from '@bannertv/protocol';
import { type CSSProperties, memo, useMemo } from 'react';
import { Artwork } from './Artwork';
import { artworkUrl } from './artwork-size';
import { Pressable } from './Pressable';
import styles from './Tile.module.css';

export type TileShape = 'poster' | 'landscape';

/** What a Continue Watching tile adds: how far through, and which episode. */
export interface TileExtra {
  /** 0 to 1. */
  progress?: number;
  /** A short note such as "S1:E3", in the corner. */
  note?: string;
}

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
  /** Position in the row's track or the grid, in px. */
  left: number;
  top?: number;
  extra?: TileExtra;
  /** Stable handlers that take the tile's index, so moving along a row redraws two tiles, not all. */
  onTileFocus: (index: number) => void;
  onTilePress: (index: number) => void;
  /** OK held on the tile, for a row that offers more than playing (see Pressable). */
  onTileLongPress?: (index: number) => void;
}

/**
 * A title in a row. Posters show the poster; landscape tiles show the
 * backdrop with the title logo, the Netflix way. The name sits underneath as
 * text, so a missing image still leaves a readable tile.
 */
export const Tile = memo(function Tile({
  focusKey,
  item,
  shape,
  index,
  loadingLabel,
  left,
  top,
  extra,
  onTileFocus,
  onTilePress,
  onTileLongPress,
}: TileProps) {
  const note = extra?.note;
  const progress = extra?.progress;
  const label = item
    ? [item.name, note ?? item.releaseInfo].filter(Boolean).join(', ')
    : loadingLabel;
  const className = `${styles.tile} ${styles[shape]}${item ? '' : ` ${styles.loading}`}`;
  const loaded = item !== undefined;
  const style = useMemo<CSSProperties>(
    () => (loaded ? { left, top, backgroundImage: fallbackArt(index) } : { left, top }),
    [left, top, index, loaded],
  );
  const poster = artworkUrl(item?.poster, 'posterTile');
  const background = artworkUrl(item?.background, 'landscapeTile');
  const logo = artworkUrl(item?.logo, 'tileLogo');

  return (
    <Pressable
      focusKey={focusKey}
      label={label}
      className={className}
      focusedClassName={styles.focused}
      style={style}
      onFocus={() => onTileFocus(index)}
      onPress={() => onTilePress(index)}
      onLongPress={onTileLongPress && item ? () => onTileLongPress(index) : undefined}
    >
      {item && shape === 'poster' && (
        <>
          <span className={styles.caption}>{item.name}</span>
          <Artwork key={poster} src={poster} retrySrc={item.poster} className={styles.image} />
        </>
      )}
      {item && shape === 'landscape' && (
        <>
          <Artwork
            key={background}
            src={background}
            retrySrc={item.background}
            className={styles.image}
          />
          <span className={styles.shade} />
          <Artwork
            key={logo}
            src={logo}
            retrySrc={item.logo}
            className={styles.logo}
            fallback={<span className={styles.landscapeName}>{item.name}</span>}
          />
        </>
      )}
      {item && note && <span className={styles.note}>{note}</span>}
      {item && progress !== undefined && (
        <span className={styles.progress}>
          <span
            className={styles.progressDone}
            style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }}
          />
        </span>
      )}
    </Pressable>
  );
});

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
