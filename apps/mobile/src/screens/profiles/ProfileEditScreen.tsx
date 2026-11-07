import {
  cleanName,
  KIDS_RATINGS,
  type KidsRating,
  MAIN_PROFILE_ID,
  MAX_NAME_LENGTH,
  PROFILE_COLOURS,
  type StoredPin,
} from '@bannertv/core';
import { deleteProfile } from '@tv/data/profile-delete';
import {
  activeProfileId,
  addProfile,
  pinGuard,
  profiles,
  setProfilePin,
  updateProfile,
} from '@tv/data/profiles';
import { offerLockAfterSave } from '@tv/data/profiles-lock';
import { syncOn } from '@tv/data/sync-clock';
import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { goBack } from '../../nav/routes';
import { reportTyping } from '../../runtime/whereabouts';
import { Avatar } from '../../ui/Avatar';
import { Button, ListRow } from '../../ui/Button';
import { ConfirmSheet } from '../../ui/ConfirmSheet';
import { PinPad } from '../../ui/PinPad';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { Sheet, SheetOption } from '../../ui/Sheet';
import { colors, gutter, radius, space, type } from '../../ui/theme';
import { ForgotPin } from './ForgotPin';
import { LockGrownUps } from './LockGrownUps';
import { unlockedForEdit } from './unlocked';

const COLOURS = Array.from({ length: PROFILE_COLOURS }, (_, index) => index);

/** The same saved PIN: one set again, here or on another screen, is not. */
const samePin = (a: StoredPin, b: StoredPin) => a.salt === b.salt && a.hash === b.hash;

/**
 * Changing a PIN: the one it has, unless it is known on this page, then the new one typed once
 * and again to be sure. Removing one takes only the first.
 */
type PinStep =
  | { step: 'current'; then: 'change' | 'remove' }
  | { step: 'first' }
  | { step: 'again'; first: string };

/**
 * One profile's name, colour and kids setting, saved together; its PIN and deletion take effect
 * at once. Without an id it adds a new profile. The rules are the TV's (apps/webos
 * ProfileEditScreen): your own profile and Main are never kids profiles, and changing or
 * removing a PIN asks for the one it has unless it is known on this page.
 */
