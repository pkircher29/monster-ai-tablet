import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/vendor/**',
      '**/*.tsbuildinfo',
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['scripts/windows/**/*.mjs'],
    languageOptions: {
      globals: {
        Atomics: 'readonly',
        console: 'readonly',
        process: 'readonly',
        SharedArrayBuffer: 'readonly',
        URL: 'readonly',
      },
    },
  },
);
