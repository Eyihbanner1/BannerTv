import { useProfileKey, useScreenName } from '../../nav/use-screen';
import { SearchScreen } from '../../screens/SearchScreen';

export default function Route() {
  useScreenName('search');
  const profileKey = useProfileKey();
  return <SearchScreen key={profileKey} />;
}
