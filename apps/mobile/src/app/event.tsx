import type { SportEvent } from '@bannertv/core';
import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { goBack, handed } from '../nav/routes';
import { useScreenName } from '../nav/use-screen';
import { EventScreen } from '../screens/sports/EventScreen';
import { useSportsShown } from '../screens/sports/use-sports';

export default function Route() {
  useScreenName('event');
  const { key } = useLocalSearchParams<{ key?: string }>();
  const event = handed<SportEvent>(key);
  // After Android restarted the app the event is gone; and a kids profile has no Sports.
  const shown = useSportsShown();
  const open = !!event && shown;
  useEffect(() => {
    if (!open) goBack();
  }, [open]);
  if (!event || !open) return <View style={{ flex: 1 }} />;
  return <EventScreen key={event.key} event={event} />;
}
