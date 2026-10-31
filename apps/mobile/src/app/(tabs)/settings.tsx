import { useScreenName } from '../../nav/use-screen';
import { SettingsScreen } from '../../screens/SettingsScreen';

export default function Route() {
  useScreenName('settings');
  return <SettingsScreen />;
}
