import { dateFormatter } from '@tv/data/date-format';

/**
 * The decisions behind the phone's over-the-air updates (runtime/app-updates.ts), kept free of
 * expo-updates and React Native so they can be tested. When a restart may happen is
 * runtime/safe-restart.ts.
 */

/** Back in the foreground, the app checks again at most this often. */
export const CHECK_EVERY_MS = 15 * 60_000;

/** The build the app runs in. */
export interface UpdatesBuild {
  /** React Native's Platform.OS. */
  platform: string;
  /** A development build (__DEV__), whose JavaScript comes from Expo's dev server. */
  development: boolean;
  /** expo-updates is on in the APK: only an APK of main with the certificate (app.config.ts). */
  enabled: boolean;
}

/**
 * Whether this build takes over-the-air updates at all: not the web build (the journeys' and
 * development's, where expo-updates' stand-in says it is enabled), not a development build, and
 * not an APK built with updates off: without the certificate, or of code main does not have.
 */
export function takesUpdates(build: UpdatesBuild): boolean {
  return build.platform !== 'web' && !build.development && build.enabled;
}

/** Who wants a check: the app by itself (back in the foreground), or the person, in Settings. */
export type Asker = 'app' | 'person';

/**
 * How far the latest check got: `none` is up to date, `failed` is shown only for the person's
 * own check, and `ready` is an update downloaded and waiting for the app to start again.
 */
export type CheckPhase = 'idle' | 'checking' | 'downloading' | 'none' | 'failed' | 'ready';

/** What a wish to check leads to: a check, joining the one running, the offer, or nothing. */
export type CheckStep = 'check' | 'join' | 'offer' | 'skip';

/** Whether a check is due: the first, or the last started CHECK_EVERY_MS ago or more. */
export function checkDue(lastCheck: number | null, now: number): boolean {
  // A clock set back counts as due, rather than waiting until it catches up.
  return lastCheck === null || now < lastCheck || now - lastCheck >= CHECK_EVERY_MS;
}

/**
 * What a wish to check leads to. One check at a time: the person's joins the app's own, so it
 * ends in their offer. None once an update waits, since it starts with the next restart; the
 * person is offered that restart instead. The app's own checks wait CHECK_EVERY_MS from the last.
 */
export function nextStep(
  asker: Asker,
  phase: CheckPhase,
  lastCheck: number | null,
  now: number,
): CheckStep {
  if (phase === 'ready') return asker === 'person' ? 'offer' : 'skip';
  if (phase === 'checking' || phase === 'downloading') return asker === 'person' ? 'join' : 'skip';
  if (asker === 'person') return 'check';
  return checkDue(lastCheck, now) ? 'check' : 'skip';
}

/**
 * When a downloaded update starts. One the person asked for is offered to them, and otherwise
 * starts only once the app is off screen from a safe screen, so it never restarts under them
 * while they decide. One the app found by itself starts at the next safe moment
 * (runtime/safe-restart.ts).
 */
export function restartRuleFor(asker: Asker): 'update' | 'offScreen' {
  return asker === 'person' ? 'offScreen' : 'update';
}

/** Worth downloading: a new update, or the server's word to go back to the built-in code. */
export function worthFetching(found: {
  isAvailable: boolean;
  isRollBackToEmbedded: boolean;
}): boolean {
  return found.isAvailable || found.isRollBackToEmbedded;
}

/** A download left something to start: a new update, or the way back to the built-in code. */
export function readyToStart(fetched: { isNew: boolean; isRollBackToEmbedded: boolean }): boolean {
  return fetched.isNew || fetched.isRollBackToEmbedded;
}

/** What the app runs, for Settings. */
export type Running =
  | { kind: 'builtIn' }
  | {
      kind: 'update';
      /** The update's id, its first eight characters (an update's id is a UUID). */
      id: string;
      /** When it was published, as "9 Nov 2026, 14:05", or null when the update does not say. */
      published: string | null;
    };

const publishedAt = dateFormatter('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * What the app runs, from expo-updates' constants: the code built into the APK, or an update.
 * A build that takes no updates always runs its built-in code.
 */
export function runningFrom(
  on: boolean,
  launch: { isEmbeddedLaunch: boolean; updateId: string | null; createdAt: Date | null },
): Running {
  if (!on || launch.isEmbeddedLaunch || !launch.updateId) return { kind: 'builtIn' };
  const published =
    launch.createdAt && !isNaN(launch.createdAt.getTime()) ? publishedAt(launch.createdAt) : null;
  return { kind: 'update', id: launch.updateId.slice(0, 8), published };
}
