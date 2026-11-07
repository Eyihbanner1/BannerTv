import { kidsTitleAllowed, moreLikeSource } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { memo, useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { Row } from '../../components/Row';
import { addonClient, addonCollection } from '../../data/addons';
import { isKidsProfile } from '../../data/profiles';
import { sportsState } from '../../data/sports';
import { useQuery } from '../../data/use-query';

const MORE_ITEMS = 20;
export const MORE_FOCUS_KEY = 'details-more';

/**
 * "More Drama from Cinemeta" under a title's buttons, as on the phone. It asks
 * its addon nothing, and draws no poster, until focus first comes down to it,
 * so a title page opens as light as before on the TV. See all opens Discover
 * on that catalog and genre. A kids profile sees Family titles only.
 */
export const MoreLikeThis = memo(function MoreLikeThis({
  item,
  type,
  onFocus,
}: {
  item: MetaPreview;
  type: string;
  /** Focus came into the row: the page slides up to show it. */
  onFocus: (element: HTMLElement) => void;
}) {
  const { t } = useTranslation();
  const collection = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  const sports = useSyncExternalStore(sportsState.subscribe, sportsState.get);
  const source = useMemo(
    () =>
      collection.ready && sports.ready
        ? moreLikeSource(collection.addons, item, type, sports.homeLeaveOut)
        : undefined,
    // The title's id and first genre decide it; the rest of the item may fill in underneath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collection, sports.ready, sports.homeLeaveOut, item.id, item.genres[0], type],
  );
  const [wanted, setWanted] = useState(false);
  const query = useMemo(
    () =>
      source
        ? addonClient.catalog(source.addon, type, source.catalog.id, [['genre', source.genre]])
        : null,
    [source, type],
  );
  const state = useQuery(query, wanted);
  const items = useMemo(() => {
    if (!state.data) return null;
    const kids = isKidsProfile();
    return state.data
      .filter((other) => other.id !== item.id && (!kids || kidsTitleAllowed(other, true)))
      .slice(0, MORE_ITEMS);
  }, [state.data, item.id]);
  const onItemFocus = useCallback(
    (_: MetaPreview | undefined, element: HTMLElement) => {
      setWanted(true);
      onFocus(element);
    },
    [onFocus],
  );
  const onItemPress = useCallback(
    (other: MetaPreview) =>
      push({ name: 'details', type: other.type, id: other.id, preview: other }),
    [],
  );
  const title = source
    ? t('browsing.moreFrom', { genre: source.genre, addon: source.addon.manifest.name })
    : '';
  const onSeeAll = useCallback(() => {
    if (!source) return;
    push({
      name: 'catalog',
      transportUrl: source.addon.transportUrl,
      type,
      catalogId: source.catalog.id,
      genre: source.genre,
    });
  }, [source, type]);
  if (!source || state.status === 'error' || (items !== null && items.length === 0)) return null;
  return (
    <Row
      focusKey={MORE_FOCUS_KEY}
      title={title}
      shape="poster"
      items={items}
      onItemFocus={onItemFocus}
      onItemPress={onItemPress}
      onSeeAll={onSeeAll}
    />
  );
});
