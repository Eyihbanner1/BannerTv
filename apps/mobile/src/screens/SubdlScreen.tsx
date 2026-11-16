import {
  removeSubdlKey,
  saveSubdlKey,
  setSubdlKeyState,
  subdl,
  SUBDL_KEY_PAGE,
  subdlKey,
  subdlUsage,
} from '@tv/data/subdl';
import { type SubdlNotice, subdlStatus } from '@tv/screens/settings/subdl-status';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { reportTyping } from '../runtime/whereabouts';
import { Button } from '../ui/Button';
import { ScreenHeader } from '../ui/ScreenHeader';
import { colors, radius, space, type } from '../ui/theme';

/** "Check again" is offered at most this often, as on the TV. */
const CHECK_AGAIN_MS = 10_000;

const restWhy = () => subdlUsage.resting()?.why ?? null;

/**
 * Settings > SubDL subtitles, as the TV's screen (apps/webos SubdlScreen) without the code to
 * scan: a link to SubDL's API page instead, and a password field that starts empty and is
 * emptied once the key is saved, so the key is never shown.
 */
export function SubdlScreen() {
  const { t } = useTranslation();
  const record = useSyncExternalStore(subdlKey.subscribe, subdlKey.get);
  const rest = useSyncExternalStore(subdlUsage.subscribe, restWhy);
  const [text, setText] = useState('');
  const [notice, setNotice] = useState<SubdlNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const checking = useRef(false);
  const lastCheck = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const check = async (key: string) => {
    if (checking.current) return;
    checking.current = true;
    lastCheck.current = Date.now();
    setBusy(true);
    setNotice('checking');
    const answer = await subdl.checkKey(key);
    checking.current = false;
    if (answer !== 'unreachable') setSubdlKeyState(key, answer);
    if (!mounted.current) return;
    setBusy(false);
    // A key removed while it was checked stays removed, and says so.
    if (subdlKey.get()?.key === key) setNotice(answer);
  };

  const save = () => {
    if (checking.current) return;
    if (saveSubdlKey(text) === 'bad') {
      setNotice('badFormat');
      return;
    }
    setText('');
    const key = subdlKey.get()?.key;
    if (key) void check(key);
  };

  const checkAgain = () => {
    const key = subdlKey.get()?.key;
    if (!key || Date.now() - lastCheck.current < CHECK_AGAIN_MS) return;
    void check(key);
  };

  const status = subdlStatus(notice, record?.state ?? null, rest);
  const problem =
    status === 'badFormat' ||
    status === 'refused' ||
    status === 'unreachable' ||
    status === 'resting' ||
    status === 'usedUp';

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('subdl.title')} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>{t('subdl.lead')}</Text>
        <View style={styles.card}>
          <Text style={styles.lead}>{t('phone.subdlGetKey')}</Text>
          <Button
            label={t('phone.subdlOpenSite')}
            onPress={() => void Linking.openURL(SUBDL_KEY_PAGE).catch(() => undefined)}
          />
        </View>
        <View style={styles.card} accessibilityLiveRegion="polite">
          {record ? <Text style={styles.lead}>{t('subdl.saved')}</Text> : null}
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('subdl.placeholder')}
            placeholderTextColor={colors.textSubtle}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            style={styles.input}
            onFocus={() => reportTyping(true)}
            onBlur={() => reportTyping(false)}
            onSubmitEditing={save}
            returnKeyType="done"
            accessibilityLabel={t('subdl.key')}
          />
          <Button kind="primary" label={t('subdl.save')} onPress={save} busy={busy} />
          {notice === 'unreachable' && record ? (
            <Button label={t('subdl.checkAgain')} onPress={checkAgain} />
          ) : null}
          {status ? (
            <Text style={problem ? styles.problem : styles.status} testID="subdl-status">
              {t(`subdl.${status}`)}
            </Text>
          ) : null}
          {record ? (
            <Button
              kind="danger"
              label={t('subdl.remove')}
              onPress={() => {
                removeSubdlKey();
                setNotice('removed');
              }}
            />
          ) : null}
        </View>
        <Text style={styles.small}>{t('subdl.private')}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.l, gap: space.l, paddingBottom: space.xxl * 2 },
  lead: { ...type.body, color: colors.textMuted },
  small: { ...type.small, color: colors.textSubtle },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radius.l,
    padding: space.l,
    gap: space.s,
  },
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface3,
    borderRadius: radius.m,
    paddingHorizontal: space.l,
    paddingVertical: space.m,
  },
  status: { ...type.body, color: colors.text },
  problem: { ...type.body, color: colors.danger },
});
