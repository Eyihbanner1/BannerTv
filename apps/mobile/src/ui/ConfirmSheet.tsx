import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { colors, space, type } from './theme';

/** A question with two answers, as the TV's ConfirmDialog: the sure one first. */
export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** For a step that deletes something. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <Sheet visible={visible} title={title} onClose={onCancel}>
      <View style={styles.box}>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {children}
        <Button
          label={confirmLabel}
          kind={danger ? 'danger' : 'primary'}
          busy={busy}
          onPress={onConfirm}
        />
        <Button label={cancelLabel} kind="quiet" onPress={onCancel} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.m, padding: space.l },
  message: { ...type.body, color: colors.textSoft },
});