export function ProfileEditScreen({ id }: { id?: string }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(profiles.subscribe, profiles.get);
  const existing = id === undefined ? undefined : state.profiles.find((p) => p.id === id);
  const current = activeProfileId.get();
  const [name, setName] = useState(existing?.name ?? '');
  const [colour, setColour] = useState(existing?.colour ?? state.profiles.length % PROFILE_COLOURS);
  const [kids, setKids] = useState<KidsRating | undefined>(existing?.kids);
  const [problem, setProblem] = useState<string | undefined>();
  const [pin, setPin] = useState<PinStep | null>(null);
  const [pinMessage, setPinMessage] = useState<string | undefined>();
  // Its PIN was just entered on Settings, Profiles, so it is known here.
  const [knownPin, setKnownPin] = useState(() =>
    existing && unlockedForEdit(existing.id) ? existing.pin : undefined,
  );
  const pinKnown = !!existing?.pin && !!knownPin && samePin(existing.pin, knownPin);
  const [choosingKids, setChoosingKids] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [forgetting, setForgetting] = useState<'change' | 'remove' | null>(null);
  const [locking, setLocking] = useState(false);

  const canBeKids = existing?.id !== MAIN_PROFILE_ID && existing?.id !== current;
  const canDelete = existing !== undefined && canBeKids;

  const save = () => {
    if (cleanName(name) === '') {
      setProblem(t('profiles.nameNeeded'));
      return;
    }
    let savedId = existing?.id;
    if (existing) {
      updateProfile(existing.id, {
        name,
        colour,
        ...(canBeKids ? { kids: kids ?? null } : {}),
      });
    } else {
      savedId = addProfile({ name, colour, ...(kids ? { kids } : {}) });
      if (!savedId) {
        setProblem(t('profiles.full'));
        return;
      }
    }
    const list = profiles.get().profiles;
    // A new kids profile only works if the grown-ups are locked: offer that before leaving.
    if (offerLockAfterSave(existing, list.filter((p) => p.id === savedId)[0], list)) {
      setLocking(true);
      return;
    }
    goBack();
  };

  const lockedMessage = (profileId: string) =>
    t('pin.locked', { seconds: Math.ceil(pinGuard.waitMs(profileId) / 1000) });

  const changePin = (then: 'change' | 'remove') => {
    if (!existing) return;
    if (existing.pin && !pinKnown) {
      setPinMessage(pinGuard.waitMs(existing.id) > 0 ? lockedMessage(existing.id) : undefined);
      setPin({ step: 'current', then });
    } else if (then === 'change') {
      setPinMessage(undefined);
      setPin({ step: 'first' });
    } else {
      setProfilePin(existing.id, null);
    }
  };

  const onPin = (digits: string) => {
    if (!existing || !pin) return;
    if (pin.step === 'current') {
      const result = pinGuard.attempt(existing, digits);
      if (result !== 'ok') {
        setPinMessage(result === 'locked' ? lockedMessage(existing.id) : t('pin.wrong'));
        return;
      }
      setKnownPin(existing.pin);
      setPinMessage(undefined);
      if (pin.then === 'change') {
        setPin({ step: 'first' });
      } else {
        setProfilePin(existing.id, null);
        setPin(null);
      }
    } else if (existing.pin && !pinKnown) {
      // Another screen changed the PIN while this pad was open: the new one is asked for first.
      setPinMessage(t('pin.changedElsewhere'));
      setPin({ step: 'current', then: 'change' });
    } else if (pin.step === 'first') {
      setPinMessage(undefined);
      setPin({ step: 'again', first: digits });
    } else if (digits === pin.first) {
      setProfilePin(existing.id, digits);
      setKnownPin(profiles.get().profiles.find((p) => p.id === existing.id)?.pin);
      setPin(null);
    } else {
      setPinMessage(t('pin.mismatch'));
      setPin({ step: 'first' });
    }
  };

  const kidsLabel = (value: KidsRating | undefined) =>
    value ? t('profiles.kidsUpTo', { rating: value }) : t('common.off');

  // Deleted meanwhile: nothing left to edit.
  if (id !== undefined && !existing) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={t('profiles.edit')} />
        <View style={styles.content}>
          <Text style={styles.lead}>{t('profiles.gone')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title={existing ? t('profiles.edit') : t('profiles.add')} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.preview}>
          <Avatar profile={{ name: cleanName(name) || '?', colour }} size={96} round />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>{t('profiles.name')}</Text>
          <TextInput
            value={name}
            onChangeText={(text) => {
              setProblem(undefined);
              setName(text.slice(0, MAX_NAME_LENGTH));
            }}
            placeholder={t('profiles.namePlaceholder', { max: MAX_NAME_LENGTH })}
            placeholderTextColor={colors.textSubtle}
            maxLength={MAX_NAME_LENGTH}
            autoCorrect={false}
            style={styles.input}
            onFocus={() => reportTyping(true)}
            onBlur={() => reportTyping(false)}
            returnKeyType="done"
            accessibilityLabel={t('profiles.name')}
          />
          {problem ? (
            <Text style={styles.problem} accessibilityRole="alert">
              {problem}
            </Text>
          ) : null}
        </View>
        <View style={styles.colours}>
          {COLOURS.map((index) => (
            <Pressable
              key={index}
              onPress={() => setColour(index)}
              accessibilityRole="button"
              accessibilityLabel={t('profiles.colour', { number: index + 1 })}
              accessibilityState={{ selected: index === colour }}
              style={[styles.colour, index === colour && styles.colourChosen]}
            >
              <Avatar profile={{ name: ' ', colour: index }} size={40} round />
            </Pressable>
          ))}
        </View>

        <View style={styles.list}>
          {canBeKids ? (
            <ListRow
              title={t('profiles.kidsProfile')}
              value={kidsLabel(kids)}
              onPress={() => setChoosingKids(true)}
            />
          ) : null}
          {existing ? (
            <ListRow
              title={existing.pin ? t('pin.change') : t('pin.set')}
              icon="lock"
              onPress={() => changePin('change')}
            />
          ) : null}
          {existing?.pin ? (
            <ListRow title={t('pin.remove')} onPress={() => changePin('remove')} />
          ) : null}
        </View>
        {!canBeKids && existing ? (
          <Text style={styles.note}>
            {existing.id === MAIN_PROFILE_ID ? t('profiles.mainNotKids') : t('profiles.youNotKids')}
          </Text>
        ) : null}
        {kids ? <Text style={styles.note}>{t('profiles.kidsExplained')}</Text> : null}

        <Button
          label={existing ? t('profiles.save') : t('profiles.add')}
          kind="primary"
          onPress={save}
        />
        {canDelete ? (
          <Button label={t('profiles.delete')} kind="danger" onPress={() => setDeleting(true)} />
        ) : null}
      </ScrollView>

      <Sheet
        visible={choosingKids}
        title={t('profiles.kidsProfile')}
        onClose={() => setChoosingKids(false)}
      >
        {[undefined, ...KIDS_RATINGS].map((value) => (
          <SheetOption
            key={value ?? 'off'}
            label={kidsLabel(value)}
            selected={kids === value}
            onPress={() => {
              setKids(value);
              setChoosingKids(false);
            }}
          />
        ))}
      </Sheet>
      {existing ? (
        <PinPad
          visible={pin !== null}
          title={
            pin?.step === 'current'
              ? t('pin.enterFor', { name: existing.name })
              : pin?.step === 'first'
                ? t('pin.choose')
                : t('pin.again')
          }
          {...(pinMessage ? { message: pinMessage } : {})}
          onPin={onPin}
          onCancel={() => setPin(null)}
          {...(pin?.step === 'current'
            ? {
                onForgot: () => {
                  setForgetting(pin.then);
                  setPin(null);
                },
              }
            : {})}
        />
      ) : null}
      {existing && forgetting ? (
        <ForgotPin
          profile={existing}
          onCleared={() => {
            const then = forgetting;
            setForgetting(null);
            setPinMessage(undefined);
            // With the PIN off, Change PIN goes on to choosing one; Remove PIN is already done.
            if (then === 'change') setPin({ step: 'first' });
          }}
          onClose={() => setForgetting(null)}
        />
      ) : null}
      {locking ? <LockGrownUps onDone={goBack} /> : null}
      {existing ? (
        <ConfirmSheet
          visible={deleting}
          title={t('profiles.deleteTitle', { name: existing.name })}
          message={t(syncOn() ? 'profiles.deleteMessageAccount' : 'profiles.deleteMessage')}
          confirmLabel={t('profiles.delete')}
          cancelLabel={t('common.cancel')}
          danger
          onConfirm={() => {
            setDeleting(false);
            void deleteProfile(existing.id);
            goBack();
          }}
          onCancel={() => setDeleting(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: gutter, paddingBottom: space.xxl * 2, gap: 18 },
  lead: { ...type.body, color: colors.textMuted },
  preview: { alignItems: 'center', paddingTop: space.s },
  field: { gap: space.s },
  label: { ...type.overline, color: colors.accent },
  input: {
    ...type.heading,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderRadius: radius.m,
    paddingHorizontal: space.l,
    paddingVertical: space.m,
  },
  problem: { ...type.body, color: colors.danger },
  colours: { flexDirection: 'row', flexWrap: 'wrap', gap: space.m, justifyContent: 'center' },
  colour: { padding: 3, borderRadius: 26, borderWidth: 2, borderColor: 'transparent' },
  colourChosen: { borderColor: colors.text },
  // The 1-unit gaps show the raised colour behind the rows: the dividers.
  list: { borderRadius: radius.l, overflow: 'hidden', gap: 1, backgroundColor: colors.raised },
  note: { ...type.meta, color: colors.textMuted },
});
