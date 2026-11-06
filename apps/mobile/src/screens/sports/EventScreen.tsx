import {
  eventState,
  type EventState,
  localClock,
  localDate,
  MAX_REMINDERS,
  remindAt,
  type SportEvent,
} from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { addonClient, addonCollection } from '@tv/data/addons';
import { itemSources } from '@tv/data/sports';
import { useQuery } from '@tv/data/use-query';
import { usePrefetch } from '@tv/player/prefetch';
import { dayName } from '@tv/screens/sports/fixture';
import { useReminder } from '@tv/screens/sports/use-reminder';
import type { TFunction } from 'i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { allowReminders, canNotify } from '../../data/match-reminders';
import { eventPlay, goBack, openPlayer, openStreams } from '../../nav/routes';
import { Artwork } from '../../ui/Artwork';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { colors, space, type } from '../../ui/theme';
import { FollowButtons } from './FollowButtons';
import { useMinuteClock, useOnShow, useSportsFeed, useViewOptions } from './use-sports';

// The TV's event page helpers (apps/webos/src/screens/sports/EventScreen.tsx), which sits
// beside code the phone can't load.

function displayName(t: TFunction, event: SportEvent): string {
  return event.home !== undefined && event.away !== undefined
    ? t('sports.teams', { home: event.home, away: event.away })
    : event.title;
}

export function whenText(t: TFunction, event: SportEvent, state: EventState, now: number): string {
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

/** The badges the addon sent for the two sides, home first as in the name. */
function TeamBadges({ event }: { event: Pick<SportEvent, 'homeLogo' | 'awayLogo'> }) {
  const { homeLogo, awayLogo } = event;
  if (!homeLogo && !awayLogo) return null;
  return (
    <View style={styles.badges}>
      {[homeLogo, awayLogo].map((logo, index) => (
        <View key={index} style={styles.badge}>
          {logo ? (
            <Artwork
              src={logo}
              seed={logo}
              contentFit="contain"
              backdrop={false}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}

/**
 * One match: teams, competition, local kick-off, state, which addons list it, the addon's
 * background and any badges. Watch picks a stream across every source; All streams lists them.
 * Only the addons that listed it are asked, for its page and its streams. A match still to come
 * offers Remind me, a notification just before kick-off. Its teams and competition can be followed.
 */
export function EventScreen({ event: opened }: { event: SportEvent }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const feed = useSportsFeed();
  const now = useMinuteClock(useOnShow());
  const view = useViewOptions(feed.events, now);
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
  // Opening the page is the intent to watch: streams are looked up straight away.
  usePrefetch(primary?.type ?? '', primary ? primary.id : null, undefined, play);

  const state = eventState(event, view);
  const live = state === 'live' || state === 'live-unknown';
  const name = displayName(t, event);
  // The phone asks to notify at the first Remind me only, and says so if it may not.
  const [denied, setDenied] = useState(false);
  const remind = useReminder(event, name, view.now, async () => {
    const allowed = await allowReminders();
    setDenied(!allowed);
    return allowed;
  });
  const background =
    meta?.background ?? event.sources.find((source) => source.background)?.background;
  const competition = [
    event.competition.name,
    event.competition.round,
    event.note && event.note !== event.competition.name ? event.note : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const addonNames: string[] = [];
  for (const source of sources) {
    const addonName = source.addon.manifest.name;
    if (addonNames.indexOf(addonName) === -1) addonNames.push(addonName);
  }

  const watch = (choose: boolean) => {
    if (!primary) return;
    const route = {
      type: primary.type,
      metaId: primary.id,
      videoId: primary.id,
      preview: previewOf(name, event, background),
      event: play,
    };
    if (choose) openStreams(route);
    else openPlayer(route);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: space.xxl }}>
      <View style={{ height: Math.round((width * 9) / 16) }}>
        <Artwork src={background} seed={event.key} style={StyleSheet.absoluteFill} />
        <LinearGradient
          colors={['rgba(11,8,21,0.35)', 'rgba(11,8,21,0)', colors.bg]}
          locations={[0, 0.3, 1]}
          style={StyleSheet.absoluteFill}
        />
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          style={[styles.back, { top: insets.top + space.s }]}
          hitSlop={8}
        >
          <Icon name="back" />
        </Pressable>
      </View>
      <View style={styles.body}>
        <TeamBadges event={event} />
        {competition ? <Text style={styles.competition}>{competition}</Text> : null}
        <Text style={styles.name} accessibilityRole="header">
          {name}
        </Text>
        <Text style={live ? styles.live : styles.when}>{whenText(t, event, state, view.now)}</Text>
        {addonNames.length > 0 ? (
          <Text style={styles.facts}>
            {t('sports.listedBy', { names: addonNames.join(t('common.listSeparator')) })}
          </Text>
        ) : null}
        {primary ? (
          <View style={styles.actions}>
            <Button
              kind="primary"
              icon="play"
              label={t('details.watch')}
              onPress={() => watch(false)}
              style={styles.wide}
            />
            <Button
              icon="layers"
              label={t('details.allStreams')}
              onPress={() => watch(true)}
              style={styles.wide}
            />
            {canNotify && remind.offered ? (
              <Button
                icon={remind.reminder ? 'check' : 'bell'}
                label={t(remind.reminder ? 'sportsRemind.on' : 'sportsRemind.remind')}
                onPress={remind.toggle}
                style={styles.wide}
              />
            ) : null}
            {remind.reminder ? (
              <Text style={styles.facts} accessibilityLiveRegion="polite">
                {t('phone.reminders.note', { time: localClock(remindAt(remind.reminder)) })}
              </Text>
            ) : null}
            {remind.full || denied ? (
              <Text style={styles.facts} accessibilityLiveRegion="polite">
                {remind.full
                  ? t('sportsRemind.full', { count: MAX_REMINDERS })
                  : t('phone.reminders.denied')}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={styles.facts}>{t('sports.addonGone')}</Text>
        )}
        <FollowButtons event={event} />
        {meta?.description ? <Text style={styles.description}>{meta.description}</Text> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  back: {
    position: 'absolute',
    left: space.l,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { paddingHorizontal: space.l, gap: space.s, marginTop: -space.xl },
  badges: { flexDirection: 'row', gap: space.l, marginBottom: space.s },
  badge: { width: 56, height: 56 },
  competition: { ...type.label, color: colors.textSubtle },
  name: { ...type.display, color: colors.text },
  when: { ...type.body, color: colors.textMuted },
  live: { ...type.label, color: '#FF6B86' },
  facts: { ...type.small, color: colors.textSubtle },
  actions: { gap: space.s, marginTop: space.m, marginBottom: space.s },
  wide: { alignSelf: 'stretch' },
  description: { ...type.body, color: colors.textMuted, marginTop: space.s },
});
