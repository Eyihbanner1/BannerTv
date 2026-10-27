import { HttpError, InstallError, NotFoundError } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import type { TFunction } from 'i18next';

/** "Movies", "Series", or the addon's own type name when it is not a known one. */
export function typeLabel(t: TFunction, type: string): string {
  return t(`types.${type}`, { defaultValue: type.charAt(0).toUpperCase() + type.slice(1) });
}

/** A sentence for the user that names the addon, never its URL. */
export function describeAddonError(t: TFunction, error: Error | undefined, addon: string): string {
  if (error instanceof NotFoundError) return t('addonError.notFound');
  if (error instanceof HttpError) {
    return t(`addonError.${error.kind}`, { addon, status: error.status ?? '' });
  }
  if (error && error.name === 'ProtocolError') return t('addonError.invalid', { addon });
  return t('addonError.other', { addon });
}

/** Year, rating and runtime, for the line under a title. */
export function metaFacts(t: TFunction, item: MetaPreview): string[] {
  const facts: string[] = [];
  if (item.releaseInfo) facts.push(item.releaseInfo);
  if (item.imdbRating) facts.push(t('meta.rating', { rating: item.imdbRating }));
  if (item.runtime) facts.push(item.runtime);
  return facts;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Why an addon could not be added, for the user. */
export function describeInstallError(t: TFunction, error: unknown): string {
  if (error instanceof InstallError) return t(`addons.installError.${error.kind}`);
  return t('addons.installError.other');
}

/**
 * A short stable id for an installed addon, for focus keys. Addon URLs can
 * carry account keys, so the URL itself never goes into the page.
 */
export function addonFocusId(transportUrl: string): string {
  let hash = 5381;
  for (let i = 0; i < transportUrl.length; i++) {
    hash = ((hash << 5) + hash + transportUrl.charCodeAt(i)) | 0;
  }
  return `addon-${(hash >>> 0).toString(36)}`;
}
