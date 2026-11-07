import { PIN_LENGTH } from '@bannertv/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from './icons';
import { Sheet } from './Sheet';
import { colors, space, type } from './theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'] as const;

/**
 * Four digits on a keypad. It hands them over once the fourth is in and clears itself; the
 * caller checks them with pinGuard, never by comparing digits.
 */
export function PinPad({
  visible,
  title,
  message,
  onPin,
  onCancel,
  onForgot,
}: {
  visible: boolean;
  title: string;
  message?: string;
  onPin: (digits: string) => void;
  onCancel: () => void;
  /** Shows "Forgot PIN?" under the keys, for a pad asking for a profile's own PIN. */
  onForgot?: () => void;
}) {
  const { t } = useTranslation();
  const [digits, setDigits] = useState('');
  const press = (key: (typeof KEYS)[number]) => {
    if (key === '') return;
    if (key === 'delete') {
      setDigits((before) => before.slice(0, -1));
      return;
    }
    const next = digits + key;
    if (next.length >= PIN_LENGTH) {
      setDigits('');
      onPin(next.slice(0, PIN_LENGTH));
    } else {
      setDigits(next);
    }
  };
  return (
    <Sheet
      visible={visible}
      title={title}
      onClose={() => {
        setDigits('');
        onCancel();
      }}
    >
      <View style={styles.box}>
        <View
          style={styles.dots}
          accessibilityLabel={t('pin.entered', { count: digits.length })}
          accessible
        >
          {Array.from({ length: PIN_LENGTH }, (_, index) => (
            <View key={index} style={[styles.dot, index < digits.length && styles.dotOn]} />
          ))}
        </View>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <View style={styles.keys}>
          {KEYS.map((key, index) => (
            <Pressable
              key={`${key}-${index}`}
              onPress={() => press(key)}
              disabled={key === ''}
              accessibilityRole={key === '' ? undefined : 'button'}
              accessibilityLabel={key === 'delete' ? t('pin.delete') : key}
              style={({ pressed }) => [styles.key, pressed && key !== '' && styles.keyPressed]}
            >
              {key === 'delete' ? <Icon name="back" /> : <Text style={styles.keyText}>{key}</Text>}
            </Pressable>
          ))}
        </View>
        {onForgot ? (
          <Pressable
            onPress={() => {
              setDigits('');
              onForgot();
            }}
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [styles.forgot, pressed && styles.forgotPressed]}
          >
            <Text style={styles.forgotText}>{t('pin.forgot')}</Text>
          </Pressable>
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', gap: space.l, padding: space.l },
  dots: { flexDirection: 'row', gap: space.l },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.accent },
  dotOn: { backgroundColor: colors.accent },
  message: { ...type.body, color: colors.danger, textAlign: 'center' },
  keys: { flexDirection: 'row', flexWrap: 'wrap', width: 264, gap: space.m },
  key: {
    width: 80,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface3,
  },
  keyPressed: { backgroundColor: colors.action },
  keyText: { ...type.title, color: colors.text },
  forgot: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.l },
  forgotPressed: { opacity: 0.6 },
  forgotText: { ...type.label, color: colors.textMuted },
});
