import {
  type AddonHealth,
  type InstalledAddon,
  installIdOf,
  type SportsSetting,
} from '@bannertv/core';
import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Artwork } from '../../components/Artwork';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Menu } from '../../components/Menu';
import { fallbackArt } from '../../components/Tile';
import { addonHealth, addonSwitches, allAddons, checkAddon, switchAddon } from '../../data/addons';
import { addonFocusId, healthLine, typeLabel } from '../../data/describe';
import { PAIR_SERVICE } from '../../data/pairing';
import { mayHoldSports, setSportsSetting, sportsSetting, sportsState } from '../../data/sports';
import { syncOn } from '../../data/sync-clock';
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
const sportsKey = (addon: InstalledAddon) => `${addonFocusId(addon.transportUrl)}-sports`;
const SPORTS_SETTINGS: readonly SportsSetting[] = ['auto', 'yes', 'no'];
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
  /** "Show in Sports", for addons that may hold sport. */
  onSports?: () => void;
  /** How it last answered, when this screen has asked it. */
  health: AddonHealth | undefined;
  /** Check now is asking it. */
  checking: boolean;
  onCheck: () => void;
  /** Switched off: installed, with its settings, but asked nothing. */
  off: boolean;
  onSwitch: () => void;
  onRemove: () => void;
}

function AddonCard(props: AddonCardProps) {
  const { addon, index, count, onFocus, onMove, onSettings, onSports, onRemove } = props;
  const { health, checking, onCheck, off, onSwitch } = props;
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
  // Not answering or slow takes the description's line, so the card keeps its height. An addon
  // switched off is asked nothing, so how it last answered is no news.
  const answering = off ? undefined : checking ? t('addonState.checking') : healthLine(t, health);
  const failed = !checking && health?.state === 'failed';

  return (
    <div
      className={off ? `${styles.card} ${styles.off}` : styles.card}
      style={{ top: index * CARD_STEP }}
    >
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
        {off ? (
          <p className={styles.state}>{t('addonState.offLine')}</p>
        ) : answering ? (
          <p className={failed ? styles.failing : styles.state} role="status">
            {answering}
          </p>
        ) : (
          manifest.description && <p className={styles.description}>{manifest.description}</p>
        )}
      </div>
      <div className={styles.actions}>
        {/* First, so every other button keeps its place and the way to it. */}
        <Button
          focusKey={`${id}-switch`}
          label={t(off ? 'addonState.switchOnLabel' : 'addonState.switchOffLabel', {
            name: manifest.name,
          })}
          onFocus={onFocus}
          onPress={onSwitch}
        >
          {t(off ? 'common.off' : 'common.on')}
        </Button>
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
        {onSports && (
          <Button
            focusKey={`${id}-sports`}
            label={t('addons.sportsLabel', {
              name: manifest.name,
              value: t(`addons.sportsValue.${sportsSetting(addon)}`),
            })}
            onFocus={onFocus}
            onPress={onSports}
          >
            {t('addons.sports')}
          </Button>
        )}
        {answering !== undefined && (
          <Button
            focusKey={`${id}-check`}
            label={t('addonState.checkNowLabel', { name: manifest.name })}
            onFocus={onFocus}
            onPress={onCheck}
          >
            {t('addonState.checkNow')}
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
  // Every install, those switched off included: this is where they are switched on again.
  const { ready, addons } = useSyncExternalStore(allAddons.subscribe, allAddons.get);
  const { off } = useSyncExternalStore(addonSwitches.subscribe, addonSwitches.get);
  const [focusedUrl, setFocusedUrl] = useState<string | null>(null);
  const [installing, setInstalling] = useState(installRequested);
  const [removing, setRemoving] = useState<InstalledAddon | null>(null);
  const [configuring, setConfiguring] = useState<InstalledAddon | null>(null);
  const [sportsFor, setSportsFor] = useState<InstalledAddon | null>(null);
  const health = useSyncExternalStore(addonHealth.subscribe, addonHealth.get);
  const [checking, setChecking] = useState<readonly string[]>([]);
  // Detection changes which addons offer "Show in Sports".
  useSyncExternalStore(sportsState.subscribe, sportsState.get);
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
    allAddons.move(addon.transportUrl, offset);
    // React moves the card's element, which drops DOM focus; give it back.
    void setFocus(key);
  };

  /**
   * Asks the addon for its manifest once and says how it went. A good answer
   * takes Check now away, so focus moves to the button in its place first.
   */
  const check = (addon: InstalledAddon) => {
    const installId = installIdOf(addon);
    if (checking.indexOf(installId) !== -1) return;
    setChecking((ids) => ids.concat(installId));
    void checkAddon(addon).then(() => {
      setChecking((ids) => ids.filter((one) => one !== installId));
      const state = addonHealth.get().get(installId)?.state;
      const name = addon.manifest.name;
      if (state === 'fine') {
        void setFocus(removeKey(addon));
        setNotice(t('addonState.answering', { name }));
      } else {
        setNotice(
          t(state === 'slow' ? 'addonState.answeringSlowly' : 'addonState.stillNotAnswering', {
            name,
          }),
        );
      }
    });
  };

  /**
   * Switches the addon off, keeping its settings and its place, or back on,
   * and says what that does. In an account it reaches every screen, as the
   * addons do.
   */
  const toggle = (addon: InstalledAddon) => {
    const name = addon.manifest.name;
    const switchingOff = !off.has(installIdOf(addon));
    switchAddon(addon, switchingOff);
    if (!switchingOff) setNotice(t('addonState.switchedOn', { name }));
    else {
      setNotice(
        t(syncOn() ? 'addonState.switchedOffEverywhere' : 'addonState.switchedOff', { name }),
      );
    }
  };

  const confirmRemove = (addon: InstalledAddon) => {
    const index = addons.indexOf(addon);
    const next = addons[index + 1] ?? addons[index - 1];
    afterRemove.current = next ? removeKey(next) : ADD_BUTTON;
    // Its switch goes with it (createAddonSwitches follows removals).
    allAddons.remove(addon.transportUrl);
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
                  onSports={mayHoldSports(addon) ? () => setSportsFor(addon) : undefined}
                  health={health.get(installIdOf(addon))}
                  checking={checking.indexOf(installIdOf(addon)) !== -1}
                  onCheck={() => check(addon)}
                  off={off.has(installIdOf(addon))}
                  onSwitch={() => toggle(addon)}
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
      {sportsFor && (
        <Menu
          focusKey="addon-sports-menu"
          title={t('addons.sportsTitle', { name: sportsFor.manifest.name })}
          options={SPORTS_SETTINGS.map((value) => ({
            value,
            label: t(`addons.sportsValue.${value}`),
          }))}
          selected={sportsSetting(sportsFor)}
          returnFocusKey={sportsKey(sportsFor)}
          onSelect={(value) => {
            setSportsSetting(sportsFor, value as SportsSetting);
            setSportsFor(null);
          }}
          onClose={() => setSportsFor(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          focusKey="remove-addon"
          title={t('addons.removeTitle', { name: removing.manifest.name })}
          // In an account the addons are the account's, so removing one reaches every screen.
          message={t(syncOn() ? 'addonState.removeEverywhere' : 'addons.removeMessage')}
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
