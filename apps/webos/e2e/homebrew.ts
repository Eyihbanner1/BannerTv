import type { Page, Request } from '@playwright/test';
import { HOMEBREW_CHANNEL_ID, HOMEBREW_REPO_URL } from '../src/data/homebrew-repo';

export { HOMEBREW_CHANNEL_ID, HOMEBREW_REPO_URL };

/** A Luna call as the page sent it through the TV's service bridge. */
export interface LunaCall {
  uri: string;
  params: Record<string, unknown>;
}

export interface LgTvOptions {
  /** Apps not on this TV: launching one fails as the application manager fails it. */
  missing?: string[];
}

/**
 * Makes the page an LG TV's: webOS's PalmSystem, and a service bridge that
 * notes every Luna call and answers each at once, a launch as the
 * application manager does. Every other call answers with plain success.
 */
export async function openAsLgTv(page: Page, options: LgTvOptions = {}): Promise<void> {
  await page.addInitScript((missing: string[]) => {
    const calls: { uri: string; params: Record<string, unknown> }[] = [];
    const answer = (uri: string, params: Record<string, unknown>): Record<string, unknown> => {
      if (uri === 'luna://com.webos.applicationManager/launch') {
        const id = String(params.id);
        // As close as we know to the application manager's answer for an app the TV lacks.
        return missing.indexOf(id) >= 0
          ? {
              returnValue: false,
              errorCode: -101,
              errorText: `"${id}" was not found OR Unsupported Application Type`,
            }
          : { returnValue: true, processId: '1001' };
      }
      return { returnValue: true };
    };
    Object.assign(window, {
      lunaCalls: calls,
      PalmSystem: {
        deviceInfo: JSON.stringify({ modelName: '65NANO766QA', platformVersion: '7.4.0' }),
        launchParams: '{}',
      },
      PalmServiceBridge: class {
        onservicecallback: ((message: string) => void) | null = null;
        call(uri: string, payload: string) {
          const params = JSON.parse(payload) as Record<string, unknown>;
          calls.push({ uri, params });
          setTimeout(() => this.onservicecallback?.(JSON.stringify(answer(uri, params))), 0);
        }
        cancel() {}
      },
    });
  }, options.missing ?? []);
}

/** Every Luna call the page has sent, oldest first. */
export function lunaCalls(page: Page): Promise<LunaCall[]> {
  return page.evaluate(() => (window as unknown as { lunaCalls: LunaCall[] }).lunaCalls);
}

/** The application manager launches the page has asked for, oldest first. */
export async function launches(page: Page): Promise<Record<string, unknown>[]> {
  return (await lunaCalls(page))
    .filter((call) => call.uri === 'luna://com.webos.applicationManager/launch')
    .map((call) => call.params);
}

const SHA = '5f0c'.repeat(16);

/**
 * BannerTV's Homebrew Channel list as the updates Worker serves it, with one
 * build of `version`: absolute https addresses, the .ipk named by its
 * SHA-256, and the Worker's own extra fields, which Homebrew Channel ignores.
 */
export function repoWith(version: string) {
  const icon = new URL(`icon/${SHA}.png`, HOMEBREW_REPO_URL).href;
  return {
    packages: [
      {
        id: 'com.bannertv.app',
        title: 'BannerTV',
        iconUri: icon,
        shortDescription: 'Films and series from the addons you choose.',
        commit: '9f8e7d6',
        publishedAt: '2026-11-09T18:00:00.000Z',
        manifest: {
          id: 'com.bannertv.app',
          version,
          type: 'web',
          title: 'BannerTV',
          appDescription: 'Films and series from the addons you choose, in one place.',
          iconUri: icon,
          ipkUrl: new URL(`ipk/${SHA}.ipk`, HOMEBREW_REPO_URL).href,
          ipkHash: { sha256: SHA },
          ipkSize: 2345678,
          rootRequired: false,
        },
      },
    ],
  };
}

/** What the fake repository answers: JSON to send, text as it is, or no answer at all. */
export type RepoAnswer = { json: unknown } | { text: string; status?: number } | 'no answer';

export interface FakeRepo {
  /** What the next request gets. */
  answer: RepoAnswer;
  /** Every request for the list, as it arrived. */
  readonly requests: Request[];
}

/** Answers for BannerTV's Homebrew Channel list. Call after mockAddons, which fails every request. */
export async function mockHomebrewRepo(page: Page, answer: RepoAnswer): Promise<FakeRepo> {
  const repo: FakeRepo = { answer, requests: [] };
  await page.route(HOMEBREW_REPO_URL, (route) => {
    repo.requests.push(route.request());
    const now = repo.answer;
    if (now === 'no answer') return route.abort();
    const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-cache' };
    return 'json' in now
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers,
          body: JSON.stringify(now.json),
        })
      : route.fulfill({
          status: now.status ?? 200,
          contentType: 'text/plain',
          headers,
          body: now.text,
        });
  });
  return repo;
}
