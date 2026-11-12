/**
 * What an update cannot change, beside the loader and index.html themselves,
 * and so goes into the runtime version (build/shell.ts): a build that changes
 * one of these reaches a TV only in a new .ipk. Imported by the build, so
 * nothing here may touch the page.
 */

/**
 * The version of the app's own IndexedDB database, `bannertv` (platform/idb.ts).
 * A database opened at a higher version cannot be opened again at a lower one,
 * so an update that raised it, and then failed and fell back to the .ipk's
 * older code, would leave the app without its data. Raising it therefore
 * means a new .ipk: the runtime version changes, and no TV is offered the
 * update over the air.
 */
export const APP_DB_VERSION = 1;
