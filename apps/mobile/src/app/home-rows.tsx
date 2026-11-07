import { isKidsProfile } from '@tv/data/profiles';
import { Redirect } from 'expo-router';
import { useScreenName } from '../nav/use-screen';
import { HomeRowsScreen } from '../screens/HomeRowsScreen';

export default function Route() {
  useScreenName('home-rows');
  // A kids profile's Home is its Family rows, as on the TV, with no Home rows of its own.
  if (isKidsProfile()) return <Redirect href="/" />;
  return <HomeRowsScreen />;
}
