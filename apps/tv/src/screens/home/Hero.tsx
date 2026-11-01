import type { MetaPreview } from '@bannertv/protocol';
import { metaFacts } from '@tv/data/describe';
import { library } from '@tv/data/library';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../ui/Button';
import { tvArt } from '../../ui/Tile';
import { color, easing, layout, motion, px, spacing, type } from '../../ui/theme';

export interface HeroTitle {
  item: MetaPreview;
  /** The small line above the title: the row it came from. */
  eyebrow: string;
  /** Play goes straight to the player for a film or Continue Watching; a series opens its page. */
  play: () => void;
  playLabel: string;
}

/** The picture behind Home, crossfaded natively by expo-image as the focused title changes. */
export function HeroBackdrop({ item }: { item: MetaPreview | null }) {
  const art = item?.background ?? item?.poster;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {art ? (
        <Image
          source={{ uri: tvArt(art) ?? art }}
          style={styles.backdrop}
          contentFit="cover"
          transition={motion.heroFade}
          cachePolicy="memory-disk"
          accessible={false}
        />
      ) : null}
      <LinearGradient
        colors={[color.bg, 'rgba(11,8,21,0.85)', 'rgba(11,8,21,0)']}
        locations={[0, 0.35, 0.7]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(11,8,21,0)', color.bg]}
        locations={[0.45, 0.8]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/** What the focused title is, at the top left: eyebrow, name, facts, a few lines, two buttons. */
export function HeroText({
  hero,
  onButtonFocus,
  preferred = false,
  compact = false,
  onPlay,
}: {
  hero: HeroTitle | null;
  onButtonFocus: () => void;
  /** The first button takes focus, as when Home opens or is on top again. */
  preferred?: boolean;
  /** The remote is on the rows below: the description goes, to give them room. */
  compact?: boolean;
  /** Called before the first button's action, so Home knows to come back to it. */
  onPlay?: () => void;
}) {
  const { t } = useTranslation();
  useSyncExternalStore(library.subscribe, library.version);
  const [fade] = useState(() => new Animated.Value(1));
  const id = hero?.item.id;
  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, {
      toValue: 1,
      duration: motion.heroFade,
      easing: easing.decelerate,
      useNativeDriver: true,
    }).start();
  }, [id, fade]);
  const box = compact ? styles.textCompact : styles.text;
  if (!hero) return <View style={box} />;
  const { item } = hero;
  const facts = metaFacts(t, item).join(' · ');
  const saved = library.has(item.id);
  return (
    <View style={box}>
      <Animated.View style={[styles.words, { opacity: fade }]}>
        <Text style={styles.eyebrow} numberOfLines={1}>
          {hero.eyebrow}
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {item.name}
        </Text>
        {facts ? (
          <Text style={styles.meta} numberOfLines={1}>
            {facts}
          </Text>
        ) : null}
        {item.description && !compact ? (
          <Text style={styles.description} numberOfLines={3}>
            {item.description}
          </Text>
        ) : null}
      </Animated.View>
      <View style={styles.buttons}>
        <Button
          kind="primary"
          icon="play"
          label={hero.playLabel}
          onPress={() => {
            onPlay?.();
            hero.play();
          }}
          onFocus={onButtonFocus}
          preferred={preferred}
        />
        <Button
          icon={saved ? 'check' : 'plus'}
          label={t(saved ? 'tv.onMyList' : 'tv.myList')}
          onPress={() => void (saved ? library.remove(item.id) : library.add(item))}
          onFocus={onButtonFocus}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, right: 0, width: '72%', height: '82%' },
  text: {
    marginLeft: layout.heroLeft,
    width: layout.heroWidth,
    minHeight: px(470),
    justifyContent: 'flex-end',
    gap: spacing.xl,
  },
  textCompact: {
    marginLeft: layout.heroLeft,
    width: layout.heroWidth,
    justifyContent: 'flex-end',
    gap: spacing.xl,
  },
  words: { gap: spacing.md },
  eyebrow: { ...type.meta, color: color.accent, textTransform: 'uppercase', letterSpacing: 2 },
  title: { ...type.heroTitle, color: color.text },
  meta: { ...type.meta, color: color.textSoft },
  description: { ...type.body, color: color.textMuted },
  buttons: { flexDirection: 'row', gap: spacing.lg },
});
