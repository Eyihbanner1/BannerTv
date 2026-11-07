import { libraryPreview } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { openSection } from '../../app/router';
import { Row, RowPlaceholder } from '../../components/Row';
import { library } from '../../data/library';
import { focusedKey } from '../../navigation/spatial';
import { openDetails } from './Hero';
import { heroItem } from './hero-item';

/** The row's key on Home, beside the catalog rows' keys. */
export const MY_LIST_ROW_KEY = 'my-list';
export const MY_LIST_FOCUS_KEY = `home-${MY_LIST_ROW_KEY}`;
const MAX_ITEMS = 40;

interface MyListRowProps {
  /** The first row on Home: the hero starts on its first title. */
  first: boolean;
  /** Near focus: drawn, like any Home row. */
  near: boolean;
  onItemFocus: (rowKey: string, item: MetaPreview | undefined, element: HTMLElement) => void;
  /**
   * The row is drawn, or is not because My List is empty now, so the rows
   * under it have moved. `focused` if focus was in the row as it went.
   */
  onShown: (shown: boolean, focused: boolean) => void;
}

const openLibrary = () => openSection('library');

/**
 * Home's "My List" row: the profile's list, newest first, from what is kept
 * on the TV. It asks no addon for anything. See all opens Library.
 */
export const MyListRow = memo(function MyListRow({
  first,
  near,
  onItemFocus,
  onShown,
}: MyListRowProps) {
  const { t } = useTranslation();
  const list = useSyncExternalStore(library.subscribe, library.items);
  const items = useMemo(() => list.slice(0, MAX_ITEMS).map(libraryPreview), [list]);
  const empty = items.length === 0;
  // Before the tiles unregister, while focus is still on one of them.
  useLayoutEffect(() => {
    onShown(!empty, empty && focusedKey().indexOf(`${MY_LIST_FOCUS_KEY}-tile-`) === 0);
  }, [empty, onShown]);
  useEffect(() => {
    if (first && items.length > 0 && heroItem.get() === null) heroItem.set(items[0]!);
  }, [first, items]);
  const onFocus = useCallback(
    (item: MetaPreview | undefined, element: HTMLElement) =>
      onItemFocus(MY_LIST_ROW_KEY, item, element),
    [onItemFocus],
  );
  const title = t('library.myList');
  if (empty) return null;
  if (!near) return <RowPlaceholder title={title} shape="poster" />;
  return (
    <Row
      focusKey={MY_LIST_FOCUS_KEY}
      title={title}
      shape="poster"
      items={items}
      onItemFocus={onFocus}
      onItemPress={openDetails}
      onSeeAll={openLibrary}
    />
  );
});
