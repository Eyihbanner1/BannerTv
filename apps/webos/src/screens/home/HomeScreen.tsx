import { getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Row } from '../../components/Row';
import { useBack } from '../../navigation/use-back';
import { inputMode } from '../../platform/input-mode';
import { Hero } from './Hero';
import { heroItem } from './hero-item';
import { SAMPLE_ROWS } from './sample-data';
import styles from './HomeScreen.module.css';

const FIRST_ROW = 'home-row-0';

export function HomeScreen() {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);

  useScreenFocus(FIRST_ROW);

  // On Home, Back first returns to the first row. Only from there does it exit.
  useBack('screen', () => {
    if (getCurrentFocusKey().startsWith(`${FIRST_ROW}-`)) return false;
    void setFocus(FIRST_ROW);
    return true;
  });

  return (
    <div className={styles.home}>
      <Hero />
      <div className={styles.rows}>
        <div ref={trackRef} className={styles.track}>
          {SAMPLE_ROWS.map((row, index) => (
            <Row
              key={row.id}
              focusKey={`home-row-${index}`}
              title={t(row.titleKey)}
              shape={row.shape}
              items={row.items}
              onItemFocus={(item, rowElement) => {
                heroItem.set(item);
                // The focused row moves to the top of the rows area (not under the pointer).
                if (trackRef.current && inputMode.get() === 'keys') {
                  trackRef.current.style.transform = `translateY(${-rowElement.offsetTop}px)`;
                }
              }}
              onItemPress={(item) => push({ name: 'details', itemId: item.id })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
