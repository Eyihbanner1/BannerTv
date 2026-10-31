import { useScreenName } from '../../nav/use-screen';
import { LibraryScreen } from '../../screens/LibraryScreen';

export default function Route() {
  useScreenName('library');
  return <LibraryScreen />;
}
