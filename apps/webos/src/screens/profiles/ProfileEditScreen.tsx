import {
  cleanName,
  KIDS_RATINGS,
  type KidsRating,
  MAIN_PROFILE_ID,
  MAX_NAME_LENGTH,
  PROFILE_COLOURS,
  type StoredPin,
} from '@bannertv/core';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { back } from '../../app/router';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Avatar, avatarArt } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Picker } from '../../components/Picker';
import { PinPad } from '../../components/PinPad';
import { Pressable } from '../../components/Pressable';
import { TextField } from '../../components/TextField';
import { deleteProfile } from '../../data/profile-delete';
import {
  activeProfileId,
  addProfile,
  pinGuard,
  profiles,
  setProfilePin,
  updateProfile,
} from '../../data/profiles';
import screen from '../Screen.module.css';
import styles from './ProfileEditScreen.module.css';

const KIDS_OFF = 'off';
const COLOURS = Array.from({ length: PROFILE_COLOURS }, (_, index) => index);

/** The same saved PIN: one set again, here or on another screen, is not. */
const samePin = (a: StoredPin, b: StoredPin) => a.salt === b.salt && a.hash === b.hash;

/**
 * Changing a PIN: the one it has, unless it is known on this page, then the
 * new one typed once and again to be sure. Removing one takes only the first.
 */
type PinStep =
  | { step: 'current'; then: 'change' | 'remove' }
  | { step: 'first' }
  | { step: 'again'; first: string };

/**
 * One profile's name, colour and kids setting, saved together; its PIN and
 * deletion take effect at once. Without an id it adds a new profile.
 *
 * Your own profile cannot become a kids profile, since what a kids profile
 * may see is fixed when it opens, and Main is never one: Main set BannerTV up.
 *
 * Changing or removing a PIN asks for the one it has first, Main's and your
 * own included, since Main's PIN guards the BannerTV account (ADR 0006).
 * It is not asked again once known on this page: entered to open it
 * (`unlocked`), entered here, or just chosen. A PIN changed since on
 * another screen is not that one, and is asked for.
 */
