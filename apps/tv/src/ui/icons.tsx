import { Icon as PhoneIcon, type IconName as PhoneIconName } from '@phone/ui/icons';
import Svg, { Path } from 'react-native-svg';
import { color } from './theme';

/** Glyphs only the TV draws, on the same 24-unit grid as the phone's. */
const TV_PATHS = {
  more: 'M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4m12 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4m-6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  discover:
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m2.19 12.19L6 18l3.81-8.19L18 6z m-2.19-3.29a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2',
} as const;

export type IconName = PhoneIconName | keyof typeof TV_PATHS;

export function Icon({
  name,
  size,
  tint = color.text,
}: {
  name: IconName;
  size: number;
  tint?: string;
}) {
  if (name in TV_PATHS) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
        <Path d={TV_PATHS[name as keyof typeof TV_PATHS]} fill={tint} />
      </Svg>
    );
  }
  return <PhoneIcon name={name as PhoneIconName} size={size} color={tint} />;
}
