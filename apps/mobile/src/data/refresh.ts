import { accountState, syncAccountNow } from '@tv/data/sync';
import { syncTrakt } from '@tv/data/trakt';

/**
 * Pull to refresh's sync: the account's, when this screen is in one, and Trakt's, when the
 * profile is signed in there. Settles when both have, and never rejects.
 */
export function syncForRefresh(): Promise<void> {
  const account = accountState.get().status.state === 'off' ? undefined : syncAccountNow();
  return Promise.all([account, syncTrakt()]).then(
    () => undefined,
    () => undefined,
  );
}
