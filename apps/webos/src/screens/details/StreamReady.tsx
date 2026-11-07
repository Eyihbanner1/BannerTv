import { useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { resolutionLabel } from '../../player/describe';
import { streamFinder } from '../../player/finder';
import styles from './DetailsScreen.module.css';

type Ready = 'none' | 'finding' | 'ready' | 'nothing';

/**
 * Under the buttons, as on the phone: whether the stream Watch will start has
 * been found ("Best stream ready · 1080p"). It reads the look Details already
 * starts while focus rests on Watch, and asks for nothing itself. It draws
 * again only when its words change, not on every addon's answer.
 */
export function StreamReady({ type, videoId }: { type: string; videoId: string }) {
  const { t } = useTranslation();
  const finder = useMemo(() => streamFinder(type, videoId), [type, videoId]);
  const line = useSyncExternalStore(finder.subscribe, () => {
    const state = finder.get();
    const best = state.candidates[0];
    const kind: Ready = state.settled
      ? best
        ? 'ready'
        : 'nothing'
      : state.pending > 0 || state.entries.length > 0
        ? 'finding'
        : 'none';
    const quality = kind === 'ready' ? (resolutionLabel(best?.facts.resolution) ?? '') : '';
    return `${kind}|${quality}`;
  });
  const [kind, quality] = line.split('|') as [Ready, string];
  if (kind === 'none') return null;
  const text =
    kind === 'ready'
      ? [t('browsing.streamReady'), quality].filter(Boolean).join(' · ')
      : kind === 'finding'
        ? t('browsing.findingStream')
        : t('browsing.noStreamYet');
  return (
    <p className={styles.ready} role="status">
      <span
        className={
          kind === 'ready'
            ? `${styles.readyDot} ${styles.readyOn}`
            : kind === 'nothing'
              ? `${styles.readyDot} ${styles.readyOff}`
              : styles.readyDot
        }
      />
      {text}
    </p>
  );
}
