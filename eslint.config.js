import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/node_modules/**',
      '**/test-results/**',
      '**/playwright-report/**',
      'brand/**',
      // Built by the demo addon's media script: HLS segments end in .ts.
      'services/demo/public/**',
      'services/demo/.work/**',
      // Kotlin, and its Gradle build folder holds a copy of the web build.
      'apps/androidtv/**',
      // The phone app's generated native projects and Expo's own folders.
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
      'apps/mobile/.expo/**',
      'apps/mobile/expo-env.d.ts',
      // The native TV app's generated Android project and Expo's own folders.
      'apps/tv/android/**',
      'apps/tv/.expo/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['apps/webos/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest']],
    languageOptions: { globals: globals.browser },
  },
  {
    // The phone app and the native TV app: React Native, where fetch, timers and console are the
    // only browser-like globals.
    files: ['apps/mobile/src/**/*.{ts,tsx}', 'apps/tv/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest']],
  },
  {
    // The core and protocol packages run anywhere: no DOM, no browser globals, no React.
    files: ['packages/core/**/*.ts', 'packages/protocol/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'localStorage'],
      'no-restricted-imports': ['error', { patterns: ['react', 'react-*', '@noriginmedia/*'] }],
    },
  },
  {
    files: [
      'tools/**/*.mjs',
      'services/*/scripts/**/*.mjs',
      'apps/webos/build/**',
      'apps/webos/e2e/**',
      '**/*.config.{js,ts}',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // Metro, Babel and their plugins load CommonJS.
    files: ['apps/mobile/*.config.js', 'apps/mobile/build/**/*.js', 'apps/tv/*.config.js'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
