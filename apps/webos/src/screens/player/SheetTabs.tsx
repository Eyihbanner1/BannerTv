import {
  doesFocusableExist,
  FocusContext,
  setFocus,
  useFocusable,
} from '@noriginmedia/norigin-spatial-navigation';
import type { ReactNode } from 'react';
import { Pressable } from '../../components/Pressable';
import { inputMode } from '../../platform/input-mode';
import styles from './SheetTabs.module.css';

/**
 * A sheet's tabs, along its top, each saying what is on now. Moving along
 * them shows each one's choices below; OK goes on to them. The tab `name`
 * is `${sheet}-tab-${name}`, its choices `${sheet}-${name}`.
 */
export function SheetTabs<T extends string>({
  sheet,
  tabs,
  names,
  values,
  tab,
  onTab,
  aside,
}: {
  sheet: string;
  tabs: readonly T[];
  names: Record<T, string>;
  values: Record<T, string>;
  tab: T;
  onTab: (tab: T) => void;
  aside?: string;
}) {
  return (
    <Pane focusKey={`${sheet}-tabs`} preferred={`${sheet}-tab-${tab}`} className={styles.tabs}>
      {tabs.map((name) => (
        <Pressable
          key={name}
          focusKey={`${sheet}-tab-${name}`}
          label={`${names[name]}, ${values[name]}`}
          className={name === tab ? `${styles.tab} ${styles.current}` : styles.tab}
          focusedClassName={styles.tabFocused}
          // Moving along the tabs shows each one's choices, as the season tabs
          // do. The pointer passing over them on its way down does not: a click does.
          onFocus={() => {
            if (inputMode.get() !== 'pointer') onTab(name);
          }}
          onPress={() => {
            if (name !== tab) onTab(name);
            // On to its choices, when it has any: Timing with subtitles off has none.
            else if (doesFocusableExist(`${sheet}-${name}`)) void setFocus(`${sheet}-${name}`);
          }}
        >
          <span className={styles.tabName}>{names[name]}</span>
          <span className={styles.tabValue}>{values[name]}</span>
        </Pressable>
      ))}
      {aside && <span className={styles.aside}>{aside}</span>}
    </Pane>
  );
}

/** A focusable box for one tab's content, so Up from anywhere in it reaches the tabs. */
export function Pane({
  focusKey,
  preferred,
  className,
  children,
}: {
  focusKey: string;
  preferred?: string;
  className?: string;
  children: ReactNode;
}) {
  const { ref, focusKey: key } = useFocusable<object, HTMLDivElement>({
    focusKey,
    saveLastFocusedChild: false,
    preferredChildFocusKey: preferred,
  });
  return (
    <FocusContext.Provider value={key}>
      <div ref={ref} className={className}>
        {children}
      </div>
    </FocusContext.Provider>
  );
}
