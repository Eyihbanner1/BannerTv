import { useScreenName } from '../../nav/use-screen';
import { SearchScreen } from '../../screens/SearchScreen';

export default function Route() {
  useScreenName('search');
  return <SearchScreen />;
}
