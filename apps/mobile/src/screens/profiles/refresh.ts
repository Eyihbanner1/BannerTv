import { refreshAccount } from '@tv/data/sync';
import { useCallback, useState } from 'react';

/** How long pull to refresh shows its spinner at most, when the service is slow to answer. */
const MAX_SPIN_MS = 8000;

/**
 * Pull to refresh on a screen that shows the account's profiles (item A8): asks the account for
 * what changed on other screens, and stops spinning once it has, or after a few seconds.
 */
export function useAccountRefresh(): { refreshing: boolean; onRefresh: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, MAX_SPIN_MS);
    });
    void Promise.race([refreshAccount().catch(() => undefined), late]).then(() => {
      clearTimeout(timer);
      setRefreshing(false);
    });
  }, []);
  return { refreshing, onRefresh };
}
