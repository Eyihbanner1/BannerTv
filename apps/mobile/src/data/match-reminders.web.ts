/**
 * The web build's stand-in for match-reminders.ts. A browser tab has no
 * notifications scheduled ahead, so the web build (for the journeys and
 * development only) offers no Remind me.
 */

/** Whether this build can notify. */
export const canNotify = false;

export function allowReminders(): Promise<boolean> {
  return Promise.resolve(false);
}

export function useMatchReminders(): void {
  // Nothing to keep in step.
}
