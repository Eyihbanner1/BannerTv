import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { Focusable } from './Focusable';
import { Icon } from './icons';
import { color, px, spacing, type } from './theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'] as const;
const LENGTH = 4;

/** Four digits from the remote, on a keypad the arrows walk. */
export function PinPad({
  title,
  message,
  onPin,
}: {
  title: string;
  message?: string;
  onPin: (digits: string) => void;
}) {
  const { t } = useTranslation();
  const [digits, setDigits] = useState('');
  const press = (key: (typeof KEYS)[number]) => {
    if (key === 'delete') {
      setDigits((value) => value.slice(0, -1));
      return;
    }
    const next = (digits + key).slice(0, LENGTH);
    if (next.length === LENGTH) {
      setDigits('');
      onPin(next);
    } else {
      setDigits(next);
    }
  };
  const size = px(110);
  return (
    <View style={styles.pad}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.dots} accessibilityLabel={t('pin.entered', { count: digits.length })}>
        {Array.from({ length: LENGTH }, (_, index) => (
          <View key={index} style={[styles.dot, index < digits.length && styles.dotOn]} />
        ))}
      </View>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <View style={[styles.keys, { width: size * 3 + spacing.lg * 2 }]}>
        {KEYS.map((key, index) =>
          key === '' ? (
            <View key={index} style={{ width: size, height: size }} />
          ) : (
            <Focusable
              key={index}
              radius={size / 2}
              onPress={() => press(key)}
              {...(key === '5' ? { preferred: true } : {})}
              accessibilityLabel={key === 'delete' ? t('pin.delete') : key}
              style={{ width: size, height: size }}
            >
              {(focused) => (
                <View
                  style={[styles.key, { borderRadius: size / 2 }, focused && styles.keyFocused]}
                >
                  {key === 'delete' ? (
                    <Icon name="back" size={px(40)} tint={focused ? color.onFocus : color.text} />
                  ) : (
                    <Text style={[styles.keyText, focused && styles.keyTextFocused]}>{key}</Text>
                  )}
                </View>
              )}
            </Focusable>
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { alignItems: 'center', gap: spacing.xl },
  title: { ...type.heading, color: color.text },
  dots: { flexDirection: 'row', gap: spacing.lg },
  dot: {
    width: px(28),
    height: px(28),
    borderRadius: px(14),
    borderWidth: px(3),
    borderColor: color.textMuted,
  },
  dotOn: { backgroundColor: color.text, borderColor: color.text },
  message: { ...type.body, color: color.focus },
  keys: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  key: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  keyFocused: { backgroundColor: color.focusFill },
  keyText: { ...type.heading, color: color.text },
  keyTextFocused: { color: color.onFocus },
});
