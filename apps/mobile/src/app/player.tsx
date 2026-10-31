import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { goBack, handed, type PlayerRoute } from '../nav/routes';
import { useScreenName } from '../nav/use-screen';
import { PlayerScreen } from '../player/PlayerScreen';

export default function Route() {
  useScreenName('player');
  const { key } = useLocalSearchParams<{ key?: string }>();
  const route = handed<PlayerRoute>(key);
  // After Android restarted the app the player's stream is gone: back to where it was.
  useEffect(() => {
    if (!route) goBack();
  }, [route]);
  if (!route) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  return <PlayerScreen key={route.videoId} route={route} />;
}
