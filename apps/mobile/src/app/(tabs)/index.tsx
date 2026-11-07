import { useProfileKey, useScreenName } from '../../nav/use-screen';
import { HomeScreen } from '../../screens/HomeScreen';

export default function Route() {
  useScreenName('home');
  const profileKey = useProfileKey();
  return <HomeScreen key={profileKey} />;
}
