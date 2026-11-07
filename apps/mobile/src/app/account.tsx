import { MAIN_PROFILE_ID } from '@bannertv/core';
import { activeProfileId } from '@tv/data/profiles';
import { syncOn } from '@tv/data/sync-clock';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useScreenName } from '../nav/use-screen';
import { AccountScreen } from '../screens/AccountScreen';

export default function Route() {
  useScreenName('account');
  const { join } = useLocalSearchParams<{ join?: string }>();
  // Only Main sees the account (ADR 0006 decision 12), however the screen was reached.
  if (activeProfileId.get() !== MAIN_PROFILE_ID) return <Redirect href="/" />;
  return <AccountScreen startOnJoin={join === '1' && !syncOn()} />;
}
