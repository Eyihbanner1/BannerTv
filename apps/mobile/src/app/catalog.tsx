import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { goBack, handed, type CatalogRoute } from '../nav/routes';
import { useScreenName } from '../nav/use-screen';
import { CatalogScreen } from '../screens/CatalogScreen';

export default function Route() {
  useScreenName('catalog');
  const { key } = useLocalSearchParams<{ key?: string }>();
  const route = handed<CatalogRoute>(key);
  useEffect(() => {
    if (!route) goBack();
  }, [route]);
  if (!route) return <View style={{ flex: 1 }} />;
  return <CatalogScreen route={route} />;
}
