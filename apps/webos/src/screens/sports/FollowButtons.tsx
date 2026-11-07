import {
  followsHas,
  followTargets,
  type FollowTarget,
  MAX_FOLLOWS,
  type SportEvent,
} from '@bannertv/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { sportsFollows } from '../../data/sports';
import { useFollows } from './use-sports';
import styles from './EventScreen.module.css';

/** The focus key of the match page's first Follow button. */
export const FIRST_FOLLOW_KEY = 'event-follow-0';

/**
 * The match page's Follow buttons (SP2): the home side, the away side and the
 * competition, each where it can be followed. A followed one says Following,
 * and OK on it unfollows. They sit under Watch, so a press never starts a stream.
 */
export function FollowButtons({ event }: { event: SportEvent }) {
  const { t } = useTranslation();
  const follows = useFollows();
  const [full, setFull] = useState(false);
  const targets = followTargets(event);
  if (targets.length === 0) return null;

  const toggle = (target: FollowTarget) => {
    if (followsHas(follows, target)) {
      setFull(false);
      void sportsFollows.unfollow(target);
      return;
    }
    void sportsFollows.follow(target).then((followed) => setFull(!followed));
  };

  return (
    <div className={styles.follows}>
      {targets.map((target, index) => (
        <Button
          key={`${target.kind}-${index}`}
          focusKey={`event-follow-${index}`}
          label={t(followsHas(follows, target) ? 'sportsFollow.following' : 'sportsFollow.follow', {
            name: target.name,
          })}
          onPress={() => toggle(target)}
        />
      ))}
      {full && (
        <p className={styles.followsFull} role="status">
          {t('sportsFollow.full', { count: MAX_FOLLOWS })}
        </p>
      )}
    </div>
  );
}
