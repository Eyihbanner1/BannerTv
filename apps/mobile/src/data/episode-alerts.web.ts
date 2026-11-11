import { episodeAlertsOn } from './episode-alerts-on';

/**
 * The web build's stand-in for episode-alerts.ts. A browser tab has no notifications scheduled
 * ahead, so nothing is scheduled here; the web build (for the journeys and development only)
 * keeps Settings' switch, saved for each profile as on the phone, so the journeys can check it.
 */

export { episodeAlertsOn };

/** There is no permission to ask for in the web build. */
export function allowEpisodeAlerts(): Promise<boolean> {
  return Promise.resolve(true);
}

export function episodeAlertsPermitted(): Promise<boolean> {
  return Promise.resolve(true);
}

export function useEpisodeAlerts(): void {
  // Nothing to keep in step.
}
