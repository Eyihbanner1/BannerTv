import {
  type BoardRow,
  buildBoard,
  moveRow,
  orderedRows,
  rowIdentity,
  setRowHidden,
  slug,
} from '@bannertv/core';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Button } from '../../components/Button';
import { addonCollection } from '../../data/addons';
import { typeLabel } from '../../data/describe';
import { homeLayout } from '../../data/library';
import { canSlide } from '../../platform/input-mode';
import screen from '../Screen.module.css';
import styles from './HomeRowsScreen.module.css';

const LINE_STEP = 112;
const VISIBLE_LINES = 6;
const OVERSCAN = 2;

// Identities hold addon ids and genres; focus keys need [a-z0-9-].
const lineKey = (row: BoardRow) => `home-rows-${slug(rowIdentity(row))}`;

/**
 * Settings > Home rows: every row Home can show, in its order, each with
 * Up, Down, and Hide or Show. Kept per profile. Rows from addons added later
 * join at the bottom.
 */
export function HomeRowsScreen() {
  const { t } = useTranslation();
  const collection = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  const layout = useSyncExternalStore(homeLayout.subscribe, homeLayout.get);
  const rows = useMemo(
    () => orderedRows(buildBoard(collection.addons), layout),
    [collection.addons, layout],
  );
  const hidden = new Set(layout.hidden);
  const [focused, setFocused] = useState(0);
  useScreenFocus(rows.length > 0 ? `${lineKey(rows[0]!)}-up` : undefined, collection.ready);

  const lastAnchor = Math.max(0, rows.length - VISIBLE_LINES);
  const anchor = Math.max(0, Math.min(focused - 1, lastAnchor));
  const first = Math.max(0, anchor - OVERSCAN);
  const last = Math.min(rows.length, anchor + VISIBLE_LINES + OVERSCAN);

  const move = (row: BoardRow, by: -1 | 1, index: number) => {
    const board = buildBoard(collection.addons);
    setFocused(index + by);
    // The line moves to another place in the list, which drops DOM focus; give it back.
    void homeLayout
      .update((current) => moveRow(board, current, rowIdentity(row), by))
      .then(() => setFocus(`${lineKey(row)}-${by < 0 ? 'up' : 'down'}`));
  };

  const lines = [];
  for (let index = first; index < last; index++) {
    const row = rows[index]!;
    const key = lineKey(row);
    const isHidden = hidden.has(rowIdentity(row));
    const name = `${row.name} · ${typeLabel(t, row.type)}`;
    const onFocus = () => {
      if (canSlide()) setFocused(index);
    };
    lines.push(
      <div
        key={key}
        className={isHidden ? `${styles.line} ${styles.hidden}` : styles.line}
        style={{ top: index * LINE_STEP }}
      >
        <div className={styles.text}>
          <p className={styles.name}>{name}</p>
          <p className={styles.addon}>
            {isHidden
              ? t('homeRows.hiddenFrom', { addon: row.addon.manifest.name })
              : row.addon.manifest.name}
          </p>
        </div>
        <Button
          focusKey={`${key}-up`}
          label={t('homeRows.moveUp', { name })}
          onFocus={onFocus}
          onPress={() => index > 0 && move(row, -1, index)}
        >
          <span className={index > 0 ? undefined : styles.disabled}>{t('addons.up')}</span>
        </Button>
        <Button
          focusKey={`${key}-down`}
          label={t('homeRows.moveDown', { name })}
          onFocus={onFocus}
          onPress={() => index < rows.length - 1 && move(row, 1, index)}
        >
          <span className={index < rows.length - 1 ? undefined : styles.disabled}>
            {t('addons.down')}
          </span>
        </Button>
        <Button
          focusKey={`${key}-show`}
          label={isHidden ? t('homeRows.showLabel', { name }) : t('homeRows.hideLabel', { name })}
          onFocus={onFocus}
          onPress={() =>
            void homeLayout.update((current) => setRowHidden(current, rowIdentity(row), !isHidden))
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
      {collection.ready && rows.length === 0 ? (
        <p className={screen.muted}>{t('homeRows.none')}</p>
      ) : (
        <div className={styles.list}>
          <div
            className={styles.track}
            style={{ transform: `translateY(${-anchor * LINE_STEP}px)` }}
          >
            {lines}
          </div>
        </div>
      )}
    </div>
  );
}
