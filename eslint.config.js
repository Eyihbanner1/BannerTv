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
    // The core runs anywhere: no DOM, no browser globals, no React.
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'localStorage'],
      'no-restricted-imports': ['error', { patterns: ['react', 'react-*', '@noriginmedia/*'] }],
    },
  },
  {
    files: ['tools/**/*.mjs', 'apps/webos/build/**', 'apps/webos/e2e/**', '**/*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
);
