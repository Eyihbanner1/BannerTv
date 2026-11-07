import { holdAddonLink } from '../nav/addon-links';

/**
 * Links from outside the app (bannertv://…) open Home, never a screen inside it: screens such as
 * the account and Addons are for Main or the grown-ups. An addon's install link (stremio://…, or
 * an address that names its manifest) is the one exception: it is held in memory, never put in
 * the route (it can carry keys), and Addons opens to ask before adding it once a grown-up profile
 * is in use (nav/use-addon-links.ts). Such a link leaves the app where it is when it is running.
 */
export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string | null {
  try {
    if (holdAddonLink(path)) return initial ? '/' : null;
  } catch {
    // A link that cannot be read opens Home, as any other.
  }
  return '/';
}
