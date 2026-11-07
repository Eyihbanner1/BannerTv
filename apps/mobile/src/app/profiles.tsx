import { useScreenName } from '../nav/use-screen';
import { ProfilePicker } from '../screens/ProfilePicker';

export default function Route() {
  useScreenName('profiles');
  return <ProfilePicker mode="switch" />;
}
