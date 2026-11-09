import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shareReport } from '../runtime/crash-catcher';
import { ListRow } from '../ui/Button';

/**
 * Settings > Send a report: Android's share sheet with the report of recent problems as plain
 * text (runtime/crash-catcher.ts). Under This app, so for grown-ups only, as the TV keeps
 * reports from kids. With nothing gone wrong it still sends the app's version and screens.
 */
export function SendReportRow() {
  const { t } = useTranslation();
  const [sharing, setSharing] = useState(false);
  const [notShared, setNotShared] = useState(false);
  return (
    <ListRow
      title={t('phone.sendReport')}
      detail={t('phone.sendReportDetail')}
      {...(notShared ? { value: t('phone.reportNotSharedShort') } : {})}
      disabled={sharing}
      onPress={() => {
        setSharing(true);
        void shareReport(t('phone.reportTitle')).then((shared) => {
          setSharing(false);
          setNotShared(!shared);
        });
      }}
    />
  );
}
