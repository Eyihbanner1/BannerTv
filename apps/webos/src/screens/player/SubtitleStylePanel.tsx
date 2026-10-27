import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Overlay } from '../../components/Overlay';
import { preferences, setSubtitleStyle, type SubtitleStyle } from '../../data/preferences';
import { PanelList, type PanelItem } from './PanelList';
import styles from './PlayerScreen.module.css';

const FOCUS_KEY = 'player-style';

const CHOICES: { [K in keyof SubtitleStyle]: ReadonlyArray<SubtitleStyle[K]> } = {
  size: ['small', 'medium', 'large', 'huge'],
  colour: ['white', 'yellow', 'cyan', 'green'],
  background: ['outline', 'shadow', 'box', 'solid'],
  position: ['bottom', 'raised', 'top'],
};

const FIELDS: ReadonlyArray<keyof SubtitleStyle> = ['size', 'colour', 'background', 'position'];

/** Subtitle size, colour, background and position. Changes show at once on the picture behind. */
export function SubtitleStylePanel({
  returnFocusKey,
  onClose,
}: {
  returnFocusKey: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const look = useSyncExternalStore(preferences.subscribe, () => preferences.get().subtitleStyle);
  const items: PanelItem[] = FIELDS.map((field) => {
    const values = CHOICES[field] as readonly string[];
    const index = values.indexOf(look[field]);
    return {
      kind: 'stepper',
      key: field,
      label: t(`player.styleField.${field}`),
      value: t(`player.styleValue.${field}.${look[field]}`),
      onStep: (direction) => {
        const next = values[(index + direction + values.length) % values.length]!;
        setSubtitleStyle(field, next as SubtitleStyle[typeof field]);
      },
    };
  });
  return (
    <Overlay
      focusKey={FOCUS_KEY}
      label={t('player.style')}
      defaultFocusKey={`${FOCUS_KEY}-size`}
      returnFocusKey={returnFocusKey}
      onClose={onClose}
      placement="side"
    >
      <h2 className={styles.panelTitle}>{t('player.style')}</h2>
      <p className={styles.panelHint}>{t('player.styleHint')}</p>
      <PanelList focusKey={FOCUS_KEY} items={items} initialIndex={0} />
    </Overlay>
  );
}
