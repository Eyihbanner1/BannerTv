import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useSyncExternalStore } from 'react';
import { Rail } from '../components/Rail';
import { platformBack } from '../platform/webos';
import { useBack } from '../navigation/use-back';
import { DetailsScreen } from '../screens/DetailsScreen';
import { DiagnosticsScreen } from '../screens/DiagnosticsScreen';
import { HomeScreen } from '../screens/home/HomeScreen';
import { LabScreen } from '../screens/LabScreen';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { back, currentSection, openSection, type Route, router } from './router';
import styles from './App.module.css';

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <HomeScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'details':
      return <DetailsScreen itemId={route.itemId} />;
    case 'diagnostics':
      return <DiagnosticsScreen />;
    case 'lab':
      return <LabScreen />;
    default:
      return <PlaceholderScreen section={route.name} />;
  }
}

/**
 * The shell: rail plus the top screen of the router stack. Back runs, in
 * order: an open overlay, the screen's own rule, then this one, which closes
 * the top screen, returns to Home, and finally leaves the app.
 */
export function App() {
  const { stack } = useSyncExternalStore(router.subscribe, router.get);
  const route = stack[stack.length - 1]!.route;
  const { ref, focusKey } = useFocusable<object, HTMLElement>({
    focusKey: 'content',
    saveLastFocusedChild: true,
  });

  useBack('router', () => {
    if (back()) return true;
    if (currentSection() !== 'home') {
      openSection('home');
      return true;
    }
    platformBack();
    return true;
  });

  return (
    <div className={styles.app}>
      <Rail />
      <FocusContext.Provider value={focusKey}>
        <main ref={ref} className={styles.content}>
          <Screen key={`${stack.length}-${route.name}`} route={route} />
        </main>
      </FocusContext.Provider>
    </div>
  );
}
