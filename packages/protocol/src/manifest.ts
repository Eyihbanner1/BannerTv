import {
  asRecord,
  readBoolean,
  readHttpUrl,
  readList,
  readPlainText,
  readString,
  readStringList,
} from './lenient';
import type {
  CatalogExtra,
  ContentType,
  Manifest,
  ManifestCatalog,
  ManifestResource,
  ResourceName,
} from './types';

/** A response that is unusable as a whole, as opposed to one bad item in it. */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

function parseResource(value: unknown): ManifestResource | undefined {
  if (typeof value === 'string') {
    const name = readString(value);
    return name === undefined ? undefined : { name };
  }
  const record = asRecord(value);
  const objectName = record && readString(record.name);
  if (!record || objectName === undefined) return undefined;
  const resource: ManifestResource = { name: objectName };
  if (Array.isArray(record.types)) resource.types = readStringList(record.types);
  if (Array.isArray(record.idPrefixes)) resource.idPrefixes = readStringList(record.idPrefixes);
  return resource;
}

/**
 * Catalog extras come in two forms: `extra` objects (current), or the legacy
 * `extraSupported` and `extraRequired` name lists with `genres` as options.
 */
function parseExtras(catalog: Record<string, unknown>): CatalogExtra[] {
  const extras: CatalogExtra[] = [];
  for (const item of readList(catalog.extra)) {
    const record = asRecord(item);
    const name = record && readString(record.name);
    if (!record || name === undefined || extras.some((e) => e.name === name)) continue;
    extras.push({
      name,
      isRequired: readBoolean(record.isRequired),
      options: readStringList(record.options),
    });
  }
  if (extras.length > 0) return extras;

  const required = readStringList(catalog.extraRequired);
  const legacyGenres = readStringList(catalog.genres);
  for (const name of readStringList(catalog.extraSupported).concat(required)) {
    if (extras.some((e) => e.name === name)) continue;
    extras.push({
      name,
      isRequired: required.indexOf(name) !== -1,
      options: name === 'genre' ? legacyGenres : [],
    });
  }
  return extras;
}

function parseCatalog(value: unknown): ManifestCatalog | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const type = readString(record.type);
  const id = readString(record.id);
  if (type === undefined || id === undefined) return undefined;
  return { type, id, name: readString(record.name) ?? id, extra: parseExtras(record) };
}

/**
 * Reads a manifest. Throws ProtocolError when a field the protocol requires is
 * missing; a bad catalog or resource entry is dropped instead.
 */
export function parseManifest(value: unknown): Manifest {
  const record = asRecord(value);
  if (!record) throw new ProtocolError('The manifest is not a JSON object');
  const id = readString(record.id);
  const version = readString(record.version);
  const name = readString(record.name);
  if (id === undefined) throw new ProtocolError('The manifest has no id');
  if (version === undefined) throw new ProtocolError('The manifest has no version');
  if (name === undefined) throw new ProtocolError('The manifest has no name');

  const resources: ManifestResource[] = [];
  for (const item of readList(record.resources)) {
    const resource = parseResource(item);
    if (resource && !resources.some((r) => r.name === resource.name)) resources.push(resource);
  }
  const catalogs: ManifestCatalog[] = [];
  for (const item of readList(record.catalogs)) {
    const catalog = parseCatalog(item);
    if (catalog && !catalogs.some((c) => c.type === catalog.type && c.id === catalog.id)) {
      catalogs.push(catalog);
    }
  }
  if (resources.length === 0 && catalogs.length === 0) {
    throw new ProtocolError('The manifest declares no resources');
  }

  const hints = asRecord(record.behaviorHints) ?? {};
  const manifest: Manifest = {
    id,
    version,
    name,
    types: readStringList(record.types),
    resources,
    catalogs,
    behaviorHints: {
      adult: readBoolean(hints.adult),
      p2p: readBoolean(hints.p2p),
      configurable: readBoolean(hints.configurable),
      configurationRequired: readBoolean(hints.configurationRequired),
    },
  };
  const description = readPlainText(record.description);
  if (description !== undefined) manifest.description = description;
  const logo = readHttpUrl(record.logo);
  if (logo !== undefined) manifest.logo = logo;
  const background = readHttpUrl(record.background);
  if (background !== undefined) manifest.background = background;
  if (Array.isArray(record.idPrefixes)) manifest.idPrefixes = readStringList(record.idPrefixes);
  return manifest;
}

/**
 * Whether an addon answers `resource` for this type and, when given, this ID.
 * Never guess: an addon is only asked for what its manifest declares.
 */
export function supportsResource(
  manifest: Manifest,
  resource: ResourceName,
  type: ContentType,
  id?: string,
): boolean {
  const entry = manifest.resources.find((r) => r.name === resource);
  if (!entry) return false;
  const types = entry.types ?? manifest.types;
  if (types.indexOf(type) === -1) return false;
  const prefixes = entry.idPrefixes ?? manifest.idPrefixes;
  if (id === undefined || prefixes === undefined) return true;
  return prefixes.some((prefix) => id.indexOf(prefix) === 0);
}

/**
 * Whether a catalog can be requested with exactly these extras: each one is
 * declared, and every required extra is among them.
 */
export function catalogAccepts(catalog: ManifestCatalog, extraNames: readonly string[]): boolean {
  return (
    extraNames.every((name) => catalog.extra.some((e) => e.name === name)) &&
    catalog.extra.every((e) => !e.isRequired || extraNames.indexOf(e.name) !== -1)
  );
}

export function findExtra(catalog: ManifestCatalog, name: string): CatalogExtra | undefined {
  return catalog.extra.find((e) => e.name === name);
}

/** Catalogs that need no extra, so they can be shown as rows on Home as they are. */
export function boardCatalogs(manifest: Manifest): ManifestCatalog[] {
  return manifest.catalogs.filter((catalog) => catalogAccepts(catalog, []));
}