export function ProfileEditScreen({ id, unlocked = false }: { id?: string; unlocked?: boolean }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(profiles.subscribe, profiles.get);
  const existing = id === undefined ? undefined : state.profiles.find((p) => p.id === id);
  const current = activeProfileId.get();
  const [name, setName] = useState(existing?.name ?? '');
  const [colour, setColour] = useState(existing?.colour ?? state.profiles.length % PROFILE_COLOURS);
  const [kids, setKids] = useState<KidsRating | undefined>(existing?.kids);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [pin, setPin] = useState<PinStep | null>(null);
  const [pinMessage, setPinMessage] = useState<string | undefined>(undefined);
  const [knownPin, setKnownPin] = useState(unlocked ? existing?.pin : undefined);
  const pinKnown = !!existing?.pin && !!knownPin && samePin(existing.pin, knownPin);
  // Where the PIN pad sends focus as it closes: the button that opened it, while it is there.
  const pinFrom = useRef('profile-pin');
  const [deleting, setDeleting] = useState(false);
  useScreenFocus('profile-name');

  const canBeKids = existing?.id !== MAIN_PROFILE_ID && existing?.id !== current;
  const canDelete = existing !== undefined && canBeKids;

  const save = () => {
    if (cleanName(name) === '') {
      setProblem(t('profiles.nameNeeded'));
      void setFocus('profile-name');
      return;
    }
    if (existing) {
      updateProfile(existing.id, {
        name,
        colour,
        ...(canBeKids ? { kids: kids ?? null } : {}),
      });
    } else if (!addProfile({ name, colour, ...(kids ? { kids } : {}) })) {
      setProblem(t('profiles.full'));
      return;
    }
    back();
  };

  const lockedMessage = (profileId: string) =>
    t('pin.locked', { seconds: Math.ceil(pinGuard.waitMs(profileId) / 1000) });

  const changePin = (then: 'change' | 'remove') => {
    if (!existing) return;
    pinFrom.current = then === 'remove' ? 'profile-pin-remove' : 'profile-pin';
    if (existing.pin && !pinKnown) {
      setPinMessage(pinGuard.waitMs(existing.id) > 0 ? lockedMessage(existing.id) : undefined);
      setPin({ step: 'current', then });
    } else if (then === 'change') {
      setPinMessage(undefined);
      setPin({ step: 'first' });
    } else {
      setProfilePin(existing.id, null);
      void setFocus('profile-pin');
    }
  };

  const kidsOptions = [
    { value: KIDS_OFF, label: t('common.off') },
    ...KIDS_RATINGS.map((rating) => ({
      value: rating,
      label: t('profiles.kidsUpTo', { rating }),
    })),
  ];

  // Deleted meanwhile: nothing left to edit.
  if (id !== undefined && !existing) {
    return (
      <div className={screen.screen}>
        <h1 className={screen.title}>{t('profiles.edit')}</h1>
        <p className={screen.lead}>{t('profiles.gone')}</p>
      </div>
    );
  }

  return (
    <div className={screen.screen}>
      <h1 className={screen.title}>{existing ? t('profiles.edit') : t('profiles.add')}</h1>
      <div className={styles.layout}>
        <div className={styles.preview}>
          <Avatar profile={{ name: cleanName(name) || '?', colour }} size="large" />
        </div>
        <div className={screen.column}>
          <TextField
            focusKey="profile-name"
            label={t('profiles.name')}
            placeholder={t('profiles.namePlaceholder', { max: MAX_NAME_LENGTH })}
            value={name}
            onChange={(value) => {
              setProblem(undefined);
              setName(value.slice(0, MAX_NAME_LENGTH));
            }}
          />
          <p className={styles.problem} role="status">
            {problem ?? ''}
          </p>
          <div className={styles.colours}>
            {COLOURS.map((index) => (
              <Pressable
                key={index}
                focusKey={`profile-colour-${index}`}
                label={t('profiles.colour', { number: index + 1 })}
                className={index === colour ? `${styles.colour} ${styles.chosen}` : styles.colour}
                focusedClassName={styles.focused}
                style={{ backgroundImage: avatarArt(index) }}
                onPress={() => setColour(index)}
              />
            ))}
          </div>
          {canBeKids ? (
            <Picker
              focusKey="profile-kids"
              label={t('profiles.kidsProfile')}
              options={kidsOptions}
              value={kids ?? KIDS_OFF}
              onChange={(value) => setKids(value === KIDS_OFF ? undefined : (value as KidsRating))}
            />
          ) : (
            existing && (
              <p className={styles.note}>
                {existing.id === MAIN_PROFILE_ID
                  ? t('profiles.mainNotKids')
                  : t('profiles.youNotKids')}
              </p>
            )
          )}
          {kids && <p className={styles.note}>{t('profiles.kidsExplained')}</p>}
          <div className={styles.actions}>
            <Button
              block
              variant="primary"
              focusKey="profile-save"
              label={existing ? t('profiles.save') : t('profiles.add')}
              onPress={save}
            />
            {existing && (
              <Button
                block
                focusKey="profile-pin"
                label={existing.pin ? t('pin.change') : t('pin.set')}
                onPress={() => changePin('change')}
              />
            )}
            {existing?.pin && (
              <Button
                block
                focusKey="profile-pin-remove"
                label={t('pin.remove')}
                onPress={() => changePin('remove')}
              />
            )}
            {canDelete && (
              <Button
                block
                focusKey="profile-delete"
                label={t('profiles.delete')}
                onPress={() => setDeleting(true)}
              />
            )}
          </div>
        </div>
      </div>
      {existing && pin && (
        <PinPad
          focusKey="profile-pin-pad"
          title={
            pin.step === 'current'
              ? t('pin.enterFor', { name: existing.name })
              : pin.step === 'first'
                ? t('pin.choose')
                : t('pin.again')
          }
          message={pinMessage}
          returnFocusKey={() => pinFrom.current}
          onPin={(digits) => {
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
                // Remove PIN goes with it, so focus lands on Set a PIN.
                pinFrom.current = 'profile-pin';
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
          }}
          onClose={() => setPin(null)}
        />
      )}
      {existing && deleting && (
        <ConfirmDialog
          focusKey="profile-delete-confirm"
          title={t('profiles.deleteTitle', { name: existing.name })}
          message={t('profiles.deleteMessage')}
          confirmLabel={t('profiles.delete')}
          cancelLabel={t('common.cancel')}
          returnFocusKey="profile-delete"
          onConfirm={() => {
            setDeleting(false);
            void deleteProfile(existing.id);
            back();
          }}
          onCancel={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
