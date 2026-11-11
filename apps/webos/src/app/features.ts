/**
 * Sports ships in the sideload build only at first (docs/PLAN.md, Sports
 * addons, Store and privacy). Set this to false for the LG store build: the
 * rail entry, the Sports screen, the Live sport row and the Sports group in
 * Search stay hidden, sports catalogs stay on Home and in Search as before,
 * and the team and league data is never loaded.
 */
export const SPORTS_IN_BUILD = true;

/**
 * Updates through Homebrew Channel, for sideloaded test builds on an LG TV
 * (docs/TV_SETUP.md, Updates through Homebrew Channel). On for now, as every
 * build is a sideload test build. Set this to false for the LG store build:
 * Settings leaves out Updates, never asks the updates Worker for its list and
 * never opens Homebrew Channel. The store updates the app itself.
 */
export const HOMEBREW_UPDATES_IN_BUILD = true;

/**
 * Signed updates inside the app, on an LG TV (src/shell; services/updates,
 * "In-app updates on the LG"). On for now, as every build is a sideload test
 * build, though only a build of main takes any, and only once the update key
 * is committed (apps/webos/certs/lg-updates.pem). Set this to false for the
 * LG store build: its loader starts the app from the .ipk's own files only,
 * never asks the updates Worker and never stores code. The store updates the
 * app itself, and LG has not said whether a store app may update its code.
 */
export const LG_UPDATES_IN_BUILD = true;
