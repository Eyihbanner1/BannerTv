import { isKidsProfile } from '@tv/data/profiles';
import { Redirect } from 'expo-router';
import { useScreenName } from '../nav/use-screen';
import { ProfilesScreen } from '../screens/profiles/ProfilesScreen';

export default function Route() {
  useScreenName('manage-profiles');
  // Profiles are the grown-ups' to change, as on the TV, however the screen was reached.
  if (isKidsProfile()) return <Redirect href="/" />;
  return <ProfilesScreen />;
}
