import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useLayoutEffect, useSyncExternalStore } from 'react';
import { Rail } from '../components/Rail';
import { welcomed } from '../data/welcome';
import { platformBack } from '../platform/webos';
import { useBack } from '../navigation/use-back';
import { AddonsScreen } from '../screens/addons/AddonsScreen';
import { DetailsScreen } from '../screens/details/DetailsScreen';
import { DiagnosticsScreen } from '../screens/DiagnosticsScreen';
import { DiscoverScreen } from '../screens/discover/DiscoverScreen';
import { HomeScreen } from '../screens/home/HomeScreen';
import { LabScreen } from '../screens/LabScreen';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { PlayerScreen } from '../screens/player/PlayerScreen';
import { SearchScreen } from '../screens/search/SearchScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { StreamsScreen } from '../screens/streams/StreamsScreen';
import { WelcomeScreen } from '../screens/welcome/WelcomeScreen';
import { back, currentSection, openSection, type Route, router } from './router';
import styles from './App.module.css';

const SETTLING_CLASS = 'screen-settling';

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <HomeScreen />;
    case 'search':
      return <SearchScreen />;
    case 'discover':
      return <DiscoverScreen />;
    case 'catalog':
      return <DiscoverScreen preset={route} />;
    case 'addons':
      return <AddonsScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'details':
      return <DetailsScreen type={route.type} id={route.id} preview={route.preview} />;
    case 'diagnostics':
      return <DiagnosticsScreen />;
    case 'lab':
      return <LabScreen />;
    case 'streams':
      return <StreamsScreen {...route} />;
    case 'player':
      // A new episode is a new player, so its session and subtitles start afresh.
      return <PlayerScreen key={route.videoId} {...route} />;
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
  const welcomeDone = useSyncExternalStore(welcomed.subscribe, welcomed.get);
  const route = stack[stack.length - 1]!.route;
  const screenKey = `${stack.length}-${route.name}`;
  const { ref, focusKey } = useFocusable<object, HTMLElement>({
    focusKey: 'content',
    saveLastFocusedChild: true,
  });

  // Focus is restored after the screen mounts, which moves its rows. Hold
  // transitions off until that has painted, so nothing slides into place.
  useLayoutEffect(() => {
    const main = ref.current;
    if (!main) return;
    main.classList.add(SETTLING_CLASS);
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => main.classList.remove(SETTLING_CLASS));
    });
    return () => {
      cancelAnimationFrame(frame);
      main.classList.remove(SETTLING_CLASS);
    };
  }, [ref, screenKey]);

  useBack('router', () => {
    if (back()) return true;
    if (currentSection() !== 'home') {
      openSection('home');
      return true;
    }
    platformBack();
    return true;
  });

  // The player takes the whole screen; the rail would only be in the way.
  const fullScreen = route.name === 'player';
  return (
    <div className={styles.app}>
      {!fullScreen && <Rail />}
      <FocusContext.Provider value={focusKey}>
        <main ref={ref} className={fullScreen ? styles.fullScreen : styles.content}>
          {/* On first run the screen waits, so it cannot take focus from the welcome. */}
          {welcomeDone && <Screen key={screenKey} route={route} />}
        </main>
      </FocusContext.Provider>
      {!welcomeDone && <WelcomeScreen />}
    </div>
  );
}
