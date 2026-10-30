import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { type ReactNode, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Overlay } from '../../components/Overlay';
import { Pressable } from '../../components/Pressable';
import {
  DEFAULT_PREFERENCES,
  preferences,
  setPreference,
  setSubtitleStyle,
  type SubtitleStyle,
} from '../../data/preferences';
import { SubtitleCue, subtitleBack, subtitleColour, subtitleText } from './SubtitleLayer';
import styles from './SubtitleStylePanel.module.css';

const CHOICES: { [K in keyof SubtitleStyle]: ReadonlyArray<SubtitleStyle[K]> } = {
  size: ['small', 'medium', 'large', 'huge'],
  colour: ['white', 'yellow', 'cyan', 'green'],
  background: ['outline', 'shadow', 'box', 'solid'],
  position: ['bottom', 'raised', 'top'],
};

const FIELDS: ReadonlyArray<keyof SubtitleStyle> = ['size', 'colour', 'background', 'position'];

/** The profile's subtitle style, as it changes. */
export function useSubtitleStyle(): SubtitleStyle {
  return useSyncExternalStore(preferences.subscribe, () => preferences.get().subtitleStyle);
}

/** "Large, yellow": what the Style tab says is on. */
export function useStyleSummary(): string {
  const { t } = useTranslation();
  const look = useSubtitleStyle();
  return t('player.styleSummary', {
    size: t(`player.styleValue.size.${look.size}`),
    colour: t(`player.styleColourInline.${look.colour}`),
  });
}

/** What a choice looks like: Aa at its size, a swatch, Aa on its background, a picture of where it sits. */
function Sample({ field, value }: { field: keyof SubtitleStyle; value: string }) {
  if (field === 'size') return <span className={`${styles.aa} ${styles[`aa-${value}`]}`}>Aa</span>;
  if (field === 'colour') {
    return (
      <span className={`${styles.swatch} ${subtitleColour(value as SubtitleStyle['colour'])}`} />
    );
  }
  if (field === 'background') {
    return (
      <span className={styles.aa}>
        <span className={subtitleBack(value as SubtitleStyle['background'])}>Aa</span>
      </span>
    );
  }
  return (
    <span className={styles.screen}>
      <span className={`${styles.line} ${styles[`line-${value}`]}`} />
    </span>
  );
}

/** One field's choices: Up and Down land on the choice made, not the one above or below. */
function FieldRow({
  focusKey,
  chosen,
  children,
}: {
  focusKey: string;
  chosen: string;
  children: ReactNode;
}) {
  const { ref, focusKey: key } = useFocusable<object, HTMLDivElement>({
    focusKey,
    saveLastFocusedChild: false,
    preferredChildFocusKey: chosen,
  });
  return (
    <FocusContext.Provider value={key}>
      <div ref={ref} className={styles.field}>
        {children}
      </div>
    </FocusContext.Provider>
  );
}

/**
 * Subtitle size, colour, background and position, each choice shown as it
 * looks. The player's sheet and Settings both use it; changes show at once.
 */
export function SubtitleStyleChoices({ focusKey }: { focusKey: string }) {
  const { t } = useTranslation();
  const look = useSubtitleStyle();
  const { ref, focusKey: key } = useFocusable<object, HTMLDivElement>({
    focusKey,
    saveLastFocusedChild: false,
    preferredChildFocusKey: `${focusKey}-size-${look.size}`,
  });
  return (
    <FocusContext.Provider value={key}>
      <div ref={ref} className={styles.choices}>
        {FIELDS.map((field) => (
          <FieldRow
            key={field}
            focusKey={`${focusKey}-${field}`}
            chosen={`${focusKey}-${field}-${look[field]}`}
          >
            <span className={styles.name}>{t(`player.styleField.${field}`)}</span>
            {(CHOICES[field] as readonly string[]).map((value) => {
              const name = t(`player.styleValue.${field}.${value}`);
              const chosen = look[field] === value;
              return (
                <Pressable
                  key={value}
                  focusKey={`${focusKey}-${field}-${value}`}
                  label={`${t(`player.styleField.${field}`)}, ${name}`}
                  className={chosen ? `${styles.chip} ${styles.chosen}` : styles.chip}
                  focusedClassName={styles.focused}
                  onPress={() => setSubtitleStyle(field, value as SubtitleStyle[typeof field])}
                >
                  <Sample field={field} value={value} />
                  <span className={styles.chipName}>{name}</span>
                </Pressable>
              );
            })}
            {field === 'position' && (
              <Pressable
                focusKey={`${focusKey}-reset`}
                label={t('player.styleReset')}
                className={`${styles.chip} ${styles.reset}`}
                focusedClassName={styles.focused}
                onPress={() => setPreference('subtitleStyle', DEFAULT_PREFERENCES.subtitleStyle)}
              >
                <span className={styles.chipName}>{t('player.styleReset')}</span>
              </Pressable>
            )}
          </FieldRow>
        ))}
      </div>
    </FocusContext.Provider>
  );
}

/**
 * Settings' subtitle style: the same choices in a sheet from the bottom, with
 * a sample line above it.
 */
export function SubtitleStylePanel({
  returnFocusKey,
  onClose,
}: {
  returnFocusKey: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const look = useSubtitleStyle();
  return (
    <Overlay
      focusKey="settings-style"
      label={t('player.style')}
      defaultFocusKey={`settings-style-choices-size-${look.size}`}
      returnFocusKey={returnFocusKey}
      onClose={onClose}
      placement="bottom"
    >
      <div
        className={[styles.sample, look.position === 'top' && styles.sampleTop, subtitleText(look)]
          .filter(Boolean)
          .join(' ')}
        aria-hidden="true"
      >
        <SubtitleCue
          cue={{ start: 0, end: 0, lines: [[{ text: t('player.sampleLine') }]] }}
          look={look}
        />
      </div>
      <div className={styles.heading}>
        <h2 className={styles.title}>{t('player.style')}</h2>
        <p className={styles.kept}>{t('player.styleKept')}</p>
      </div>
      <SubtitleStyleChoices focusKey="settings-style-choices" />
    </Overlay>
  );
}
