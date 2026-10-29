import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Sports times are shown in the TV's own zone: tests read them as a UK TV, clock change included.
    env: { TZ: 'Europe/London' },
  },
});
