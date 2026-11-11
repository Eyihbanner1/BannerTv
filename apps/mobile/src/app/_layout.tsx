import { activeProfileId } from '@tv/data/profiles';
import { welcomed } from '@tv/data/welcome';
import { noteInput } from '@tv/navigation/activity';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ScreenTrail } from '../nav/screen-trail';
import { keepOrientation } from '../player/orientation';
import { ProfilePicker } from '../screens/ProfilePicker';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { colors } from '../ui/theme';

// A screen that fails to draw shows "Something went wrong" instead of a blank screen.
export { CrashScreen as ErrorBoundary } from '../screens/CrashScreen';

/**
 * The app's frame. The screens stay mounted underneath; until the welcome is done and someone
 * is chosen, the welcome or "Who's watching?" covers them, as on the TV.
 *
 * No GestureHandlerRootView: no screen uses a gesture-handler gesture (touches go through React
 * Native's own responders), and importing the library at launch also loads Reanimated and
 * Worklets, which start a second JavaScript runtime the app never uses.
 */
export default function RootLayout() {
  const welcomeDone = useSyncExternalStore(welcomed.subscribe, welcomed.get);
  const profileId = useSyncExternalStore(activeProfileId.subscribe, activeProfileId.get);
  // Upright unless the player is open, also after the app starts again with Android still
  // holding the last run's sideways lock, and on every return to the front.
  useEffect(() => keepOrientation(), []);
  const cover = !welcomeDone ? (
    <WelcomeScreen />
  ) : profileId === null ? (
    <ProfilePicker mode="launch" />
  ) : null;
  return (
    <SafeAreaProvider style={styles.root}>
      <StatusBar style="light" />
      <View
        style={styles.root}
        onStartShouldSetResponderCapture={() => {
          noteInput();
          return false;
        }}
      >
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="player" options={{ animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="profiles" options={{ animation: 'fade_from_bottom' }} />
        </Stack>
        <ScreenTrail />
        {cover ? <View style={styles.cover}>{cover}</View> : null}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  cover: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.bg,
  },
});
