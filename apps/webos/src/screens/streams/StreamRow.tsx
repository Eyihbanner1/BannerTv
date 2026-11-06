import { otherLanguages, type StreamEntry } from '@bannertv/core';
import type { TFunction } from 'i18next';
import { type CSSProperties, memo, useMemo } from 'react';
import { Pressable } from '../../components/Pressable';
import { streamRowText } from '../../player/describe';
import styles from './StreamsScreen.module.css';

/** Each row's height in the list, gap included. */
export const STREAM_ROW_HEIGHT = 168;

interface StreamRowProps {
  t: TFunction;
  index: number;
  entry: StreamEntry;
  /** The addon's name. */
  addon: string;
  /** Needs more data than the connection has carried. */
  heavy: boolean;
  /** A test play of it worked. */
  tested: boolean;
  /** Stable handlers that take the row's index, so a move redraws only what changed. */
  onRowFocus: (index: number) => void;
  onRowPress: (index: number) => void;
}

/** One stream in All streams: its addon, title, badges and the note that matters most. */
export const StreamRow = memo(function StreamRow({
  t,
  index,
  entry,
  addon,
  heavy,
  tested,
  onRowFocus,
  onRowPress,
}: StreamRowProps) {
  const { title, badges, playable, note, notes } = streamRowText(t, entry, {
    heavy,
    languages: otherLanguages(entry.facts),
  });
  const style = useMemo<CSSProperties>(() => ({ top: index * STREAM_ROW_HEIGHT }), [index]);
  return (
    <Pressable
      focusKey={`streams-item-${index}`}
      label={[addon, title, badges.join(', '), ...notes].filter(Boolean).join('. ')}
      className={playable ? styles.stream : `${styles.stream} ${styles.unplayable}`}
      focusedClassName={styles.focused}
      style={style}
      onPress={() => onRowPress(index)}
      onFocus={() => onRowFocus(index)}
    >
      <div className={styles.addon}>{addon}</div>
      <div className={styles.text}>
        <p className={styles.title}>{title}</p>
        <p className={styles.badges}>
          {badges.map((badge) => (
            <span key={badge} className={styles.badge}>
              {badge}
            </span>
          ))}
          {tested && <span className={styles.works}>{t('streams.tested')}</span>}
        </p>
        {note && <p className={playable ? styles.warning : styles.reason}>{note}</p>}
      </div>
    </Pressable>
  );
});
