import { isKidsProfile } from '@tv/data/profiles';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useScreenName } from '../nav/use-screen';
import { AddonsScreen } from '../screens/AddonsScreen';

export default function Route() {
  useScreenName('addons');
  const { add } = useLocalSearchParams<{ add?: string }>();
  // Addons are shared by every profile, so they are for the grown-ups, as on the TV.
  if (isKidsProfile()) return <Redirect href="/" />;
  return <AddonsScreen startAdding={add === '1'} />;
}
