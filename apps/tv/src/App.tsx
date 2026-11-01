import { activeProfileId } from '@tv/data/profiles';
import { welcomed } from '@tv/data/welcome';
import { noteInput } from '@tv/navigation/activity';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useSyncExternalStore } from 'react';
import { BackHandler, StyleSheet, useTVEventHandler, View } from 'react-native';
import { goBack, type Route, screens } from './nav/routes';
import { top } from './nav/stack';
import { DetailsScreen } from './screens/details/DetailsScreen';
import { StreamsScreen } from './screens/details/StreamsScreen';
import { HomeScreen } from './screens/home/HomeScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { PlayerScreen } from './player/PlayerScreen';
import { SettingsScreen } from './screens/settings/SettingsScreen';
import { SoonScreen } from './screens/SoonScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { WhoIsWatching } from './screens/WhoIsWatching';
import { color } from './ui/theme';

function Screen({ route, active }: { route: Route; active: boolean }) {
  switch (route.name) {
    case 'section':
      if (route.section === 'home') return <HomeScreen />;
      if (route.section === 'library') return <LibraryScreen />;
      return <SoonScreen section={route.section} />;
    case 'details':
      return <DetailsScreen item={route.item} active={active} />;
    case 'streams':
      return <StreamsScreen route={route.streams} />;
    case 'player':
      return <PlayerScreen route={route.player} active={active} />;
    case 'settings':
      return <SettingsScreen active={active} />;
    case 'profiles':
      return <WhoIsWatching mode="switch" active={active} />;
  }
}

/**
 * The app's frame: a stack of screens the remote's Back walks down. Screens under the top one
 * stay mounted but hidden, so Home keeps its rows, pictures and place while a title is open.
 * Until the welcome is done and someone is chosen, the welcome or "Who's watching?" covers them.
 */
export function App() {
  const stack = useSyncExternalStore(screens.subscribe, screens.get);
  const welcomeDone = useSyncExternalStore(welcomed.subscribe, welcomed.get);
  const profileId = useSyncExternalStore(activeProfileId.subscribe, activeProfileId.get);
  const current = top(stack);

  // Added first, so it runs last: screens add their own Back while they are on top.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      noteInput();
      // On the first screen Back is not handled here, so Android leaves the app.
      return goBack();
    });
    return () => subscription.remove();
  }, []);
  // Any key counts as the viewer being there, for "Still watching?".
  useTVEventHandler(() => noteInput());

  const cover = !welcomeDone ? (
    <WelcomeScreen />
  ) : profileId === null ? (
    <WhoIsWatching mode="launch" active />
  ) : null;

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      {stack.screens.map((entry) => {
        const active = entry === current && cover === null;
        return (
          <View key={entry.key} style={[styles.screen, entry !== current && styles.hidden]}>
            <Screen route={entry.route} active={active} />
          </View>
        );
      })}
      {cover ? <View style={styles.cover}>{cover}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  screen: { ...StyleSheet.absoluteFill, backgroundColor: color.bg },
  hidden: { display: 'none' },
  cover: { ...StyleSheet.absoluteFill, backgroundColor: color.bg },
});
