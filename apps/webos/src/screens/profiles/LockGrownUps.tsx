import type { Profile } from '@bannertv/core';
import { useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Overlay } from '../../components/Overlay';
import { PinPad } from '../../components/PinPad';
import { profiles, setProfilePin } from '../../data/profiles';
import { unlockedGrownUps } from '../../data/profiles-lock';
import styles from './ForgotPin.module.css';

type Step = { id: string; again?: string };

interface LockGrownUpsProps {
  /** Where focus goes when it closes. */
  returnFocusKey: string | (() => string);
  onDone: () => void;
}

/**
 * Offered once a kids profile is saved while a grown-up profile has no PIN
 * (item A5): a kids profile only keeps a child to family titles if the
 * grown-up profiles are locked, since "Who's watching?" opens an unlocked
 * one at once. Each grown-up gets a "Set a PIN" button; Not now leaves them.
 */
export function LockGrownUps({ returnFocusKey, onDone }: LockGrownUpsProps) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(profiles.subscribe, profiles.get);
  // The list is the one shown when the offer opened, so a profile locked here stays on it, ticked.
  const [shown] = useState<Profile[]>(() => unlockedGrownUps(profiles.get().profiles));
  const [step, setStep] = useState<Step | null>(null);
  const [message, setMessage] = useState<string | undefined>(undefined);
  // The button that opened the pad, to come back to when it closes.
  const from = useRef('lock-grown-ups-done');
  const current = (id: string) => state.profiles.filter((p) => p.id === id)[0];
  const allLocked = shown.every((p) => !!current(p.id)?.pin || !current(p.id));

  return (
    <>
      <Overlay
        focusKey="lock-grown-ups"
        label={t('lockGrownUps.title')}
        defaultFocusKey={shown[0] ? `lock-grown-ups-${shown[0].id}` : 'lock-grown-ups-done'}
        returnFocusKey={returnFocusKey}
        onClose={onDone}
        placement="center"
      >
        <h2 className={styles.title}>{t('lockGrownUps.title')}</h2>
        <p className={styles.help}>{t('lockGrownUps.lead')}</p>
        <div className={styles.list}>
          {shown.map((profile) => {
            const now = current(profile.id);
            const locked = !!now?.pin;
            const name = now?.name ?? profile.name;
            return (
              <Button
                key={profile.id}
                block
                focusKey={`lock-grown-ups-${profile.id}`}
                label={
                  locked ? t('lockGrownUps.locked', { name }) : t('lockGrownUps.setFor', { name })
                }
                onPress={() => {
                  if (locked || !now) return;
                  from.current = `lock-grown-ups-${profile.id}`;
                  setMessage(undefined);
                  setStep({ id: profile.id });
                }}
              />
            );
          })}
        </div>
        <div className={styles.actions}>
          <Button
            variant="primary"
            focusKey="lock-grown-ups-done"
            label={allLocked ? t('lockGrownUps.done') : t('lockGrownUps.notNow')}
            onPress={onDone}
          />
        </div>
      </Overlay>
      {step && (
        <PinPad
          focusKey="lock-grown-ups-pin"
          title={
            step.again === undefined
              ? t('lockGrownUps.chooseFor', { name: current(step.id)?.name ?? '' })
              : t('pin.again')
          }
          message={message}
          returnFocusKey={() => from.current}
          onPin={(digits) => {
            if (step.again === undefined) {
              setMessage(undefined);
              setStep({ id: step.id, again: digits });
            } else if (digits === step.again) {
              setProfilePin(step.id, digits);
              // Once locked, its button says so: Done is the next thing to press.
              from.current = 'lock-grown-ups-done';
              setStep(null);
            } else {
              setMessage(t('pin.mismatch'));
              setStep({ id: step.id });
            }
          }}
          onClose={() => setStep(null)}
        />
      )}
    </>
  );
}
