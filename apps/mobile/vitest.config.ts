import { defineConfig } from 'vitest/config';

// Unit tests cover the phone's pure modules; anything that imports react-native is checked by
// the web e2e journeys and on the phone instead. The one exception is runtime/app-updates.ts,
// which the web build never runs: its test stands in for react-native and expo-updates. The
// build/ helpers app.config.ts reads are tested here too. tsconfig's paths let the tests use the
// TV's pure helpers through @tv/*, as the app does.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.test.ts', 'build/**/*.test.ts'],
    environment: 'node',
  },
});
