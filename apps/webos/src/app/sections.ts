import { isKidsProfile } from '../data/profiles';
import { type Section, SECTIONS } from './router';

/**
 * The sections the rail shows. A kids profile has no Addons: installing or
 * removing addons is for the grown-ups. Fixed for the run, since switching
 * profile reloads the app.
 */
export function useVisibleSections(): readonly Section[] {
  return isKidsProfile() ? SECTIONS.filter((section) => section !== 'addons') : SECTIONS;
}
