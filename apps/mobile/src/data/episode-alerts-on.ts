import { activeProfileId, profiles } from '@tv/data/profiles';
import { localStorage } from '../runtime/web-globals';
import { alertSwitchStore } from './episode-alerts-store';

/**
 * Settings' New episode alerts switch for the profile in use, kept in the phone's storage.
 * Shared by the phone's alerts (episode-alerts.ts) and the web build's stand-in.
 */
export const episodeAlertsOn = alertSwitchStore(localStorage, activeProfileId, () =>
  profiles.get().profiles.map((profile) => profile.id),
);
