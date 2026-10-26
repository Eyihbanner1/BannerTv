import { Pressable, type PressableProps } from './Pressable';
import styles from './Button.module.css';

interface ButtonProps extends Omit<PressableProps, 'className' | 'focusedClassName' | 'label'> {
  label: string;
  variant?: 'primary' | 'secondary';
  /** Full-width, stacked in a column. */
  block?: boolean;
}

export function Button({
  label,
  variant = 'secondary',
  block = false,
  children,
  ...rest
}: ButtonProps) {
  const className = [styles.button, variant === 'primary' && styles.primary, block && styles.block]
    .filter(Boolean)
    .join(' ');
  return (
    <Pressable {...rest} label={label} className={className} focusedClassName={styles.focused}>
      {children ?? label}
    </Pressable>
  );
}
