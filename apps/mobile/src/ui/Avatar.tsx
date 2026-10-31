import type { Profile } from '@bannertv/core';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text } from 'react-native';
import { PROFILE_ART, type } from './theme';

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
      style={[styles.circle, { width: size, height: size, borderRadius: size / 4 }]}
    >
      <Text style={[styles.letter, { fontSize: size * 0.45, lineHeight: size * 0.55 }]}>
        {profile.name.slice(0, 1).toUpperCase()}
      </Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  letter: { ...type.display, color: '#0B0815' },
});
