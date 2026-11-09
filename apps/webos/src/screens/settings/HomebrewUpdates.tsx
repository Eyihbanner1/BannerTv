import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import appinfo from '../../../webos-meta/appinfo.json';
import { Button } from '../../components/Button';
import { Menu } from '../../components/Menu';
import {
  checkHomebrewRepo,
  type HomebrewOpen,
  homebrewListSent,
  openHomebrewChannel,
  type RepoNews,
} from '../../data/homebrew';
import { fetchJson } from '../../platform/http';
import styles from './HomebrewUpdates.module.css';

const BUTTON_KEY = 'settings-homebrew';
const TITLE_ID = 'settings-updates-title';

/**
 * Settings > Updates, on an LG TV in a sideload build (data/homebrew.ts): the
 * build this TV runs, whether Homebrew Channel has a newer one, and a button
 * that opens Homebrew Channel to install it. The list is read once each time
 * Settings opens, after the screen has drawn, and an answer that never comes
 * or makes no sense leaves only the installed build showing.
 *
 * The first press opens Homebrew Channel on its Add repository dialog with
 * BannerTV's list filled in. Homebrew Channel would add the list a second time
 * if that were confirmed again, so after that the button asks: open Homebrew
 * Channel as it is, where BannerTV is in its apps, or fill in the dialog again,
 * for when it was closed without adding the list or the list was removed.
 */
export function HomebrewUpdates() {
  const { t } = useTranslation();
  const listSent = useSyncExternalStore(homebrewListSent.subscribe, homebrewListSent.get);
  const [news, setNews] = useState<RepoNews>({ kind: 'none' });
  const [didNotOpen, setDidNotOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  // A second OK while the TV is still opening Homebrew Channel opens nothing more.
  const opening = useRef(false);

  useEffect(() => {
    let current = true;
    void checkHomebrewRepo(fetchJson, appinfo.id, appinfo.version).then((answer) => {
      if (current) setNews(answer);
    });
    return () => {
      current = false;
    };
  }, []);

  const open = (how: HomebrewOpen) => {
    if (opening.current) return;
    opening.current = true;
    setDidNotOpen(false);
    openHomebrewChannel(how)
      .catch(() => setDidNotOpen(true))
      .finally(() => {
        opening.current = false;
      });
  };

  const line = didNotOpen
    ? t('updates.didNotOpen')
    : news.kind === 'ready'
      ? t('updates.ready', { version: news.version })
      : news.kind === 'latest'
        ? t('updates.latest')
        : news.kind === 'older'
          ? t('updates.older', { version: news.version })
          : '';

  return (
    <section className={styles.updates} aria-labelledby={TITLE_ID}>
      <div className={styles.status}>
        <div>
          <h2 id={TITLE_ID} className={styles.title}>
            {t('updates.title')}
          </h2>
          {' · '}
          {t('updates.installed', { version: appinfo.version })}
        </div>
        <p
          className={news.kind === 'ready' && !didNotOpen ? styles.ready : undefined}
          role="status"
        >
          {line}
        </p>
      </div>
      <Button
        block
        focusKey={BUTTON_KEY}
        label={t('updates.get')}
        onPress={() => (listSent ? setAsking(true) : open('add-list'))}
      />
      {asking && (
        <Menu
          focusKey="settings-homebrew-menu"
          title={t('updates.menuTitle')}
          options={[
            { value: 'open', label: t('updates.open') },
            { value: 'add-list', label: t('updates.addAgain') },
          ]}
          selected={undefined}
          returnFocusKey={BUTTON_KEY}
          onSelect={(value) => {
            setAsking(false);
            open(value as HomebrewOpen);
          }}
          onClose={() => setAsking(false)}
        />
      )}
    </section>
  );
}
