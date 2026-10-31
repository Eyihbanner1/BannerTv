import { defineConfig } from 'vitest/config';

// Unit tests cover the phone's pure modules; anything that imports react-native is checked by
// the web e2e journeys and on the phone instead.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
