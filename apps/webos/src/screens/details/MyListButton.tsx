import type { MetaPreview } from '@bannertv/protocol';
import { useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { library } from '../../data/library';
import styles from './MyListButton.module.css';

const PLUS = 'M12 5v14M5 12h14';
const TICK = 'M5 12.5l4.5 4.5L19 7';

/**
 * Adds the title to My List, or takes it off. A saved title that came from
 * Trakt with a name only gets its artwork from the answer shown here.
 */
export function MyListButton({ item, onFocus }: { item: MetaPreview; onFocus?: () => void }) {
  const { t } = useTranslation();
  useSyncExternalStore(library.subscribe, library.version);
  const saved = library.has(item.id);

  useEffect(() => {
    if (library.has(item.id)) void library.refresh(item);
  }, [item]);

  return (
    <Button
      focusKey="details-my-list"
      label={
        saved
          ? t('library.removeLabel', { name: item.name })
          : t('library.addLabel', { name: item.name })
      }
      onFocus={onFocus}
      onPress={() => void (library.has(item.id) ? library.remove(item.id) : library.add(item))}
    >
      <svg className={styles.icon} width="32" height="32" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d={saved ? TICK : PLUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {t('library.add')}
    </Button>
  );
}
