/**
 * Links from outside the app (bannertv://…) open Home, never a screen inside it: screens such as
 * the account and Addons are for Main or the grown-ups, and the app takes no links yet.
 */
export function redirectSystemPath(): string {
  return '/';
}
