import { useScreenName } from '../../nav/use-screen';
import { HomeScreen } from '../../screens/HomeScreen';

export default function Route() {
  useScreenName('home');
  return <HomeScreen />;
}
