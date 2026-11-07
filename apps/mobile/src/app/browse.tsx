import { useScreenName } from '../nav/use-screen';
import { CatalogScreen } from '../screens/CatalogScreen';

export default function Route() {
  useScreenName('browse');
  return <CatalogScreen />;
}
