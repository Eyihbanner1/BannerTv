import {
  eventState,
  type EventState,
  followTargets,
  localClock,
  localDate,
  MAX_REMINDERS,
  remindAt,
  type SportEvent,
} from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import type { TFunction } from 'i18next';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { eventPlay, push } from '../../app/router';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Artwork } from '../../components/Artwork';
import { Button } from '../../components/Button';
import { addonClient, addonCollection } from '../../data/addons';
import { itemSources } from '../../data/sports';
import { useQuery } from '../../data/use-query';
import { usePrefetch } from '../../player/prefetch';
import { dayName } from './fixture';
import { FIRST_FOLLOW_KEY, FollowButtons } from './FollowButtons';
import { useReminder } from './use-reminder';
import { useMinuteClock, useSportsFeed, useSportsMatcher, useViewOptions } from './use-sports';
import styles from './EventScreen.module.css';

function displayName(t: TFunction, event: SportEvent): string {
  return event.home !== undefined && event.away !== undefined
    ? t('sports.teams', { home: event.home, away: event.away })
    : event.title;
}

function whenText(t: TFunction, event: SportEvent, state: EventState, now: number): string {
  const at = event.kickOff?.at;
  const clock = at !== undefined ? localClock(at) : undefined;
  const day = at !== undefined ? localDate(at) : event.kickOff?.date;
  const dayText = day !== undefined ? dayName(t, day, now) : undefined;
  switch (state) {
    case 'live':
      return clock ? t('sports.liveSince', { time: clock }) : t('sports.liveNowLabel');
    case 'live-unknown':
      return t('sports.liveUnknown');
    case 'soon':
      return clock ? t('sports.soonAt', { time: clock }) : t('sports.soon');
    case 'ended':
      return t('sports.ended');
    case 'no-time':
      return t('sports.noTime');
    default:
      if (!dayText) return t('sports.noTime');
      if (!clock) return dayText;
      return t(event.kickOff?.sure === false ? 'sports.dayAbout' : 'sports.dayAt', {
        day: dayText,
        time: clock,
      });
  }
}

/** What the player shows while it starts: the event's name and the addon's background. */
function previewOf(name: string, event: SportEvent, background?: string): MetaPreview {
  const source = event.sources[0]!;
  const preview: MetaPreview = {
    id: source.id,
    type: source.type,
    name,
    posterShape: 'landscape',
    genres: [],
    trailers: [],
  };
  if (background) preview.background = background;
  if (source.poster) preview.poster = source.poster;
  return preview;
}

/**
 * The badges the addon sent for the two sides, home first as in the name.
 * Each side keeps its place, so a badge on its own still stands by its team.
 * Only the event page draws them: fixture tiles are text, and none is bundled.
 */
export function TeamBadges({ event }: { event: Pick<SportEvent, 'homeLogo' | 'awayLogo'> }) {
  const { homeLogo, awayLogo } = event;
  if (!homeLogo && !awayLogo) return null;
  return (
    <div className={styles.badges}>
      <div className={styles.badge}>
        {homeLogo && <Artwork key={homeLogo} src={homeLogo} className={styles.badgeImage} />}
      </div>
      <div className={styles.badge}>
        {awayLogo && <Artwork key={awayLogo} src={awayLogo} className={styles.badgeImage} />}
      </div>
    </div>
  );
}

/**
 * One match: teams, competition, local kick-off, state, which addons list
 * it, the addon's background and any team badges it sent. Watch uses the
 * automatic stream choice across every source; All streams lists them by
 * addon (docs/PLAN.md, Sports addons, Screens). Only the addons that listed
 * it are asked, for its page and its streams. A match still to come offers
 * Remind me, a banner shown just before kick-off while BannerTV is open.
 * Under them, its teams and competition can be followed.
 */
