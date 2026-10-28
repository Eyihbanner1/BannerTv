import type { InstalledAddon } from '@bannertv/core';
import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Artwork } from '../../components/Artwork';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { fallbackArt } from '../../components/Tile';
import { addonCollection } from '../../data/addons';
import { addonFocusId, typeLabel } from '../../data/describe';
import { PAIR_SERVICE } from '../../data/pairing';
import { canSlide } from '../../platform/input-mode';
import { ConfigureDialog } from './ConfigureDialog';
import { InstallDialog } from './InstallDialog';
import { clearInstallRequest, installRequested } from './install-request';
import styles from './AddonsScreen.module.css';

const CARD_STEP = 176;
const VISIBLE_CARDS = 4;
const ADD_BUTTON = 'addons-add';

// What each resource gives the user, in the order they are listed.
const RESOURCE_LABELS: ReadonlyArray<readonly [resource: string, key: string]> = [
  ['catalog', 'addons.resources.catalog'],
  ['meta', 'addons.resources.meta'],
  ['stream', 'addons.resources.stream'],
  ['subtitles', 'addons.resources.subtitles'],
];

const upKey = (addon: InstalledAddon) => `${addonFocusId(addon.transportUrl)}-up`;
const removeKey = (addon: InstalledAddon) => `${addonFocusId(addon.transportUrl)}-remove`;
const settingsKey = (addon: InstalledAddon) => `${addonFocusId(addon.transportUrl)}-settings`;
// Settings come through the phone, so they need the pairing relay too.
const hasSettings = (addon: InstalledAddon) =>
  Boolean(PAIR_SERVICE) && addon.manifest.behaviorHints.configurable;

interface AddonCardProps {
  addon: InstalledAddon;
  index: number;
  count: number;
  onFocus: () => void;
  onMove: (offset: number) => void;
  /** Absent when the addon has no settings page, or no phone can reach the TV. */
  onSettings?: () => void;
  onRemove: () => void;
}

