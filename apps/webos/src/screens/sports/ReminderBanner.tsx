import {
  createStore,
  dueReminders,
  findReminded,
  localClock,
  nextReminderChange,
  type Reminder,
} from '@bannertv/core';
import { doesFocusableExist, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { openSection, push, type Route, router, topRoute } from '../../app/router';
import { Button } from '../../components/Button';
import { Overlay } from '../../components/Overlay';
import { isKidsProfile, profileSwitcher } from '../../data/profiles';
import { sportsFeed, sportsState } from '../../data/sports';
import { findReminderEvent, sportsReminders } from '../../data/sports-reminders';
import { useReminders } from './use-reminder';
import styles from './ReminderBanner.module.css';

const FOCUS_KEY = 'reminder-banner';
/** A banner nobody answers goes after this long, and focus goes back where it was. */
const SHOW_MS = 60 * 1000;
/** While a reminder waits to be shown, it is looked at again this often. */
const RECHECK_MS = 60 * 1000;
/** How long a banner waits after the screen in view changes, for that screen to place focus. */
const SETTLE_MS = 600;
/** App's own focusable, which hands focus to the screen in view. */
const CONTENT_KEY = 'content';

interface Showing {
  reminder: Reminder;
  /** Where focus was when the banner came, for when it goes. */
  opener: string;
}

/** The reminder on screen, if any. */
const showing = createStore<Showing | undefined>(undefined);
const hide = () => showing.set(undefined);

/**
 * What holds a reminder back until it can be shown: the player, whose
 * picture and remote it would take, "Who's watching?", and a dialog or menu
 * that has focus. A reminder held back shows once they are gone, if it is
 * not too late by then (REMIND_LATE_MS).
 */
function heldBack(top: Route, switching: boolean): boolean {
  if (top.name === 'player' || switching) return true;
  return document.activeElement?.closest('[role="dialog"]') != null;
}

/** Focus back where it was, or on the screen in view when that has gone. */
function focusBack(opener: string): string {
  return doesFocusableExist(opener) ? opener : CONTENT_KEY;
}

/** Opens the match a reminder is for, or Sports when the addons no longer list it. */
function openReminded(reminder: Reminder, opener: string): void {
  void findReminderEvent(reminder).then((event) => {
    if (event) push({ name: 'event', event }, () => focusBack(opener));
    else if (sportsState.get().shown) openSection('sports');
  });
}

/**
 * The TV's match reminders (SP4): just before kick-off, while BannerTV is
 * open, a small banner says the match is starting, with Watch to open its
 * page. It takes focus, as a dialog does, and Back or Not now gives it back.
 * Never for a kids profile. A reminder shows once and is then taken off.
 */
export function ReminderBanner() {
  const { t } = useTranslation();
  const { stack } = useSyncExternalStore(router.subscribe, router.get);
  const switching = useSyncExternalStore(profileSwitcher.subscribe, profileSwitcher.get);
  const reminders = useReminders();
  const events = useSyncExternalStore(sportsFeed.subscribe, () => sportsFeed.get().events);
  const [now, setNow] = useState(() => Date.now());
  const shown = useSyncExternalStore(showing.subscribe, showing.get);
  const top = stack[stack.length - 1]!.route;
  const kids = isKidsProfile();

  // Kick-offs the addons have corrected since, and reminders now too late, as the listing changes.
  useEffect(() => {
    void sportsReminders.refresh(events, Date.now());
  }, [events]);

  // Wakes at the next reminder's time, and each minute while one waits to be shown.
  useEffect(() => {
    const next = nextReminderChange(reminders, now);
    if (next === undefined) return;
    const wait = Math.min(RECHECK_MS, Math.max(0, next - now));
    const timer = window.setTimeout(() => setNow(Date.now()), wait + 50);
    return () => window.clearTimeout(timer);
  }, [reminders, now]);

  const due = kids || shown ? undefined : dueReminders(reminders, now)[0];
  const held = due !== undefined && heldBack(top, switching);
  useEffect(() => {
    if (!due || held) return;
    // A moment on, once a screen just shown (the match page after the player)
    // has placed its own focus, so the banner's focus is the one that stays.
    const timer = window.setTimeout(() => {
      const shownNow = topRoute();
      if (heldBack(shownNow, profileSwitcher.get())) return;
      void sportsReminders.remove(due.key);
      // Already on the match's own page: nothing to remind of.
      if (shownNow.name === 'event' && findReminded([shownNow.event], due)) return;
      showing.set({ reminder: due, opener: getCurrentFocusKey() });
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [due, held, top]);

  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(hide, SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [shown]);

  if (!shown) return null;
  const { reminder, opener } = shown;
  const title = t('sportsRemind.starting', { name: reminder.name });
  const watch = () => {
    hide();
    // Once the banner has handed focus back, so Back from the match returns there.
    window.setTimeout(() => openReminded(reminder, opener), 0);
  };
  return (
    <Overlay
      focusKey={FOCUS_KEY}
      label={title}
      defaultFocusKey={`${FOCUS_KEY}-watch`}
      returnFocusKey={() => focusBack(opener)}
      onClose={hide}
      placement="banner"
    >
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.when}>{t('sportsRemind.startsAt', { time: localClock(reminder.at) })}</p>
      <div className={styles.actions}>
        <Button
          variant="primary"
          focusKey={`${FOCUS_KEY}-watch`}
          label={t('sportsRemind.watch')}
          onPress={watch}
        />
        <Button focusKey={`${FOCUS_KEY}-later`} label={t('sportsRemind.notNow')} onPress={hide} />
      </div>
    </Overlay>
  );
}
