import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';
import { colors } from './theme';

/** The spinner shows at least this long, so a quick refresh still reads as one. */
const MIN_SPIN_MS = 600;
/** And at most this long: rows go on filling in behind it. */
const MAX_SPIN_MS = 8000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pull to refresh for a list. `run` starts the reload and may return a promise for when it is
 * done; the spinner stays until then, within the limits above. Hand the result to the list's
 * `refreshControl`.
 */
export function usePullRefresh(
  run: () => Promise<unknown> | void,
): ReactElement<RefreshControlProps> {
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(run);
  const mounted = useRef(false);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    const started = Date.now();
    const done = Promise.resolve()
      .then(() => latest.current())
      .catch(() => undefined);
    void Promise.race([done, wait(MAX_SPIN_MS)])
      .then(() => wait(Math.max(0, MIN_SPIN_MS - (Date.now() - started))))
      .then(() => {
        if (mounted.current) setRefreshing(false);
      });
  }, []);
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.accent}
      colors={[colors.accent]}
      progressBackgroundColor={colors.surface2}
    />
  );
}
