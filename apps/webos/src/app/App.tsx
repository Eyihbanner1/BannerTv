import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { memo, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Rail } from '../components/Rail';
import { activeProfileId, profileSwitcher } from '../data/profiles';
import { welcomed } from '../data/welcome';
import { platformBack } from '../platform/webos';
import { useBack } from '../navigation/use-back';
import { AddonsScreen } from '../screens/addons/AddonsScreen';
import { DetailsScreen } from '../screens/details/DetailsScreen';
import { DiagnosticsScreen } from '../screens/DiagnosticsScreen';
import { DiscoverScreen } from '../screens/discover/DiscoverScreen';
import { HomeScreen } from '../screens/home/HomeScreen';
import { LabScreen } from '../screens/LabScreen';
import { LibraryScreen } from '../screens/library/LibraryScreen';
import { PlayerScreen } from '../screens/player/PlayerScreen';
import { ProfileEditScreen } from '../screens/profiles/ProfileEditScreen';
import { ProfilePicker } from '../screens/profiles/ProfilePicker';
import { ProfilesScreen } from '../screens/profiles/ProfilesScreen';
import { SearchScreen } from '../screens/search/SearchScreen';
import { HomeRowsScreen } from '../screens/settings/HomeRowsScreen';
import { StreamHelperScreen } from '../screens/settings/StreamHelperScreen';
import { TraktScreen } from '../screens/settings/TraktScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { EventScreen } from '../screens/sports/EventScreen';
import { SportsScreen } from '../screens/sports/SportsScreen';
import { StreamsScreen } from '../screens/streams/StreamsScreen';
import { WelcomeScreen } from '../screens/welcome/WelcomeScreen';
import { back, currentSection, openSection, type Route, router } from './router';
import { createScreenSlot, ScreenSlotContext } from './screen-slot';
import styles from './App.module.css';

const SETTLING_CLASS = 'screen-settling';
/** Global, so screens can pause their animations while hidden. */
const COVERED_CLASS = 'screen-covered';

/** Whether focus is anywhere but in `screen` or on the rail (the page's only nav). */
function focusLeftBehind(screen: HTMLElement): boolean {
  const focused = document.activeElement;
  return !screen.contains(focused) && !focused?.closest('nav');
}

// A route object lives as long as its stack entry, so its identity names one visit.
const routeIds = new WeakMap<Route, number>();
let nextRouteId = 0;
function routeId(route: Route): number {
  let id = routeIds.get(route);
  if (id === undefined) {
    id = nextRouteId++;
    routeIds.set(route, id);
  }
  return id;
}

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
    case 'sports':
      return <SportsScreen />;
    case 'event':
      return <EventScreen event={route.event} />;
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
    case 'profiles':
      return <ProfilesScreen />;
    case 'profile-edit':
      return <ProfileEditScreen id={route.id} />;
    case 'home-rows':
      return <HomeRowsScreen />;
    case 'trakt':
      return <TraktScreen />;
    case 'stream-helper':
      return <StreamHelperScreen />;
    case 'player':
      // A new episode is a new player, so its session and subtitles start afresh.
      return <PlayerScreen key={route.videoId} {...route} />;
    case 'library':
      return <LibraryScreen />;
  }
}

interface ScreenSlotProps {
  route: Route;
  focusKey: string;
  /** False while another screen sits on top of this one. */
  active: boolean;
  /** Pushed on top of another screen, rather than a section root. */
  pushed: boolean;
  /** Over the rail too, as the player is. */
  fullScreen?: boolean;
}

/**
 * One mounted screen. A section root stays mounted, hidden and out of spatial
 * navigation, while screens opened from it sit on top, so Back shows it again
 * as it was instead of building it again: on a TV that rebuild was most of
 * the time Back took.
 */
const ScreenSlot = memo(function ScreenSlot({
  route,
  focusKey,
  active,
  pushed,
  fullScreen,
}: ScreenSlotProps) {
  const [slot] = useState(() => createScreenSlot(active));
  const { ref } = useFocusable<object, HTMLDivElement>({
    focusKey,
    focusable: active,
    saveLastFocusedChild: true,
  });
  // The screen element never changes, so showing or hiding it does not re-render it.
  const screen = useMemo(() => <Screen route={route} />, [route]);

  // A passive effect, so a screen being uncovered places focus after the one
  // on top has unmounted and given its focus up.
  useEffect(() => slot.set(active), [slot, active]);

  // A screen that just opened appears already in place: its rows jump to the
  // remembered tile instead of sliding there. One that is uncovered already is.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.classList.add(SETTLING_CLASS);
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => element.classList.remove(SETTLING_CLASS));
    });
    return () => {
      cancelAnimationFrame(frame);
      element.classList.remove(SETTLING_CLASS);
    };
  }, [ref]);

  // A pushed screen that places no focus of its own yet (it is still loading)
  // takes it here, so the remote cannot move around the hidden screen below.
  // This frame no longer pulls back focus the viewer moved to the rail before
  // it came, which a busy TV can draw after the press.
  useEffect(() => {
    if (!pushed) return;
    const frame = requestAnimationFrame(() => {
      const element = ref.current;
      if (element && focusLeftBehind(element)) void setFocus(focusKey);
    });
    return () => cancelAnimationFrame(frame);
  }, [pushed, focusKey, ref]);

  return (
    <ScreenSlotContext.Provider value={slot}>
      <FocusContext.Provider value={focusKey}>
        <div
          ref={ref}
          className={[styles.slot, fullScreen ? styles.fullScreen : '', active ? '' : COVERED_CLASS]
            .filter(Boolean)
            .join(' ')}
        >
          {screen}
        </div>
      </FocusContext.Provider>
    </ScreenSlotContext.Provider>
  );
});

/**
 * The shell: rail plus the screens of the router stack, the section root and
 * the top one. Back runs, in order: an open overlay, the screen's own rule,
 * then this one, which closes the top screen, returns to Home, and finally
 * leaves the app.
 */
export function App() {
  const { stack } = useSyncExternalStore(router.subscribe, router.get);
  const welcomeDone = useSyncExternalStore(welcomed.subscribe, welcomed.get);
  const profileId = useSyncExternalStore(activeProfileId.subscribe, activeProfileId.get);
  const switching = useSyncExternalStore(profileSwitcher.subscribe, profileSwitcher.get);
  // Screens wait for the welcome, then for someone to say who is watching:
  // until then nobody's history or list can be read.
  const ready = welcomeDone && profileId !== null;
  const root = stack[0]!.route;
  const top = stack[stack.length - 1]!.route;
  const rootKey = `screen-${routeId(root)}`;
  const topKey = `screen-${routeId(top)}`;
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

  // The player takes the whole screen; the rail would only be in the way.
  const fullScreen = top.name === 'player';
  return (
    <div className={styles.app}>
      {!fullScreen && <Rail />}
      <FocusContext.Provider value={focusKey}>
        <main ref={ref} className={styles.content}>
          {/* On first run the screens wait, so they cannot take focus from the welcome. */}
          {ready && (
            <ScreenSlot
              key={rootKey}
              route={root}
              focusKey={rootKey}
              active={top === root}
              pushed={false}
            />
          )}
          {ready && top !== root && (
            <ScreenSlot
              key={topKey}
              route={top}
              focusKey={topKey}
              active
              pushed
              fullScreen={fullScreen}
            />
          )}
        </main>
      </FocusContext.Provider>
      {!welcomeDone && <WelcomeScreen />}
      {welcomeDone && profileId === null && <ProfilePicker mode="launch" />}
      {ready && switching && <ProfilePicker mode="switch" />}
    </div>
  );
}
