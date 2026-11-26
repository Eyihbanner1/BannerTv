import styles from './SheetDetail.module.css';

/**
 * What a sheet knows of the row in focus, in a box beside its list: a title,
 * short facts as tags, a line or two of notes, and a long name in full
 * (a release name, which the rows only shorten).
 */
export function SheetDetail({
  title,
  chips = [],
  good,
  text,
  label,
  name,
  className,
}: {
  title: string;
  chips?: readonly string[];
  /** A tag that says something good, after the others: "Played here". */
  good?: string;
  text?: string;
  /** What the long name is: "File", "Release". */
  label?: string;
  name?: string;
  /** Where the box sits, and its size. */
  className?: string;
}) {
  return (
    <div className={className ? `${styles.box} ${className}` : styles.box}>
      <p className={styles.title}>{title}</p>
      {(chips.length > 0 || good) && (
        <p className={styles.chips}>
          {chips.map((chip) => (
            <span key={chip} className={styles.chip}>
              {chip}
            </span>
          ))}
          {good && <span className={`${styles.chip} ${styles.good}`}>{good}</span>}
        </p>
      )}
      {text && <p className={styles.text}>{text}</p>}
      {name && (
        <>
          {label && <p className={styles.label}>{label}</p>}
          <p className={styles.name}>{name}</p>
        </>
      )}
    </div>
  );
}
