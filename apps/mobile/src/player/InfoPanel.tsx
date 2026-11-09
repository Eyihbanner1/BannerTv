import type { MetaPreview, Video } from '@bannertv/protocol';
import { formatClock } from '@tv/player/media';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { colors, space, type } from '../ui/theme';
import { endsAt } from './time-left';
import { useNow } from './use-now';

/** How often "Ends at" is worked out again while the video is paused and the clock moves on. */
const INFO_TICK_MS = 15 * 1000;

/**
 * What plays, over the picture, which keeps playing, as the TV's Info sheet has it: the title,
 * the episode's number and name, when it ends on the phone's clock at the speed playing ("Ends at
 * 22:41"), and what it is about. It asks for nothing: it shows what the player already has.
 */
export function InfoPanel({
  title,
  episode,
  item,
  position,
  duration,
  rate,
  live,
}: {
  title: string;
  /** The episode playing; none for a film. */
  episode?: Video | undefined;
  item?: MetaPreview | undefined;
  position: number;
  /** Seconds; 0 while unknown. */
  duration: number;
  rate: number;
  live: boolean;
}) {
  const { t } = useTranslation();
  const now = useNow(INFO_TICK_MS);
  const ends = endsAt(now, position, duration, rate, live);
  const number =
    episode?.season !== undefined && episode.episode !== undefined
      ? t('player.episodeNumber', { season: episode.season, episode: episode.episode })
      : undefined;
  const episodeLine = [number, episode?.title].filter(Boolean).join(' · ');
  const story = episode ? episode.overview || item?.description : item?.description;
  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {episodeLine ? <Text style={styles.episode}>{episodeLine}</Text> : null}
      {ends !== null ? (
        <Text style={styles.ends}>{t('player.endsAt', { time: formatClock(ends) })}</Text>
      ) : live ? (
        <Text style={styles.ends}>{t('player.liveBroadcast')}</Text>
      ) : null}
      {story ? <Text style={styles.story}>{story}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.s, paddingHorizontal: space.m, paddingBottom: space.l },
  title: { ...type.heading, color: colors.text },
  episode: { ...type.label, color: colors.textSoft },
  ends: { ...type.label, color: colors.accent },
  story: { ...type.body, color: colors.textMuted, marginTop: space.xs },
});
