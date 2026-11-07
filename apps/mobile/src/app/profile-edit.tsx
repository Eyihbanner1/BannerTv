import { activeProfileId, isKidsProfile, profiles } from '@tv/data/profiles';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useScreenName } from '../nav/use-screen';
import { ProfileEditScreen } from '../screens/profiles/ProfileEditScreen';
import { unlockedForEdit } from '../screens/profiles/unlocked';

export default function Route() {
  useScreenName('profile-edit');
  const { id } = useLocalSearchParams<{ id?: string }>();
  // Decided once, as it opens: a PIN set on the page afterwards does not shut it.
  const [allowed] = useState(() => {
    if (isKidsProfile()) return false;
    const profile = profiles.get().profiles.find((p) => p.id === id);
    // A locked profile other than your own opens only once its PIN was entered on Profiles.
    return !profile?.pin || profile.id === activeProfileId.get() || unlockedForEdit(profile.id);
  });
  if (!allowed) return <Redirect href={isKidsProfile() ? '/' : '/manage-profiles'} />;
  return <ProfileEditScreen {...(typeof id === 'string' && id ? { id } : {})} />;
}
