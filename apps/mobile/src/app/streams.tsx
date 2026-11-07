import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { goBack, handed, type StreamsRoute } from '../nav/routes';
import { useScreenName } from '../nav/use-screen';
import { StreamsScreen } from '../screens/StreamsScreen';

export default function Route() {
  useScreenName('streams');
  const { key } = useLocalSearchParams<{ key?: string }>();
  const route = handed<StreamsRoute>(key);
  useEffect(() => {
    if (!route) goBack();
  }, [route]);
  if (!route) return <View style={{ flex: 1 }} />;
  return <StreamsScreen key={route.videoId} route={route} />;
}
