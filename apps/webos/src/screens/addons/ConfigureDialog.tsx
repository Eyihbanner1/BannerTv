import type { InstalledAddon } from '@bannertv/core';
import { addonBaseUrl } from '@bannertv/protocol';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Overlay } from '../../components/Overlay';
import { addonCollection } from '../../data/addons';
import { describeInstallError } from '../../data/describe';
import styles from './AddonsScreen.module.css';
import { PhonePanel } from './PhonePanel';

interface ConfigureDialogProps {
  addon: InstalledAddon;
  returnFocusKey: string;
  /** Where focus goes once the new settings are in: usually the addon's card. */
  focusAfterUpdate: (addon: InstalledAddon) => string;
  onUpdated: (addon: InstalledAddon) => void;
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

  const receive = (url: string) => {
    if (working) return;
    setReceived(url);
    setError(null);
  };

  // Update appears with the first address; focus waits for it to mount.
  useEffect(() => {
    if (received !== null) setFocus('configure-confirm');
  }, [received]);

  const update = () => {
    if (working || received === null) return;
    setWorking(true);
    setError(null);
    addonCollection.install(received, { replaces: addon.transportUrl }).then(
      (next) => {
        updated.current = focusAfterUpdate(next);
        onUpdated(next);
      },
      (failure: unknown) => {
        setWorking(false);
        setError(describeInstallError(t, failure));
      },
    );
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
      onClose={onClose}
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
            <Button focusKey="configure-cancel" label={t('common.cancel')} onPress={onClose} />
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
