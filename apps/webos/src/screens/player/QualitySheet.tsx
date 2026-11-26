import { languageName, type QualityChoice, type StreamEntry } from '@bannertv/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Overlay } from '../../components/Overlay';
import { addonNames } from '../../data/addons';
import { resolutionLabel, streamBadges, streamTitle } from '../../player/describe';
import { SheetDetail } from './SheetDetail';
import { rowParts, type SheetRow, SheetList } from './SheetList';
import styles from './QualitySheet.module.css';

const SHEET = 'player-quality';
/** Two lines a row: the resolution, then what else is known of its stream. */
const ROW_HEIGHT = 100;
const VISIBLE = 4;

/** A choice's value: its resolution, or "other" for a stream that does not say. */
export const qualityValue = (choice: QualityChoice) => choice.resolution ?? 'other';

/**
 * Quality in a sheet that rises from the bottom, as Audio & subtitles does, so
 * the picture and its subtitles stay in sight above it. A row for each
 * resolution with the stream it would play: its HDR, sound and size on a
 * second line, and in a box beside the list its addon and release in full.
 */
export function QualitySheet({
  choices,
  current,
  playing,
  returnFocusKey,
  onPick,
  onBack,
  onClose,
}: {
  choices: readonly QualityChoice[];
  /** The resolution playing, or "other". */
  current: string;
  playing: StreamEntry | null;
  returnFocusKey: () => string;
  onPick: (choice: QualityChoice) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState<number | null>(null);
  const currentIndex = choices.findIndex((choice) => qualityValue(choice) === current);

  const facts = (choice: QualityChoice, here: boolean) => {
    // Playing now, the stream playing's own facts: the choice may be another at its resolution.
    const entry = here && playing ? playing : choice.entry;
    const badges = streamBadges({ ...entry.facts, resolution: undefined });
    if (entry.facts.cached === true) badges.push(t('streams.cached'));
    const languages = choice.otherLanguages
      ? t('player.otherAudio', { languages: choice.otherLanguages.map(languageName).join(', ') })
      : undefined;
    return { entry, badges, languages };
  };
  const labelOf = (choice: QualityChoice) =>
    resolutionLabel(choice.resolution) ?? t('player.otherQuality');

  const rows = choices.map((choice, index): SheetRow => {
    const here = index === currentIndex;
    const { badges, languages } = facts(choice, here);
    const line = [here ? t('player.playingNow') : undefined, ...badges, languages].filter(
      (part): part is string => !!part,
    );
    const label = labelOf(choice);
    return {
      focusKey: `${SHEET}-${index}`,
      label,
      spoken: [label, ...line].join(', '),
      selected: here,
      body: (
        <>
          <span className={styles.top}>{label}</span>
          {line.length > 0 && <span className={rowParts.line}>{line.join(' · ')}</span>}
        </>
      ),
      onFocus: () => setFocused(index),
      onPress: () => onPick(choice),
    };
  });
  const shownIndex = focused ?? (currentIndex >= 0 ? currentIndex : 0);
  const shown = choices[shownIndex];
  const detail = shown ? facts(shown, shownIndex === currentIndex) : undefined;
  const first = rows[currentIndex >= 0 ? currentIndex : 0]?.focusKey;

  return (
    <Overlay
      focusKey={SHEET}
      label={t('player.quality')}
      defaultFocusKey={first ?? `${SHEET}-list`}
      returnFocusKey={returnFocusKey}
      onClose={onClose}
      // One level: Back closes onto the controls.
      onBack={() => {
        onBack();
        return true;
      }}
      placement="bottom"
    >
      <div className={styles.view}>
        <h2 className={styles.heading}>{t('player.quality')}</h2>
        <SheetList
          focusKey={`${SHEET}-list`}
          rows={rows}
          preferred={first}
          remember={false}
          visible={VISIBLE}
          rowHeight={ROW_HEIGHT}
          className={styles.list}
        />
        {shown && detail && (
          <SheetDetail
            className={styles.box}
            title={
              shownIndex === currentIndex
                ? `${labelOf(shown)} · ${t('player.playingNow')}`
                : labelOf(shown)
            }
            chips={detail.badges}
            text={[addonNames().get(detail.entry.addonId) ?? detail.entry.addonId, detail.languages]
              .filter(Boolean)
              .join(' · ')}
            label={t('player.infoRow.release')}
            name={streamTitle(detail.entry)}
          />
        )}
      </div>
    </Overlay>
  );
}
