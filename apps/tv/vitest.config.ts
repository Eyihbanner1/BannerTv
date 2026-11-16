import { defineConfig } from 'vitest/config';

const at = (path: string) => new URL(path, import.meta.url).pathname;

// The LG app's data layer and the shared packages, as tsconfig.json names them, with React and
// i18next from this app's own node_modules, as Metro takes them.
export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-i18next', 'i18next'],
    alias: {
      '@tv': at('../webos/src'),
      '@bannertv/core': at('../../packages/core/src/index.ts'),
      '@bannertv/protocol': at('../../packages/protocol/src/index.ts'),
    },
  },
});
