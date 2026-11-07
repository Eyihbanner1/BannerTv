import { useProfileKey, useScreenName } from '../../nav/use-screen';
import { LibraryScreen } from '../../screens/LibraryScreen';

export default function Route() {
  useScreenName('library');
  const profileKey = useProfileKey();
  return <LibraryScreen key={profileKey} />;
}
