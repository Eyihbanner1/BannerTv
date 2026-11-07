import type { MetaPreview } from '@bannertv/protocol';
import { useLocalSearchParams } from 'expo-router';
import { handed } from '../nav/routes';
import { useScreenName } from '../nav/use-screen';
import { TitleScreen } from '../screens/TitleScreen';

export default function Route() {
  useScreenName('details');
  const { type, id, key } = useLocalSearchParams<{ type: string; id: string; key?: string }>();
  const preview = handed<MetaPreview>(key);
  return (
    <TitleScreen key={`${type}:${id}`} type={type} id={id} {...(preview ? { preview } : {})} />
  );
}
