import { useTranslation } from 'react-i18next';
import { back } from '../app/router';
import { useScreenFocus } from '../app/use-screen-focus';
import { Button } from '../components/Button';
import { artGradient, findSampleItem } from './home/sample-data';
import styles from './Screen.module.css';

export function DetailsScreen({ itemId }: { itemId: string }) {
  const { t } = useTranslation();
  const item = findSampleItem(itemId);
  useScreenFocus('details-back');

  return (
    <div
      className={styles.screen}
      style={
        item
          ? {
              backgroundImage: `linear-gradient(90deg, #0B0815 45%, rgba(11, 8, 21, 0.4)), ${artGradient(item, 120)}`,
            }
          : undefined
      }
    >
      <h1 className={styles.title}>{item?.title ?? itemId}</h1>
      <p className={styles.lead}>{t('details.lead', { year: item?.year ?? '' })}</p>
      <Button focusKey="details-back" label={t('common.back')} onPress={() => back()} />
    </div>
  );
}
