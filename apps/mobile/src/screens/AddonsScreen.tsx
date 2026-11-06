import {
  type AddonHealth,
  type InstalledAddon,
  installIdOf,
  type SportsSetting,
} from '@bannertv/core';
import { addonBaseUrl } from '@bannertv/protocol';
import { addonCollection, addonHealth, addonPreview, checkAddon } from '@tv/data/addons';
import { describeInstallError, healthLine, typeLabel } from '@tv/data/describe';
import { mayHoldSports, setSportsSetting, sportsSetting, sportsState } from '@tv/data/sports';
import { syncOn } from '@tv/data/sync-clock';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useEffect, useState, useSyncExternalStore } from 'react';
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
import { addonLinks, takeAddonLink } from '../nav/addon-links';
import { reportTyping } from '../runtime/whereabouts';
import { Button } from '../ui/Button';
import { Icon } from '../ui/icons';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Sheet, SheetOption } from '../ui/Sheet';
import { colors, fallbackArt, radius, space, type } from '../ui/theme';

const RESOURCE_LABELS = [
  ['catalog', 'addons.resources.catalog'],
  ['meta', 'addons.resources.meta'],
  ['stream', 'addons.resources.stream'],
  ['subtitles', 'addons.resources.subtitles'],
] as const;

const SPORTS_SETTINGS: readonly SportsSetting[] = ['auto', 'yes', 'no'];

/**
 * What the link box is for: a new addon, or new settings for one already here. `offered` is a
 * link that came from outside the app (nav/addon-links.ts), asked about by name before adding.
 */
type Adding = { kind: 'new'; offered?: string } | { kind: 'settings'; addon: InstalledAddon };

function AddonCard({
  addon,
  index,
  count,
  health,
  onSettings,
  onSports,
}: {
  addon: InstalledAddon;
  index: number;
  count: number;
  /** How it last answered, when this phone has asked it. */
  health: AddonHealth | undefined;
  onSettings: (addon: InstalledAddon) => void;
  /** "Show in Sports", for an addon that could hold sport. */
  onSports?: (addon: InstalledAddon) => void;
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
  const [checking, setChecking] = useState(false);
  const answering = checking ? t('addonState.checking') : healthLine(t, health);
  const check = () => {
    if (checking) return;
    setChecking(true);
    void checkAddon(addon).finally(() => setChecking(false));
  };
  // In an account the addons are the account's, so removing one reaches every screen.
  const removeMessage = t(syncOn() ? 'addonState.removeEverywhere' : 'addons.removeMessage');
  const remove = () =>
    Alert.alert(t('addons.removeTitle', { name: manifest.name }), removeMessage, [
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
      {answering ? (
        <View style={styles.healthRow}>
          <Text
            style={[styles.health, !checking && health?.state === 'failed' && styles.failing]}
            accessibilityLiveRegion="polite"
          >
            {answering}
          </Text>
          <Button
            label={t('addonState.checkNow')}
            accessibilityLabel={t('addonState.checkNowLabel', { name: manifest.name })}
            kind="quiet"
            busy={checking}
            onPress={check}
          />
        </View>
      ) : null}
      {onSports ? (
        <Pressable
          onPress={() => onSports(addon)}
          accessibilityRole="button"
          style={styles.sportsRow}
          hitSlop={4}
        >
          <Text style={styles.sportsText}>
            {t('addons.sportsLabel', {
              name: manifest.name,
              value: t(`addons.sportsValue.${sportsSetting(addon)}`),
            })}
          </Text>
          <Icon name="chevron" size={20} color={colors.textSubtle} />
        </Pressable>
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
  const [sportsFor, setSportsFor] = useState<InstalledAddon | null>(null);
  const health = useSyncExternalStore(addonHealth.subscribe, addonHealth.get);
  // Read again as addons are detected as sports ones, which changes who gets the Sports row.
  useSyncExternalStore(sportsState.subscribe, sportsState.get);
  // The name of the addon an outside link is for, once its manifest has answered.
  const [named, setNamed] = useState<{ url: string; name: string } | null>(null);
  const offered = adding?.kind === 'new' ? adding.offered : undefined;
  const offeredName =
    offered !== undefined && named?.url === offered && link.trim() === offered
      ? named.name
      : undefined;

  // A link from outside the app fills the box: the new settings when the person went to the
  // addon's settings page from here, otherwise a new addon, asked about by name.
  useEffect(() => {
    const take = () => {
      const url = takeAddonLink();
      if (url === undefined) return;
      setLink(url);
      setProblem(undefined);
      setAdding((current) =>
        current?.kind === 'settings' ? current : { kind: 'new', offered: url },
      );
    };
    take();
    return addonLinks.subscribe(take);
  }, []);

  useEffect(() => {
    if (offered === undefined) return;
    let live = true;
    addonPreview(offered).then(
      (manifest) => {
        if (live) setNamed({ url: offered, name: manifest.name });
      },
      (error: unknown) => {
        if (live) setProblem(describeInstallError(t, error));
      },
    );
    return () => {
      live = false;
    };
  }, [offered, t]);

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
        // The cards also show how each addon answers, which the list itself does not hold.
        extraData={health}
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
            health={health.get(installIdOf(item))}
            onSettings={openSettings}
            {...(mayHoldSports(item) ? { onSports: setSportsFor } : {})}
          />
        )}
      />
      <Sheet
        visible={adding !== null}
        title={
          adding?.kind === 'settings'
            ? t('addons.configure.title', { name: adding.addon.manifest.name })
            : offeredName
              ? t('phone.addonLink.confirm', { name: offeredName })
              : t('addons.installTitle')
        }
        onClose={close}
        scroll={false}
      >
        <View style={styles.form}>
          <Text style={styles.lead}>
            {adding?.kind === 'settings'
              ? t('phone.configureLead')
              : offeredName
                ? t('phone.addonLink.lead')
                : offered !== undefined && !problem
                  ? t('addons.installing')
                  : t('phone.addonUrlHint')}
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
      <Sheet
        visible={sportsFor !== null}
        title={sportsFor ? t('addons.sportsTitle', { name: sportsFor.manifest.name }) : ''}
        onClose={() => setSportsFor(null)}
      >
        {sportsFor
          ? SPORTS_SETTINGS.map((value) => (
              <SheetOption
                key={value}
                label={t(`addons.sportsValue.${value}`)}
                selected={sportsSetting(sportsFor) === value}
                onPress={() => {
                  setSportsSetting(sportsFor, value);
                  setSportsFor(null);
                }}
              />
            ))
          : null}
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
  sportsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.s,
    paddingVertical: space.s,
  },
  sportsText: { ...type.label, color: colors.textMuted, flexShrink: 1 },
  healthRow: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  health: { ...type.label, color: colors.textMuted, flex: 1 },
  failing: { color: colors.danger },
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
