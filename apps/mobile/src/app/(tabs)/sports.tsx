import { useProfileKey, useScreenName } from '../../nav/use-screen';
import { SportsScreen } from '../../screens/sports/SportsScreen';

export default function Route() {
  useScreenName('sports');
  const profileKey = useProfileKey();
  return <SportsScreen key={profileKey} />;
}
