import { useProfileKey, useScreenName } from '../../nav/use-screen';
import { SettingsScreen } from '../../screens/SettingsScreen';

export default function Route() {
  useScreenName('settings');
  const profileKey = useProfileKey();
  return <SettingsScreen key={profileKey} />;
}
