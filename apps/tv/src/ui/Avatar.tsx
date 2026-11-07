import type { Profile } from '@bannertv/core';
import { PROFILE_ART } from '@phone/ui/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text } from 'react-native';
import { color, type } from './theme';

/** A profile's round avatar, in the same colours as on the phone and the LG. */
export function Avatar({
  profile,
  size,
}: {
  profile: Pick<Profile, 'name' | 'colour'>;
  size: number;
}) {
  const [from, to] = PROFILE_ART[profile.colour % PROFILE_ART.length]!;
  return (
    <LinearGradient
      colors={[from, to]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Text style={[styles.letter, { fontSize: size * 0.42, lineHeight: size * 0.52 }]}>
        {profile.name.slice(0, 1).toUpperCase()}
      </Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  letter: { ...type.heading, color: color.onFocus },
});
