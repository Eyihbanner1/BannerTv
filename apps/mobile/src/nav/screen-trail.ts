import { usePathname } from 'expo-router';
import { useEffect } from 'react';
import { screenDrawing, screenShown } from '../runtime/crash-catcher';

/**
 * Tells the crash catcher which screen is being drawn and which has shown, for the report's
 * screens (runtime/crash-catcher.ts). Its own small part of the root layout, so only it draws
 * again as the route changes. The first time it shows is the app's first screen.
 */
export function ScreenTrail(): null {
  const path = usePathname();
  // Before the screen shows: a screen that fails to draw is still the one the problem was on.
  screenDrawing(path);
  useEffect(() => screenShown(path), [path]);
  return null;
}
