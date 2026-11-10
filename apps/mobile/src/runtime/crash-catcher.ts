import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform, Share } from 'react-native';
import { appUpdates } from './app-updates';
import {
  addProblem,
  addVisit,
  type Build,
  crashScreenStep,
  phoneLine,
  problemFrom,
  type ProblemKind,
  problemStore,
  reportText,
  type ScreenVisit,
} from './crash-log';
import { localStorage } from './web-globals';

/**
 * Catches what goes wrong on the phone and keeps it for Send a report (runtime/crash-log.ts
 * keeps and words it). From boot, before the data layer starts:
 *
 * - JavaScript errors nothing caught, through React Native's ErrorUtils. The handler before it
 *   (React Native's own, and expo-router's in front of it) is always called next, so a crash
 *   still closes the app, and expo-updates still sees an update crash and goes back to the one
 *   before it (ADR 0007).
 * - Promises rejected with nothing to handle them. A release build of React Native tracks none,
 *   so the phone asks Hermes itself; a development build keeps React Native's own warnings.
 * - In the web build, the page's error and unhandledrejection events.
 *
 * A screen that fails to draw is the crash screen's (ui/CrashScreen.tsx). The screens shown come
 * from nav/screen-trail.ts.
 */

/** The kept problems, newest first, in the phone's own storage so a crash survives the restart. */
export const problems = problemStore(localStorage);

/** More than this many problems a minute are not kept, so a loop of errors cannot flood storage. */
const MOST_A_MINUTE = 10;

let trail: ScreenVisit[] = [];
/** The screen being drawn: one that fails to draw never shows, so it never joins the trail. */
let drawing = '/';
let firstScreen = false;
let handedOver = false;
let started = false;
let recent: number[] = [];

/** What the app runs: an update's id only while it runs an update, as Settings says. */
function build(): Build {
  return {
    version: Constants.expoConfig?.version ?? '',
    updateId: appUpdates.get().running.kind === 'update' ? Updates.updateId : null,
  };
}

/** Keeps `error` as a problem of `kind`. Never throws: it runs inside the error handlers. */
export function noteProblem(error: unknown, kind: ProblemKind): void {
  try {
    const now = Date.now();
    recent = recent.filter((at) => now - at < 60_000);
    if (kind !== 'crash' && recent.length >= MOST_A_MINUTE) return;
    recent.push(now);
    const problem = problemFrom(error, kind, {
      at: now,
      ...build(),
      screen: drawing,
      screens: trail,
    });
    problems.set(addProblem(problems.get(), problem));
  } catch {
    // The handler after this one still runs.
  }
}

/** A screen's route is being drawn. */
export function screenDrawing(path: string): void {
  drawing = path;
}

/** A screen's route has shown. The first one means the app has drawn its first screen. */
export function screenShown(path: string): void {
  drawing = path;
  trail = addVisit(trail, path, Date.now());
  firstScreen = true;
}

/**
 * Whether the crash screen hands `error` on as a crash rather than show itself (crashScreenStep):
 * an over-the-air update that fails before its first screen.
 */
export function handsOver(): boolean {
  const updateLaunch = appUpdates.get().on && !Updates.isEmbeddedLaunch;
  return crashScreenStep({ firstScreenShown: firstScreen, updateLaunch }) === 'handOver';
}

/** Hands `error` to the error handlers as a crash: kept, then expo-updates' to deal with. */
export function handOver(error: unknown): void {
  if (handedOver || typeof ErrorUtils === 'undefined') return;
  handedOver = true;
  ErrorUtils.getGlobalHandler()(error, true);
}

interface RejectionTracker {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, reason: unknown) => void;
  }) => void;
}

interface WebPage {
  addEventListener?: (type: string, listener: (event: Record<string, unknown>) => void) => void;
}

/** Starts catching, from boot. Runs once. */
export function catchCrashes(): void {
  if (started) return;
  started = true;
  if (Platform.OS === 'web') {
    const page = globalThis as WebPage;
    page.addEventListener?.('error', (event) => noteProblem(event.error ?? event.message, 'error'));
    page.addEventListener?.('unhandledrejection', (event) => noteProblem(event.reason, 'promise'));
    return;
  }
  if (typeof ErrorUtils !== 'undefined') {
    const before = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      noteProblem(error, isFatal ? 'crash' : 'error');
      before(error, isFatal);
    });
  }
  if (!__DEV__) {
    const hermes = (globalThis as { HermesInternal?: RejectionTracker | null }).HermesInternal;
    hermes?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (_id, reason) => noteProblem(reason, 'promise'),
    });
  }
}

/** The phone, from React Native's Platform: Android's version and the phone's maker and model. */
function phone(): string {
  const constants = (Platform as { constants?: Record<string, unknown> }).constants ?? {};
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  return phoneLine({
    os: Platform.OS,
    version: Platform.Version,
    release: text(constants.Release),
    maker: text(constants.Manufacturer),
    model: text(constants.Model),
  });
}

/** The report as it would be sent now. */
export function reportNow(): string {
  return reportText({
    now: Date.now(),
    build: build(),
    takesUpdates: appUpdates.get().on,
    phone: phone(),
    screen: drawing,
    screens: trail,
    problems: problems.get(),
  });
}

/**
 * Opens Android's share sheet with the report as plain text, titled `title` (the subject an
 * email app takes). False when the phone could not open it, as the web build without sharing.
 */
export async function shareReport(title: string): Promise<boolean> {
  try {
    await Share.share({ title, message: reportNow() }, { dialogTitle: title });
    return true;
  } catch (error) {
    console.warn('[BannerTV] could not share the report:', String(error));
    return false;
  }
}
