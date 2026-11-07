import { traktAvailable } from '@tv/data/trakt';
import { Redirect } from 'expo-router';
import { useScreenName } from '../nav/use-screen';
import { TraktScreen } from '../screens/TraktScreen';

export default function Route() {
  useScreenName('trakt');
  // Never for a kids profile, and only while BannerTV's service has Trakt's keys, as on the TV.
  if (!traktAvailable()) return <Redirect href="/" />;
  return <TraktScreen />;
}
