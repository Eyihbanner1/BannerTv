import { useSyncExternalStore } from 'react';
import { isKidsProfile } from '../data/profiles';
import { sportsState } from '../data/sports';
import { type Section, SECTIONS } from './router';

/**
 * Whether a section is in the rail now. Sports shows only while an installed
 * addon has sports catalogs (docs/PLAN.md, Sports addons, Screens). A kids
 * profile has neither Sports nor Addons: installing or removing addons is for
 * the grown-ups, and that profile is fixed for the run, since switching
 * profile reloads the app. Rules for other sections go here too, so the rail
 * and the screens agree.
 */
export function sectionShown(section: Section): boolean {
  if (section === 'sports') return sportsState.get().shown && !isKidsProfile();
  if (section === 'addons') return !isKidsProfile();
  return true;
}

function visibleSections(): string {
  return SECTIONS.filter(sectionShown).join(' ');
}

/** The rail's sections, in order, as they are shown now. */
export function useVisibleSections(): readonly Section[] {
  // A string snapshot, so the rail re-renders only when the list changes.
  const list = useSyncExternalStore(sportsState.subscribe, visibleSections);
  return list.split(' ') as Section[];
}
