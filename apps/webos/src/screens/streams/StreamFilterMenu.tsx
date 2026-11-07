import { languageName, type StreamEntry } from '@bannertv/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, type MenuOption } from '../../components/Menu';
import { setPreference } from '../../data/preferences';
import {
  filterChoices,
  filterResolutionLabel,
  isFiltering,
  NO_FILTER,
  type StreamFilter,
} from '../../player/stream-filter';

type Group = 'resolution' | 'addon' | 'language';
type Level = 'main' | Group;

/** "Any": no value in that part of the filter. No resolution, addon id or language is empty. */
const ANY = '';

/**
 * The stream lists' quick filter, as menus: a short first one with each part
 * and what it is set to, then one menu for each part with how many streams
 * have each value. Cached only switches where it is. Back goes up one level,
 * then closes. Each change is kept for the profile at once.
 */
export function StreamFilterMenu({
  focusKey,
  entries,
  filter,
  names,
  returnFocusKey,
  onChange,
  onClose,
}: {
  focusKey: string;
  /** Every stream, before the filter. */
  entries: readonly StreamEntry[];
  filter: StreamFilter;
  /** The addons' names by id, as the rows show them. */
  names: ReadonlyMap<string, string>;
  returnFocusKey: string;
  /** After each change: the list goes back to its top. */
  onChange?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [level, setLevel] = useState<Level>('main');
  // The part just set, for focus to come back to on the first menu.
  const [from, setFrom] = useState<Group | undefined>(undefined);
  const choices = filterChoices(entries, names, filter);
  const any = t('streams.filter.any');

  const change = (next: StreamFilter) => {
    setPreference('streamFilter', isFiltering(next) ? next : NO_FILTER);
    onChange?.();
  };
  const setPart = <K extends keyof StreamFilter>(key: K, value: StreamFilter[K] | undefined) => {
    const next: StreamFilter = { ...filter };
    if (value === undefined) delete next[key];
    else next[key] = value;
    change(next);
  };
  const up = () => {
    setFrom(level === 'main' ? undefined : level);
    setLevel('main');
  };

  if (level === 'main') {
    const options: MenuOption[] = [
      {
        value: 'resolution',
        label: t('streams.filter.quality'),
        detail: filter.resolution ? filterResolutionLabel(filter.resolution) : any,
      },
      {
        value: 'cached',
        label: t('streams.filter.cached'),
        detail: t(filter.cached ? 'common.on' : 'common.off'),
      },
      {
        value: 'addon',
        label: t('streams.filter.addon'),
        detail: filter.addonId !== undefined ? (names.get(filter.addonId) ?? filter.addonId) : any,
      },
      {
        value: 'language',
        label: t('streams.filter.language'),
        detail: filter.language !== undefined ? languageName(filter.language) : any,
      },
      { value: 'clear', label: t('streams.filter.clear') },
    ];
    return (
      <Menu
        key="main"
        focusKey={focusKey}
        title={t('streams.filter.title')}
        options={options}
        selected={undefined}
        landOn={from}
        returnFocusKey={returnFocusKey}
        onSelect={(value) => {
          if (value === 'cached') {
            setPart('cached', filter.cached ? undefined : true);
          } else if (value === 'clear') {
            change(NO_FILTER);
            onClose();
          } else {
            setLevel(value as Group);
          }
        }}
        onClose={onClose}
      />
    );
  }

  const count = (n: number) => t('streams.count', { count: n });
  const options: MenuOption[] = [{ value: ANY, label: any }];
  let title: string;
  let selected: string;
  if (level === 'resolution') {
    title = t('streams.filter.quality');
    selected = filter.resolution ?? ANY;
    for (const choice of choices.resolutions) {
      options.push({
        value: choice.value,
        label: filterResolutionLabel(choice.value),
        detail: count(choice.count),
      });
    }
  } else if (level === 'addon') {
    title = t('streams.filter.addon');
    selected = filter.addonId ?? ANY;
    for (const choice of choices.addons) {
      options.push({ value: choice.id, label: choice.name, detail: count(choice.count) });
    }
  } else {
    title = t('streams.filter.language');
    selected = filter.language ?? ANY;
    for (const choice of choices.languages) {
      options.push({
        value: choice.code,
        label: languageName(choice.code),
        detail: count(choice.count),
      });
    }
  }
  return (
    <Menu
      key={level}
      focusKey={`${focusKey}-${level}`}
      title={title}
      options={options}
      selected={selected}
      returnFocusKey={returnFocusKey}
      onSelect={(value) => {
        const part = value === ANY ? undefined : value;
        if (level === 'resolution') setPart('resolution', part as StreamFilter['resolution']);
        else if (level === 'addon') setPart('addonId', part);
        else setPart('language', part);
        up();
      }}
      onClose={up}
    />
  );
}
