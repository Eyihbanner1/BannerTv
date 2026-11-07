import { isKidsProfile } from '@tv/data/profiles';
import { androidHelperState } from '@tv/platform/android';
import { Redirect } from 'expo-router';
import { useScreenName } from '../nav/use-screen';
import { StreamHelperScreen } from '../screens/StreamHelperScreen';

export default function Route() {
  useScreenName('stream-helper');
  // For the grown-ups, as on the TV, and only where the build has the helper (not on the web).
  if (isKidsProfile() || androidHelperState() === null) return <Redirect href="/" />;
  return <StreamHelperScreen />;
}
