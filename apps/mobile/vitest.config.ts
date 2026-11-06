import { defineConfig } from 'vitest/config';

// Unit tests cover the phone's pure modules; anything that imports react-native is checked by
// the web e2e journeys and on the phone instead. tsconfig's paths let them use the TV's pure
// helpers through @tv/*, as the app does.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
