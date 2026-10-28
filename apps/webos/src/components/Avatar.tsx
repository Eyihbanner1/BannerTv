import { type Profile, PROFILE_COLOURS } from '@bannertv/core';
import styles from './Avatar.module.css';

// Six hues far enough apart to tell people apart at a glance, each dark
// enough at one end for the white letter. Main starts on the brand violet.
const COLOURS: ReadonlyArray<readonly [string, string]> = [
  ['#4B23C8', '#9C7BFF'],
  ['#0B6E6D', '#3CC4B8'],
  ['#B23A0A', '#F98A3C'],
  ['#8A4B05', '#E0A21A'],
  ['#1C47C9', '#5B9DF5'],
  ['#A3154F', '#EE6AA7'],
];

/** A profile colour as a background, for avatars and the colour choice. */
export function avatarArt(colour: number): string {
  const [from, to] = COLOURS[colour % PROFILE_COLOURS]!;
  return `linear-gradient(135deg, ${from}, ${to})`;
}

interface AvatarProps {
  profile: Pick<Profile, 'name' | 'colour'>;
  size: 'small' | 'large';
}

/** A profile's picture: its first letter on its colour. */
export function Avatar({ profile, size }: AvatarProps) {
  const initial = Array.from(profile.name)[0]?.toUpperCase() ?? '?';
  return (
    <span
      className={`${styles.avatar} ${styles[size]}`}
      style={{ backgroundImage: avatarArt(profile.colour) }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
