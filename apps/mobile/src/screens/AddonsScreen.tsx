import type { InstalledAddon } from '@bannertv/core';
import { addonBaseUrl } from '@bannertv/protocol';
import { addonCollection } from '@tv/data/addons';
import { describeInstallError, typeLabel } from '@tv/data/describe';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { reportTyping } from '../runtime/whereabouts';
import { Button } from '../ui/Button';
import { Icon } from '../ui/icons';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Sheet } from '../ui/Sheet';
import { colors, fallbackArt, radius, space, type } from '../ui/theme';

const RESOURCE_LABELS = [
  ['catalog', 'addons.resources.catalog'],
  ['meta', 'addons.resources.meta'],
  ['stream', 'addons.resources.stream'],
  ['subtitles', 'addons.resources.subtitles'],
] as const;

/** What the link box is for: a new addon, or new settings for one already here. */
type Adding = { kind: 'new' } | { kind: 'settings'; addon: InstalledAddon };

function AddonCard({
  addon,
  index,
  count,
  onSettings,
}: {
  addon: InstalledAddon;
  index: number;
  count: number;
  onSettings: (addon: InstalledAddon) => void;
}) {
  const { t } = useTranslation();
  const { manifest } = addon;
  const types = manifest.types.map((kind) => typeLabel(t, kind));
  const gives = RESOURCE_LABELS.filter(([resource]) =>
    manifest.resources.some((r) => r.name === resource),
  ).map(([, key]) => t(key));
  const summary = [types.join(t('common.listSeparator')), gives.join(t('common.listSeparator'))]
    .filter(Boolean)
    .join(' · ');
  const [from, to] = fallbackArt(manifest.id);
  const remove = () =>
    Alert.alert(t('addons.removeTitle', { name: manifest.name }), t('addons.removeMessage'), [
      { text: t('addons.keep'), style: 'cancel' },
      {
        text: t('addons.remove'),
        style: 'destructive',
        onPress: () => addonCollection.remove(addon.transportUrl),
      },
    ]);
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={[styles.logo, { backgroundColor: from, borderColor: to }]}>
          {manifest.logo ? (
            <Image source={manifest.logo} style={styles.logoImage} contentFit="contain" />
          ) : (
            <Text style={styles.logoLetter}>{manifest.name.slice(0, 1).toUpperCase()}</Text>
          )}
        </View>
        <View style={styles.cardText}>
          <Text style={styles.name} numberOfLines={2}>
            {manifest.name}
          </Text>
          <Text style={styles.small}>
            {[
              t('addons.version', { version: manifest.version }),
              addon.official ? t('addons.default') : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      </View>
      {summary ? <Text style={styles.summary}>{summary}</Text> : null}
      {manifest.description ? (
        <Text style={styles.description} numberOfLines={4}>
          {manifest.description}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          onPress={() => addonCollection.move(addon.transportUrl, -1)}
          disabled={index === 0}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('addons.moveUp', { name: manifest.name })}
          style={[styles.iconButton, index === 0 && styles.disabled]}
        >
          <Icon name="up" />
        </Pressable>
        <Pressable
          onPress={() => addonCollection.move(addon.transportUrl, 1)}
          disabled={index === count - 1}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('addons.moveDown', { name: manifest.name })}
          style={[styles.iconButton, index === count - 1 && styles.disabled]}
        >
          <Icon name="down" />
        </Pressable>
        <View style={styles.spacer} />
        {manifest.behaviorHints.configurable ? (
          <Button
            label={t('addons.settings')}
            accessibilityLabel={t('addons.settingsLabel', { name: manifest.name })}
            onPress={() => onSettings(addon)}
          />
        ) : null}
        <Button
          label={t('addons.remove')}
          accessibilityLabel={t('addons.removeLabel', { name: manifest.name })}
          kind="danger"
          onPress={remove}
        />
      </View>
    </View>
  );
}

/**
 * The addons on this phone, shared by every profile. A link is pasted in to add one; an addon
 * with settings opens its page in the browser and its new link is pasted back the same way.
 */
export function AddonsScreen({ startAdding = false }: { startAdding?: boolean }) {
  const { t } = useTranslation();
  const collection = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  const [adding, setAdding] = useState<Adding | null>(startAdding ? { kind: 'new' } : null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const close = () => {
    setAdding(null);
    setLink('');
    setProblem(undefined);
    reportTyping(false);
  };
  const openSettings = (addon: InstalledAddon) => {
    setAdding({ kind: 'settings', addon });
    setLink('');
    setProblem(undefined);
    void Linking.openURL(`${addonBaseUrl(addon.transportUrl)}/configure`).catch(() => undefined);
  };
  const paste = async () => {
    const text = await Clipboard.getStringAsync().catch(() => '');
    if (text) setLink(text.trim());
  };
  const install = async () => {
    if (!adding || busy || !link.trim()) return;
    setBusy(true);
    setProblem(undefined);
    const before = collection.addons.map((addon) => addon.transportUrl);
    try {
      const addon = await addonCollection.install(
        link.trim(),
        adding.kind === 'settings' ? { replaces: adding.addon.transportUrl } : undefined,
      );
      const name = addon.manifest.name;
      setNotice(
        adding.kind === 'settings'
          ? t('addons.configure.updated', { name })
          : before.includes(addon.transportUrl)
            ? t('addons.updated', { name })
            : t('addons.added', { name }),
      );
      close();
    } catch (error) {
      setProblem(describeInstallError(t, error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={t('phone.addons')}
        right={
          <Pressable
            onPress={() => setAdding({ kind: 'new' })}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('addons.add')}
          >
            <Icon name="plus" />
          </Pressable>
        }
      />
      <FlatList
        data={collection.addons}
        keyExtractor={(addon) => addon.transportUrl}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.lead}>{notice ?? t('phone.addonsLead')}</Text>
            <Button
              label={t('addons.add')}
              icon="plus"
              kind="primary"
              onPress={() => setAdding({ kind: 'new' })}
            />
          </View>
        }
        ListEmptyComponent={
          collection.ready ? <Text style={styles.lead}>{t('addons.none')}</Text> : undefined
        }
        renderItem={({ item, index }) => (
          <AddonCard
            addon={item}
            index={index}
            count={collection.addons.length}
            onSettings={openSettings}
          />
        )}
      />
      <Sheet
        visible={adding !== null}
        title={
          adding?.kind === 'settings'
            ? t('addons.configure.title', { name: adding.addon.manifest.name })
            : t('addons.installTitle')
        }
        onClose={close}
        scroll={false}
      >
        <View style={styles.form}>
          <Text style={styles.lead}>
            {adding?.kind === 'settings' ? t('phone.configureLead') : t('phone.addonUrlHint')}
          </Text>
          <TextInput
            value={link}
            onChangeText={setLink}
            placeholder={t('addons.addressPlaceholder')}
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
            onFocus={() => reportTyping(true)}
            onBlur={() => reportTyping(false)}
            onSubmitEditing={() => void install()}
            returnKeyType="go"
            accessibilityLabel={t('addons.addressLabel')}
          />
          {problem ? <Text style={styles.problem}>{problem}</Text> : null}
          <View style={styles.formButtons}>
            <Button label={t('phone.paste')} onPress={() => void paste()} style={styles.grow} />
            <Button
              label={
                adding?.kind === 'settings' ? t('addons.configure.update') : t('addons.install')
              }
              kind="primary"
              busy={busy}
              disabled={!link.trim()}
              onPress={() => void install()}
              style={styles.grow}
            />
          </View>
          {adding?.kind === 'settings' ? (
            <Button
              label={t('phone.openSettingsAgain')}
              kind="quiet"
              onPress={() =>
                void Linking.openURL(`${addonBaseUrl(adding.addon.transportUrl)}/configure`).catch(
                  () => undefined,
                )
              }
            />
          ) : null}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: space.l, paddingBottom: space.xxl * 2, gap: space.m },
  header: { gap: space.m, paddingBottom: space.s },
  lead: { ...type.body, color: colors.textMuted },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radius.l,
    padding: space.l,
    gap: space.s,
  },
  cardTop: { flexDirection: 'row', gap: space.m, alignItems: 'center' },
  logo: {
    width: 52,
    height: 52,
    borderRadius: radius.m,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImage: { width: 44, height: 44 },
  logoLetter: { ...type.title, color: colors.text },
  cardText: { flex: 1, gap: 2 },
  name: { ...type.heading, color: colors.text },
  small: { ...type.small, color: colors.textMuted },
  summary: { ...type.label, color: colors.accent },
  description: { ...type.body, color: colors.textMuted },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingTop: space.s },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface3,
  },
  disabled: { opacity: 0.35 },
  spacer: { flex: 1 },
  form: { padding: space.l, gap: space.m },
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface3,
    borderRadius: radius.m,
    paddingHorizontal: space.l,
    paddingVertical: space.m,
  },
  problem: { ...type.body, color: colors.danger },
  formButtons: { flexDirection: 'row', gap: space.m },
  grow: { flex: 1 },
});
