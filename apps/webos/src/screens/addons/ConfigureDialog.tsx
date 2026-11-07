import type { InstalledAddon } from '@bannertv/core';
import { addonBaseUrl } from '@bannertv/protocol';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Overlay } from '../../components/Overlay';
import { allAddons } from '../../data/addons';
import { describeInstallError } from '../../data/describe';
import styles from './AddonsScreen.module.css';
import { PhonePanel } from './PhonePanel';

interface ConfigureDialogProps {
  addon: InstalledAddon;
  returnFocusKey: string;
  /** Where focus goes once the new settings are in: usually the addon's card. */
  focusAfterUpdate: (addon: InstalledAddon) => string;
  /** `dropped`: another address came from the phone during the update and was not used. */
  onUpdated: (addon: InstalledAddon, dropped: boolean) => void;
  onClose: () => void;
}

/**
 * Changes an addon's settings on the phone: the QR code opens the addon's own
 * settings page through the pairing page, and the install link the addon
 * gives back replaces this addon in place.
 */
export function ConfigureDialog(props: ConfigureDialogProps) {
  const { addon, returnFocusKey, focusAfterUpdate, onUpdated, onClose } = props;
  const { t } = useTranslation();
  const name = addon.manifest.name;
  const [received, setReceived] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updated = useRef<string | null>(null);
  // Set at once on Update, so an address that comes before the next render sees it.
  const busy = useRef(false);
  // An address that arrives during an update: the relay has already let it go.
  const pending = useRef<string | null>(null);
  useEffect(
    () => () => {
      pending.current = null;
    },
    [],
  );

  const receive = (url: string) => {
    if (busy.current) {
      pending.current = url;
      return;
    }
    setReceived(url);
    setError(null);
  };

  // Update appears with the first address; focus waits for it to mount.
  useEffect(() => {
    if (received !== null) setFocus('configure-confirm');
  }, [received]);

  const update = () => {
    if (busy.current || received === null) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    allAddons.install(received, { replaces: addon.transportUrl }).then(
      (next) => {
        updated.current = focusAfterUpdate(next);
        onUpdated(next, pending.current !== null);
      },
      (failure: unknown) => {
        busy.current = false;
        setWorking(false);
        const next = pending.current;
        pending.current = null;
        if (next === null) setError(describeInstallError(t, failure));
        else setReceived(next);
      },
    );
  };

  // The update finishes once it has started: closing then would leave focus
  // on a card that is about to be replaced.
  const close = () => {
    if (!busy.current) onClose();
  };

  let status: string | null = null;
  if (working) status = t('addons.installing');
  else if (error) status = error;
  else if (received !== null) status = t('addons.configure.received', { name });

  return (
    <Overlay
      focusKey="configure"
      label={t('addons.configure.title', { name })}
      defaultFocusKey="configure-cancel"
      returnFocusKey={() => updated.current ?? returnFocusKey}
      onClose={close}
      placement="center"
    >
      <h2 className={styles.dialogTitle}>{t('addons.configure.title', { name })}</h2>
      <div className={styles.installBody}>
        <div className={styles.installMain}>
          <p className={styles.dialogLead}>{t('addons.configure.lead', { name })}</p>
          <p className={error && !working ? styles.error : styles.status} role="status">
            {status}
          </p>
          <div className={styles.dialogActions}>
            {received !== null && (
              <Button
                variant="primary"
                focusKey="configure-confirm"
                label={t('addons.configure.update')}
                onPress={update}
              />
            )}
            <Button focusKey="configure-cancel" label={t('common.cancel')} onPress={close} />
          </div>
        </div>
        <PhonePanel
          title={t('addons.configure.scanTitle')}
          configureUrl={`${addonBaseUrl(addon.transportUrl)}/configure`}
          onAddress={receive}
          focusAfterRetry="configure-cancel"
        />
      </div>
    </Overlay>
  );
}
