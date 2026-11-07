import {
  followsHas,
  followTargets,
  type FollowTarget,
  MAX_FOLLOWS,
  type SportEvent,
} from '@bannertv/core';
import { sportsFollows } from '@tv/data/sports';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../ui/Button';
import { colors, space, type } from '../../ui/theme';
import { useFollows } from './use-sports';

/**
 * The match page's Follow toggles (SP2), as on the TV
 * (apps/webos/src/screens/sports/FollowButtons.tsx): the home side, the away
 * side and the competition, each where it can be followed.
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
    <View style={styles.follows}>
      {targets.map((target, index) => {
        const on = followsHas(follows, target);
        return (
          <Button
            key={`${target.kind}-${index}`}
            kind={on ? 'primary' : 'secondary'}
            icon={on ? 'check' : 'plus'}
            label={t(on ? 'sportsFollow.following' : 'sportsFollow.follow', { name: target.name })}
            onPress={() => toggle(target)}
            style={styles.wide}
          />
        );
      })}
      {full ? (
        <Text style={styles.full} accessibilityLiveRegion="polite">
          {t('sportsFollow.full', { count: MAX_FOLLOWS })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  follows: { gap: space.s, marginBottom: space.s },
  wide: { alignSelf: 'stretch' },
  full: { ...type.small, color: colors.textMuted },
});
