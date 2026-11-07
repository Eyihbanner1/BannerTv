import type { Profile } from '@bannertv/core';
import { profiles, setProfilePin } from '@tv/data/profiles';
import { unlockedGrownUps } from '@tv/data/profiles-lock';
import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { Button, ListRow } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { PinPad } from '../../ui/PinPad';
import { Sheet } from '../../ui/Sheet';
import { colors, radius, space, type } from '../../ui/theme';

type Step = { id: string; again?: string };

/**
 * Offered once a kids profile is saved while a grown-up profile has no PIN (item A5), as on the
 * TV: a kids profile only keeps a child to family titles if the grown-up profiles are locked.
 * Each grown-up gets "Set a PIN"; Not now leaves them as they are.
 */
export function LockGrownUps({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(profiles.subscribe, profiles.get);
  // The list shown when the offer opened, so a profile locked here stays on it, ticked.
  const [shown] = useState<Profile[]>(() => unlockedGrownUps(profiles.get().profiles));
  const [step, setStep] = useState<Step | null>(null);
  const [message, setMessage] = useState<string | undefined>();
  const current = (id: string) => state.profiles.filter((p) => p.id === id)[0];
  const allLocked = shown.every((p) => !current(p.id) || !!current(p.id)!.pin);

  return (
    <>
      {/* One sheet at a time: the pad takes the offer's place while a PIN is chosen. */}
      <Sheet visible={step === null} title={t('lockGrownUps.title')} onClose={onDone}>
        <View style={styles.box}>
          <Text style={styles.lead}>{t('lockGrownUps.lead')}</Text>
          <View style={styles.list}>
            {shown.map((profile) => {
              const now = current(profile.id);
              const name = now?.name ?? profile.name;
              return now?.pin ? (
                <ListRow
                  key={profile.id}
                  title={t('lockGrownUps.locked', { name })}
                  right={<Icon name="check" size={20} color={colors.accent} />}
                />
              ) : (
                <ListRow
                  key={profile.id}
                  title={t('lockGrownUps.setFor', { name })}
                  icon="lock"
                  {...(now
                    ? {
                        onPress: () => {
                          setMessage(undefined);
                          setStep({ id: profile.id });
                        },
                      }
                    : {})}
                />
              );
            })}
          </View>
          <Button
            label={allLocked ? t('lockGrownUps.done') : t('lockGrownUps.notNow')}
            kind={allLocked ? 'primary' : 'secondary'}
            onPress={onDone}
          />
        </View>
      </Sheet>
      <PinPad
        visible={step !== null}
        title={
          step === null
            ? ''
            : step.again === undefined
              ? t('lockGrownUps.chooseFor', { name: current(step.id)?.name ?? '' })
              : t('pin.again')
        }
        {...(message ? { message } : {})}
        onPin={(digits) => {
          if (!step) return;
          if (step.again === undefined) {
            setMessage(undefined);
            setStep({ id: step.id, again: digits });
          } else if (digits === step.again) {
            setProfilePin(step.id, digits);
            setStep(null);
          } else {
            setMessage(t('pin.mismatch'));
            setStep({ id: step.id });
          }
        }}
        onCancel={() => setStep(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.l, padding: space.l },
  lead: { ...type.body, color: colors.textSoft },
  list: { borderRadius: radius.l, overflow: 'hidden', gap: 1, backgroundColor: colors.raised },
});
