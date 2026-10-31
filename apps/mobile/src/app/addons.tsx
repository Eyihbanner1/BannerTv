import { useLocalSearchParams } from 'expo-router';
import { useScreenName } from '../nav/use-screen';
import { AddonsScreen } from '../screens/AddonsScreen';

export default function Route() {
  useScreenName('addons');
  const { add } = useLocalSearchParams<{ add?: string }>();
  return <AddonsScreen startAdding={add === '1'} />;
}
