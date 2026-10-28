import { Button } from './Button';
import { Overlay } from './Overlay';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  focusKey: string;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Where focus goes afterwards. A function is read at closing time, after the choice. */
  returnFocusKey: string | (() => string);
  onConfirm: () => void;
  onCancel: () => void;
}

/** A yes-or-no question. Focus starts on the safe answer. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { focusKey, title, message, confirmLabel, cancelLabel, onConfirm, onCancel } = props;
  return (
    <Overlay
      focusKey={focusKey}
      label={title}
      defaultFocusKey={`${focusKey}-cancel`}
      returnFocusKey={props.returnFocusKey}
      onClose={onCancel}
      placement="center"
    >
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.message}>{message}</p>
      <div className={styles.actions}>
        <Button
          variant="primary"
          focusKey={`${focusKey}-confirm`}
          label={confirmLabel}
          onPress={onConfirm}
        />
        <Button focusKey={`${focusKey}-cancel`} label={cancelLabel} onPress={onCancel} />
      </div>
    </Overlay>
  );
}
