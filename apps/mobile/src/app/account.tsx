import { useLocalSearchParams } from 'expo-router';
import { syncOn } from '@tv/data/sync-clock';
import { useScreenName } from '../nav/use-screen';
import { AccountScreen } from '../screens/AccountScreen';

export default function Route() {
  useScreenName('account');
  const { join } = useLocalSearchParams<{ join?: string }>();
  return <AccountScreen startOnJoin={join === '1' && !syncOn()} />;
}
