/**
 * BannerTV's Homebrew Channel repository, served by the updates Worker
 * (services/updates): the only place the address is written. Settings reads
 * it and hands it to Homebrew Channel (data/homebrew.ts), and the journeys
 * answer for it. It imports nothing, so the journeys can import it too.
 */
export const HOMEBREW_REPO_URL = 'https://updates.bannertv.workers.dev/webos/repo.json';

/** Homebrew Channel's own app id on the TV. */
export const HOMEBREW_CHANNEL_ID = 'org.webosbrew.hbchannel';
