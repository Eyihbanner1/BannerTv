import {
  type BoardRow,
  buildBoard,
  CONTINUE_LINE,
  type HomeLine,
  homeLines,
  LIVE_SPORT_LINE,
  MY_LIST_LINE,
  moveLine,
  setLineHidden,
} from '@bannertv/core';
import { getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useScreenSlot } from '../../app/screen-slot';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Button } from '../../components/Button';
import { addonCollection } from '../../data/addons';
import { typeLabel } from '../../data/describe';
import { homeOwnLines } from '../../data/home-board';
import { homeLayout } from '../../data/library';
import { sportsState } from '../../data/sports';
import { canSlide } from '../../platform/input-mode';
import screen from '../Screen.module.css';
import styles from './HomeRowsScreen.module.css';

const LINE_STEP = 112;
const VISIBLE_LINES = 6;
const OVERSCAN = 2;

// Board keys are unique, and stay put while rows are moved and hidden. Home's
// own lines go by their names.
const lineKey = (line: HomeLine) =>
  `home-rows-${line.row ? line.row.key : line.id.replace(':', '-')}`;
const NO_ROWS: readonly BoardRow[] = [];
const OWN_NAMES: Record<string, string> = {
  [CONTINUE_LINE]: 'home.continueWatching',
  [MY_LIST_LINE]: 'library.myList',
  [LIVE_SPORT_LINE]: 'sports.liveRow',
};
const OWN_NOTES: Record<string, string> = {
  [CONTINUE_LINE]: 'homeRows.continueNote',
  [MY_LIST_LINE]: 'homeRows.myListNote',
  [LIVE_SPORT_LINE]: 'homeRows.liveSportNote',
};

/**
 * Settings > Home rows: every row Home can show, in its order, each with
 * Up, Down, and Hide or Show. Kept per profile. Rows from addons added later
 * join at the bottom. Home's own rows are listed too: Continue Watching,
 * always first, can only be hidden; My List and Live sport move like any
 * row. Sports catalogs are on the Sports screen, not Home, so they are not
 * listed.
 */
export function HomeRowsScreen() {
  const { t } = useTranslation();
  const collection = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  const layout = useSyncExternalStore(homeLayout.subscribe, homeLayout.get);
  const sports = useSyncExternalStore(sportsState.subscribe, sportsState.get);
  const ready = collection.ready && sports.ready;
  const board = useMemo(
    () => (ready ? buildBoard(collection.addons, sports.homeLeaveOut) : NO_ROWS),
    [ready, collection.addons, sports.homeLeaveOut],
  );
  // Where Live sport sits until moved, as on a Home with something to continue.
  const own = useMemo(() => homeOwnLines(sports.shown, true), [sports.shown]);
  const lines = useMemo(
    () => (ready ? homeLines(board, layout, own) : []),
    [ready, board, layout, own],
  );
  // Every line but Continue Watching moves, among the others.
  const movable = lines.filter((line) => line.id !== CONTINUE_LINE);
  const [focused, setFocused] = useState(0);
  useScreenFocus(lines.length > 0 ? `${lineKey(lines[0]!)}-show` : undefined, ready);

  // A moved line is drawn in its new place, which drops DOM focus: give it
  // back, unless focus has gone elsewhere or the screen is no longer shown.
  const slot = useScreenSlot();
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const target = refocus.current;
    refocus.current = null;
    if (target && slot.get() && getCurrentFocusKey() === target) void setFocus(target);
  }, [layout, slot]);

  const lastAnchor = Math.max(0, lines.length - VISIBLE_LINES);
  const anchor = Math.max(0, Math.min(focused - 1, lastAnchor));
  const first = Math.max(0, anchor - OVERSCAN);
  const last = Math.min(lines.length, anchor + VISIBLE_LINES + OVERSCAN);

  const move = (line: HomeLine, by: -1 | 1, index: number) => {
    setFocused(index + by);
    refocus.current = `${lineKey(line)}-${by < 0 ? 'up' : 'down'}`;
    void homeLayout.update((current) => moveLine(board, current, own, line.id, by));
  };

  const drawn = [];
  for (let index = first; index < last; index++) {
    const line = lines[index]!;
    const { row, id } = line;
    const key = lineKey(line);
    const isHidden = line.hidden;
    const fixed = id === CONTINUE_LINE;
    const place = movable.indexOf(line);
    const canUp = place > 0;
    const canDown = place !== -1 && place < movable.length - 1;
    const name = row ? `${row.name} · ${typeLabel(t, row.type)}` : t(OWN_NAMES[id] ?? id);
    const from = row ? row.addon.manifest.name : t(OWN_NOTES[id] ?? id);
    const onFocus = () => {
      if (canSlide()) setFocused(index);
    };
    drawn.push(
      <div
        key={key}
        className={isHidden ? `${styles.line} ${styles.hidden}` : styles.line}
        style={{ top: index * LINE_STEP }}
      >
        <div className={styles.text}>
          <p className={styles.name}>{name}</p>
          <p className={styles.addon}>
            {!isHidden
              ? from
              : row
                ? t('homeRows.hiddenFrom', { addon: from })
                : t('homeRows.hidden')}
          </p>
        </div>
        {fixed ? null : (
          <Button
            focusKey={`${key}-up`}
            label={t('homeRows.moveUp', { name })}
            onFocus={onFocus}
            onPress={() => canUp && move(line, -1, index)}
          >
            <span className={canUp ? undefined : styles.disabled}>{t('addons.up')}</span>
          </Button>
        )}
        {fixed ? null : (
          <Button
            focusKey={`${key}-down`}
            label={t('homeRows.moveDown', { name })}
            onFocus={onFocus}
            onPress={() => canDown && move(line, 1, index)}
          >
            <span className={canDown ? undefined : styles.disabled}>{t('addons.down')}</span>
          </Button>
        )}
        <Button
          focusKey={`${key}-show`}
          label={isHidden ? t('homeRows.showLabel', { name }) : t('homeRows.hideLabel', { name })}
          onFocus={onFocus}
          onPress={() =>
            void homeLayout.update((current) => setLineHidden(board, current, id, !isHidden))
          }
        >
          {isHidden ? t('homeRows.show') : t('homeRows.hide')}
        </Button>
      </div>,
    );
  }

  return (
    <div className={screen.screen}>
      <h1 className={screen.title}>{t('homeRows.title')}</h1>
      <p className={screen.lead}>{t('homeRows.lead')}</p>
      {ready && board.length === 0 ? <p className={screen.muted}>{t('homeRows.none')}</p> : null}
      {lines.length === 0 ? null : (
        <div className={styles.list}>
          <div
            className={styles.track}
            style={{ transform: `translateY(${-anchor * LINE_STEP}px)` }}
          >
            {drawn}
          </div>
        </div>
      )}
    </div>
  );
}
