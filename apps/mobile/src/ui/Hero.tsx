import { phone } from '@brand/tokens/design';
import type { MetaPreview } from '@bannertv/protocol';
import { metaFacts } from '@tv/data/describe';
import { library } from '@tv/data/library';
import { useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Artwork } from './Artwork';
import { Button } from './Button';
import { colors, gutter, space, type } from './theme';
import { phoneArt } from './Tile';

/** The panel under the picture: title, facts and the two buttons. */
const PANEL_HEIGHT = 136;

/**
 * The card at the top of Home: what to continue, or the first row's first title. The picture
 * opens Details; Play plays when there is something to play, and My List keeps the title.
 */
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
  useSyncExternalStore(library.subscribe, library.version);
  useEffect(() => {
    void library.load().catch(() => undefined);
  }, []);
  if (!item) {
    return (
      <View style={styles.card}>
        <Text style={styles.loading}>{t('home.heroLoading')}</Text>
      </View>
    );
  }
  const picture = item.background ?? item.poster;
  const facts = [...metaFacts(t, item), ...item.genres.slice(0, 1)].join(' · ');
  const saved = library.has(item.id);
  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => onDetails(item)}
        accessibilityRole="button"
        accessibilityLabel={item.name}
        style={styles.picture}
      >
        <Artwork
          key={item.id}
          src={phoneArt(picture)}
          retrySrc={picture}
          seed={item.id}
          style={StyleSheet.absoluteFill}
          transition={200}
        />
      </Pressable>
      <View style={styles.panel}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        {facts ? (
          <Text style={styles.facts} numberOfLines={1}>
            {facts}
          </Text>
        ) : null}
        <View style={styles.buttons}>
          {onPlay && playLabel ? (
            <Button
              label={playLabel}
              icon="play"
              kind="play"
              accessibilityLabel={`${playLabel} ${item.name}`}
              onPress={onPlay}
              style={styles.main}
            />
          ) : (
            <Button
              label={t('home.details')}
              kind="play"
              onPress={() => onDetails(item)}
              style={styles.main}
            />
          )}
          <Button
            icon={saved ? 'check' : 'plus'}
            label={t('phone.tabs.library')}
            accessibilityLabel={
              saved
                ? t('library.removeLabel', { name: item.name })
                : t('library.addLabel', { name: item.name })
            }
            onPress={() => void (saved ? library.remove(item.id) : library.add(item))}
            style={styles.list}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: gutter,
    marginTop: space.s,
    height: phone.heroH,
    borderRadius: phone.heroRadius,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  loading: { ...type.body, color: colors.textMuted, padding: space.xl },
  picture: { flex: 1 },
  panel: {
    height: PANEL_HEIGHT,
    padding: 18,
    gap: space.s,
    backgroundColor: colors.sheet,
    justifyContent: 'flex-end',
  },
  name: { ...type.title, color: colors.text },
  facts: { ...type.label, fontWeight: '500', color: colors.textMuted },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 2 },
  main: { flex: 1 },
  list: { minWidth: 120 },
});
