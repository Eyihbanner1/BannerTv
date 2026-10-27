import type { InstalledAddon } from '@bannertv/core';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Overlay } from '../../components/Overlay';
import { TextField } from '../../components/TextField';
import { addonCollection } from '../../data/addons';
import { describeInstallError } from '../../data/describe';
import styles from './AddonsScreen.module.css';

interface InstallDialogProps {
  returnFocusKey: string;
  /** Where focus goes once the addon is in: usually its card. */
  focusAfterInstall: (addon: InstalledAddon) => string;
  onInstalled: (addon: InstalledAddon, updated: boolean) => void;
  onClose: () => void;
}

/** Adds an addon from its address, typed or spoken on the TV keyboard. */
export function InstallDialog(props: InstallDialogProps) {
  const { returnFocusKey, focusAfterInstall, onInstalled, onClose } = props;
  const { t } = useTranslation();
  const [address, setAddress] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const installed = useRef<string | null>(null);

  const install = () => {
    if (working) return;
    const before = addonCollection.get().addons.map((a) => a.transportUrl);
    setWorking(true);
    setError(null);
    addonCollection.install(address).then(
      (addon) => {
        installed.current = focusAfterInstall(addon);
        onInstalled(addon, before.indexOf(addon.transportUrl) !== -1);
      },
      (failure: unknown) => {
        setWorking(false);
        setError(describeInstallError(t, failure));
      },
    );
  };

  return (
    <Overlay
      focusKey="install"
      label={t('addons.installTitle')}
      defaultFocusKey="install-field"
      returnFocusKey={() => installed.current ?? returnFocusKey}
      onClose={onClose}
      placement="center"
    >
      <h2 className={styles.dialogTitle}>{t('addons.installTitle')}</h2>
      <p className={styles.dialogLead}>{t('addons.installLead')}</p>
      <TextField
        focusKey="install-field"
        type="url"
        label={t('addons.addressLabel')}
        placeholder={t('addons.addressPlaceholder')}
        value={address}
        onChange={setAddress}
        onSubmit={install}
      />
      <p className={error ? styles.error : styles.status} role="status">
        {working ? t('addons.installing') : error}
      </p>
      <div className={styles.dialogActions}>
        <Button
          variant="primary"
          focusKey="install-confirm"
          label={t('addons.install')}
          onPress={install}
        />
        <Button focusKey="install-cancel" label={t('common.cancel')} onPress={onClose} />
      </div>
    </Overlay>
  );
}