function AddonCard(props: AddonCardProps) {
  const { addon, index, count, onFocus, onMove, onSettings, onRemove } = props;
  const { t } = useTranslation();
  const { manifest } = addon;
  const id = addonFocusId(addon.transportUrl);
  const types = manifest.types.map((type) => typeLabel(t, type));
  const gives = RESOURCE_LABELS.filter(([resource]) =>
    manifest.resources.some((r) => r.name === resource),
  ).map(([, key]) => t(key));
  const summary = [types.join(t('common.listSeparator')), gives.join(t('common.listSeparator'))]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={styles.card} style={{ top: index * CARD_STEP }}>
      <div className={styles.logo} style={{ backgroundImage: fallbackArt(index, 135) }}>
        <Artwork
          key={manifest.logo}
          src={manifest.logo}
          className={styles.logoImage}
          fallback={<span className={styles.initial}>{manifest.name.charAt(0)}</span>}
        />
      </div>
      <div className={styles.text}>
        <p className={styles.name}>
          {manifest.name}
          <span className={styles.version}>
            {t('addons.version', { version: manifest.version })}
          </span>
          {addon.official && <span className={styles.badge}>{t('addons.default')}</span>}
        </p>
        {summary && <p className={styles.summary}>{summary}</p>}
        {manifest.description && <p className={styles.description}>{manifest.description}</p>}
      </div>
      <div className={styles.actions}>
        <Button
          focusKey={`${id}-up`}
          label={t('addons.moveUp', { name: manifest.name })}
          onFocus={onFocus}
          onPress={() => index > 0 && onMove(-1)}
        >
          <span className={index > 0 ? undefined : styles.disabled}>{t('addons.up')}</span>
        </Button>
        <Button
          focusKey={`${id}-down`}
          label={t('addons.moveDown', { name: manifest.name })}
          onFocus={onFocus}
          onPress={() => index < count - 1 && onMove(1)}
        >
          <span className={index < count - 1 ? undefined : styles.disabled}>
            {t('addons.down')}
          </span>
        </Button>
        {onSettings && (
          <Button
            focusKey={`${id}-settings`}
            label={t('addons.settingsLabel', { name: manifest.name })}
            onFocus={onFocus}
            onPress={onSettings}
          >
            {t('addons.settings')}
          </Button>
        )}
        <Button
          focusKey={`${id}-remove`}
          label={t('addons.removeLabel', { name: manifest.name })}
          onFocus={onFocus}
          onPress={onRemove}
        >
          {t('addons.remove')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The installed addons in priority order: higher ones answer first for
 * titles, and their rows come first on Home. Add by address, move, remove.
 */
export function AddonsScreen() {
  const { t } = useTranslation();
  const { ready, addons } = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  const [focusedUrl, setFocusedUrl] = useState<string | null>(null);
  const [installing, setInstalling] = useState(installRequested);
  const [removing, setRemoving] = useState<InstalledAddon | null>(null);
  const [configuring, setConfiguring] = useState<InstalledAddon | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const afterRemove = useRef<string | null>(null);
  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: 'addons-list',
    saveLastFocusedChild: true,
  });

  // Opened from the first-run screen, the dialog places focus itself.
  const [openedWithDialog] = useState(installing);
  useEffect(clearInstallRequest, []);
  useScreenFocus(
    openedWithDialog ? undefined : addons.length > 0 ? upKey(addons[0]!) : ADD_BUTTON,
    ready,
  );

  // The focused card stays in view, one card below the top when it can.
  const focusedIndex = Math.max(
    0,
    addons.findIndex((a) => a.transportUrl === focusedUrl),
  );
  const anchor = Math.max(0, Math.min(focusedIndex - 1, addons.length - VISIBLE_CARDS));

  const move = (addon: InstalledAddon, offset: number, key: string) => {
    addonCollection.move(addon.transportUrl, offset);
    // React moves the card's element, which drops DOM focus; give it back.
    void setFocus(key);
  };

  const confirmRemove = (addon: InstalledAddon) => {
    const index = addons.indexOf(addon);
    const next = addons[index + 1] ?? addons[index - 1];
    afterRemove.current = next ? removeKey(next) : ADD_BUTTON;
    addonCollection.remove(addon.transportUrl);
    setNotice(t('addons.removed', { name: addon.manifest.name }));
    setRemoving(null);
  };

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('rail.addons')}</h1>
        <p className={styles.lead}>{notice ?? t('addons.lead')}</p>
        <Button
          variant="primary"
          focusKey={ADD_BUTTON}
          label={t('addons.add')}
          onPress={() => setInstalling(true)}
        />
      </div>
      {ready && addons.length === 0 ? (
        <p className={styles.empty}>{t('addons.none')}</p>
      ) : (
        <FocusContext.Provider value={focusKey}>
          <div ref={ref} className={styles.list}>
            <div
              className={styles.track}
              style={{ transform: `translateY(${-anchor * CARD_STEP}px)` }}
            >
              {addons.map((addon, index) => (
                <AddonCard
                  key={addon.transportUrl}
                  addon={addon}
                  index={index}
                  count={addons.length}
                  onFocus={() => {
                    if (canSlide()) setFocusedUrl(addon.transportUrl);
                  }}
                  onMove={(offset) => {
                    setFocusedUrl(addon.transportUrl);
                    move(
                      addon,
                      offset,
                      `${addonFocusId(addon.transportUrl)}-${offset < 0 ? 'up' : 'down'}`,
                    );
                  }}
                  onSettings={hasSettings(addon) ? () => setConfiguring(addon) : undefined}
                  onRemove={() => setRemoving(addon)}
                />
              ))}
            </div>
          </div>
        </FocusContext.Provider>
      )}
      {installing && (
        <InstallDialog
          returnFocusKey={ADD_BUTTON}
          focusAfterInstall={upKey}
          onInstalled={(addon, updated, dropped) => {
            setFocusedUrl(addon.transportUrl);
            const done = t(updated ? 'addons.updated' : 'addons.added', {
              name: addon.manifest.name,
            });
            setNotice(dropped ? `${done} ${t('addons.phone.dropped')}` : done);
            setInstalling(false);
          }}
          onClose={() => setInstalling(false)}
        />
      )}
      {configuring && (
        <ConfigureDialog
          addon={configuring}
          returnFocusKey={settingsKey(configuring)}
          // The new settings may come without a settings page, and so without the button.
          focusAfterUpdate={(addon) => (hasSettings(addon) ? settingsKey(addon) : upKey(addon))}
          onUpdated={(addon, dropped) => {
            setFocusedUrl(addon.transportUrl);
            const done = t('addons.configure.updated', { name: addon.manifest.name });
            setNotice(dropped ? `${done} ${t('addons.phone.dropped')}` : done);
            setConfiguring(null);
          }}
          onClose={() => setConfiguring(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          focusKey="remove-addon"
          title={t('addons.removeTitle', { name: removing.manifest.name })}
          message={t('addons.removeMessage')}
          confirmLabel={t('addons.remove')}
          cancelLabel={t('addons.keep')}
          returnFocusKey={() => afterRemove.current ?? removeKey(removing)}
          onConfirm={() => confirmRemove(removing)}
          onCancel={() => {
            afterRemove.current = null;
            setRemoving(null);
          }}
        />
      )}
    </div>
  );
}
