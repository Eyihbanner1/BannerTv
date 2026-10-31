import { type ContinueItem, continueWatching, kidsTitleAllowed } from '@bannertv/core';
import { cardsMissing, fillPlayedCards, onCardAnswer } from '@tv/data/continue';
import { playedVideos, progress } from '@tv/data/playback';
import { isKidsProfile } from '@tv/data/profiles';
import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Continue Watching, as the TV's useContinueItems (screens/home/ContinueRow.tsx, which is
 * remote-driven and cannot be shared): the list from core, worked out again on each change and
 * on the hour, so an episode that airs while the app is open joins it.
 */
const HOUR_MS = 60 * 60 * 1000;
/** How long after launch the row waits for titles whose cards are still being fetched. */
const CARD_WAIT_MS = 3000;
const launchedAt = Date.now();

const sameTitles = (a: readonly ContinueItem[], b: readonly ContinueItem[]) =>
  a.length === b.length &&
  a.every((item, index) => {
    const other = b[index]!;
    return (
      item.videoId === other.videoId &&
      item.startAt === other.startAt &&
      item.progress === other.progress &&
      item.upNext === other.upNext
    );
  });

let latest: { versions: string; hour: number; items: ContinueItem[] } | null = null;

function snapshot(): ContinueItem[] {
  const now = Date.now();
  const versions = `${progress.version()}:${playedVideos.version()}`;
  const hour = Math.floor(now / HOUR_MS);
  if (latest && latest.versions === versions && latest.hour === hour) return latest.items;
  let items = continueWatching(progress, playedVideos.get, now);
  if (isKidsProfile()) items = items.filter((item) => kidsTitleAllowed(item.preview, true));
  if (latest && sameTitles(items, latest.items)) items = latest.items;
  latest = { versions, hour, items };
  return items;
}

function subscribe(listener: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onTheHour = () => {
    timer = setTimeout(
      () => {
        listener();
        onTheHour();
      },
      HOUR_MS - (Date.now() % HOUR_MS) + 1000,
    );
  };
  onTheHour();
  const undo = [progress.subscribe(listener), playedVideos.subscribe(listener)];
  return () => {
    clearTimeout(timer);
    undo.forEach((stop) => stop());
  };
}

/** The titles to continue, or null until saved progress has been read. */
export function useContinueItems(): ContinueItem[] | null {
  const items = useSyncExternalStore(subscribe, snapshot);
  const [loaded, setLoaded] = useState(false);
  const [waited, setWaited] = useState(() => Date.now() - launchedAt >= CARD_WAIT_MS);

  useEffect(() => {
    let live = true;
    void Promise.all([progress.load(), playedVideos.load()])
      .catch(() => undefined)
      .then(() => {
        if (!live) return;
        setLoaded(true);
        fillPlayedCards();
      });
    const stop = playedVideos.subscribe(() => fillPlayedCards());
    return () => {
      live = false;
      stop();
    };
  }, []);

  useEffect(() => {
    if (waited) return;
    const done = () => setWaited(true);
    const timer = setTimeout(done, Math.max(0, CARD_WAIT_MS - (Date.now() - launchedAt)));
    const stop = onCardAnswer(() => {
      if (!cardsMissing()) done();
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [waited]);

  if (!loaded) return null;
  // Just after launch, an empty row may only be waiting for its cards: don't let it pop in.
  if (items.length === 0 && !waited && cardsMissing()) return null;
  return items;
}
