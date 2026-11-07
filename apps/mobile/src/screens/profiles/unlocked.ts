/**
 * The profile whose PIN was just entered on Settings, Profiles, so its page does not ask for it
 * again (the TV passes this on its route). Held in memory, never in the route: a link into the
 * app must not open a locked profile's page.
 */
let unlocked: string | null = null;

export function unlockForEdit(id: string | null): void {
  unlocked = id;
}

export function unlockedForEdit(id: string): boolean {
  return unlocked === id;
}