export function EventScreen({ event: opened }: { event: SportEvent }) {
  const { t } = useTranslation();
  const feed = useSportsFeed();
  const now = useMinuteClock();
  const view = useViewOptions(feed.events, now);
  useSportsMatcher();
  // The feed's copy, as matches gain sources or kick-offs while the page is open.
  const event = useMemo(
    () => feed.events.find((e) => e.key === opened.key) ?? opened,
    [feed.events, opened],
  );
  const collection = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the collection changes which addons are still there.
  const sources = useMemo(() => itemSources(event.sources), [event.sources, collection.addons]);
  const primary = sources[0];
  const metaQuery = useMemo(() => (primary ? addonClient.metaFrom(primary) : null), [primary]);
  const meta = useQuery(metaQuery).data;
  const { key, sources: listed, kind } = event;
  const play = useMemo(() => eventPlay({ key, sources: listed, kind }), [key, listed, kind]);
  const [resting, setResting] = useState(false);
  usePrefetch(primary?.type ?? '', primary && resting ? primary.id : null, undefined, play);

  const state = eventState(event, view);
  const name = displayName(t, event);
  const remind = useReminder(event, name, view.now);
  const background =
    meta?.background ?? event.sources.find((source) => source.background)?.background;
  const competition = [
    event.competition.name,
    event.competition.round,
    event.note && event.note !== event.competition.name ? event.note : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const badged = !!(event.homeLogo || event.awayLogo);
  const addonNames: string[] = [];
  for (const source of sources) {
    const addonName = source.addon.manifest.name;
    if (addonNames.indexOf(addonName) === -1) addonNames.push(addonName);
  }

  useScreenFocus(
    primary ? 'event-watch' : followTargets(event).length > 0 ? FIRST_FOLLOW_KEY : undefined,
  );

  const watch = (choose: boolean) => {
    if (!primary) return;
    const preview = previewOf(name, event, background);
    const route = {
      type: primary.type,
      metaId: primary.id,
      videoId: primary.id,
      preview,
      event: play,
    };
    push(choose ? { name: 'streams', ...route } : { name: 'player', ...route });
  };

  return (
    <section className={styles.event} aria-label={name}>
      <div className={styles.art}>
        {background && <Artwork key={background} src={background} className={styles.backdrop} />}
      </div>
      <div className={badged ? `${styles.info} ${styles.badged}` : styles.info}>
        <TeamBadges event={event} />
        <p className={styles.competition}>{competition}</p>
        <h1 className={styles.title}>{name}</h1>
        <p className={state === 'live' || state === 'live-unknown' ? styles.live : styles.when}>
          {whenText(t, event, state, view.now)}
        </p>
        {addonNames.length > 0 && (
          <p className={styles.sources}>
            {t('sports.listedBy', { names: addonNames.join(t('common.listSeparator')) })}
          </p>
        )}
        {meta?.description && <p className={styles.description}>{meta.description}</p>}
        {primary ? (
          <div className={styles.actions}>
            <Button
              focusKey="event-watch"
              label={t('details.watch')}
              variant="primary"
              onFocus={() => setResting(true)}
              onPress={() => watch(false)}
            />
            <Button
              focusKey="event-streams"
              label={t('details.allStreams')}
              onFocus={() => setResting(true)}
              onPress={() => watch(true)}
            />
            {remind.offered && (
              <Button
                focusKey="event-remind"
                label={t(remind.reminder ? 'sportsRemind.on' : 'sportsRemind.remind')}
                onPress={remind.toggle}
              />
            )}
            {remind.reminder && (
              <p className={styles.remindNote} role="status">
                {t('sportsRemind.tvNote', { time: localClock(remindAt(remind.reminder)) })}
              </p>
            )}
            {remind.full && (
              <p className={styles.remindNote} role="status">
                {t('sportsRemind.full', { count: MAX_REMINDERS })}
              </p>
            )}
          </div>
        ) : (
          <p className={styles.note}>{t('sports.addonGone')}</p>
        )}
        <FollowButtons event={event} />
      </div>
    </section>
  );
}
