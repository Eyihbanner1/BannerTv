import type { MetaPreview } from '@bannertv/protocol';
import { metaFacts } from '@tv/data/describe';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Artwork } from './Artwork';
import { Button } from './Button';
import { colors, space, type } from './theme';
import { phoneArt } from './Tile';

/** The big picture at the top of Home: what to continue, or the first row's first title. */
export function Hero({
  item,
  playLabel,
  onPlay,
  onDetails,
}: {
  item: MetaPreview | null;
  playLabel?: string;
  onPlay?: () => void;
  onDetails: (item: MetaPreview) => void;
}) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const height = Math.round((width * 10) / 9);
  if (!item) {
    return (
      <View style={[styles.hero, { height }]}>
        <Text style={styles.loading}>{t('home.heroLoading')}</Text>
      </View>
    );
  }
  const picture = item.background ?? item.poster;
  const facts = metaFacts(t, item).join(' · ');
  const genres = item.genres.slice(0, 3).join(' · ');
  return (
    <View style={[styles.hero, { height }]}>
      <Artwork
        key={item.id}
        src={phoneArt(picture)}
        retrySrc={picture}
        seed={item.id}
        style={StyleSheet.absoluteFill}
        transition={300}
      />
      <LinearGradient
        colors={['rgba(11,8,21,0)', 'rgba(11,8,21,0.55)', colors.bg]}
        locations={[0.35, 0.7, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.content}>
        {item.logo ? (
          <Artwork
            key={item.logo}
            src={phoneArt(item.logo)}
            retrySrc={item.logo}
            seed={`${item.id}-logo`}
            contentFit="contain"
            backdrop={false}
            style={styles.logo}
            fallback={<Text style={styles.name}>{item.name}</Text>}
          />
        ) : (
          <Text style={styles.name} numberOfLines={2}>
            {item.name}
          </Text>
        )}
        {facts || genres ? (
          <Text style={styles.facts} numberOfLines={1}>
            {[facts, genres].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        <View style={styles.buttons}>
          {onPlay && playLabel ? (
            <Button label={playLabel} icon="play" kind="primary" onPress={onPlay} />
          ) : null}
          <Button
            label={t('home.details')}
            kind={onPlay ? 'secondary' : 'primary'}
            onPress={() => onDetails(item)}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { width: '100%', justifyContent: 'flex-end', backgroundColor: colors.surface1 },
  loading: { ...type.body, color: colors.textMuted, padding: space.xl },
  content: { padding: space.l, gap: space.s },
  logo: { width: '70%', height: 72, backgroundColor: 'transparent' },
  name: { ...type.display, color: colors.text },
  facts: { ...type.small, color: colors.textMuted },
  buttons: { flexDirection: 'row', gap: space.s, marginTop: space.s },
});
