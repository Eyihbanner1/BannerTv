import { useFocusEffect } from 'expo-router';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, Text, View } from 'react-native';
import {
  allowEpisodeAlerts,
  episodeAlertsOn,
  episodeAlertsPermitted,
} from '../data/episode-alerts';
import { ListRow } from '../ui/Button';
import { colors, radius, space, type } from '../ui/theme';

/**
 * Settings > Notifications: New episode alerts, for grown-ups only (Settings shows a kids
 * profile none of its sections). Off until the person switches it on, and the phone asks for
 * the permission to notify then, never at launch, as Remind me does: an alert nobody asked for
 * is how notifications get turned off for the whole app, match reminders included. Each profile
 * has its own switch, kept on this phone.
 */
export function EpisodeAlertsSection() {
  const { t } = useTranslation();
  const on = useSyncExternalStore(episodeAlertsOn.subscribe, episodeAlertsOn.get);
  const [denied, setDenied] = useState(false);
  const [asking, setAsking] = useState(false);
  const title = t('phone.episodeAlerts.setting');

  // Each visit: notifications may have been turned off in the phone's settings since.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      if (on) {
        void episodeAlertsPermitted().then((allowed) => {
          if (live) setDenied(!allowed);
        });
      }
      return () => {
        live = false;
      };
    }, [on]),
  );

  const change = (next: boolean) => {
    if (asking) return;
    if (!next) {
      episodeAlertsOn.set(false);
      setDenied(false);
      return;
    }
    setAsking(true);
    void allowEpisodeAlerts().then((allowed) => {
      setAsking(false);
      setDenied(!allowed);
      if (allowed) episodeAlertsOn.set(true);
    });
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {t('phone.episodeAlerts.section')}
      </Text>
      <View style={styles.sectionBody}>
        <ListRow
          title={title}
          onPress={() => change(!on)}
          disabled={asking}
          right={
            <Switch
              value={on}
              onValueChange={change}
              disabled={asking}
              trackColor={{ true: colors.action, false: colors.surface3 }}
              thumbColor={colors.text}
              accessibilityLabel={title}
            />
          }
        />
      </View>
      <Text style={styles.note}>{t('phone.episodeAlerts.lead')}</Text>
      {denied ? (
        <Text style={styles.note} accessibilityLiveRegion="polite">
          {t('phone.episodeAlerts.denied')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.s },
  sectionTitle: { ...type.overline, color: colors.accent },
  // The 1-unit gaps show the raised colour behind the rows: the dividers.
  sectionBody: {
    borderRadius: radius.l,
    overflow: 'hidden',
    gap: 1,
    backgroundColor: colors.raised,
  },
  note: { ...type.small, color: colors.textSubtle, paddingHorizontal: space.m },
});
