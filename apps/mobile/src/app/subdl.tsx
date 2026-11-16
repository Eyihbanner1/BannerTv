import { isKidsProfile } from '@tv/data/profiles';
import { Redirect } from 'expo-router';
import { useScreenName } from '../nav/use-screen';
import { SubdlScreen } from '../screens/SubdlScreen';

export default function Route() {
  useScreenName('subdl');
  // For the grown-ups, as on the TV: a kids profile never asks SubDL.
  if (isKidsProfile()) return <Redirect href="/" />;
  return <SubdlScreen />;
}
