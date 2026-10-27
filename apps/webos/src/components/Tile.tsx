import type { SampleItem } from '../screens/home/sample-data';
import { artGradient } from '../screens/home/sample-data';
import { Pressable } from './Pressable';
import styles from './Tile.module.css';

interface TileProps {
  focusKey: string;
  item: SampleItem;
  shape: 'poster' | 'landscape';
  onFocus: () => void;
  onPress: () => void;
}

export function Tile({ focusKey, item, shape, onFocus, onPress }: TileProps) {
  return (
    <Pressable
      focusKey={focusKey}
      label={`${item.title}, ${item.year}`}
      className={`${styles.tile} ${styles[shape]}`}
      focusedClassName={styles.focused}
      style={{ backgroundImage: artGradient(item) }}
      onFocus={onFocus}
      onPress={onPress}
    >
      <span className={styles.caption}>{item.title}</span>
    </Pressable>
  );
}
