// ESLint flat configuration (ESLint 9+).
//
// One config for the whole monorepo, so `npm run lint` from the root lints
// every workspace with identical rules. That matters: it means a rule cannot be
// satisfied in one app and ignored in another.
//
// Lint and TypeScript deliberately overlap on purpose. ESLint catches code
// smells; `tsc` proves types. Neither replaces the other, and `npm run verify`
// runs both.

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    // Never lint build output, dependencies, or generated files.
    //
    // `eslint.config.js` is excluded because the type-aware rules below need a
    // TypeScript project, and this file is plain JavaScript that configures the
    // workspace rather than belonging to it. The `js.configs.recommended` block
    // cannot be applied to it either, so it is simply out of scope.
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      'eslint.config.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  // Turn off rules that require type information where we do not have it.
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Browser code: apps/web and the React tests.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },

  // Server code: apps/api, and Node-based tooling/tests.
  {
    files: ['apps/api/**/*.ts', 'packages/*/src/**/*.ts', '*.js', '*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },

  {
    rules: {
      // Unused code is a defect, not a style choice. TypeScript's
      // noUnusedLocals/noUnusedParameters already catch most of this; ESLint
      // catches the rest (unused function arguments in overrides, etc.).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // `any` is banned outright. Phase 0 recorded this as NFR-M-011: types are
      // an aid, never an escape hatch. If a type error appears, the fix is to
      // correct the design, not to widen the type.
      '@typescript-eslint/no-explicit-any': 'error',

      // Floating promises are a real bug class: an un-awaited `save()` can
      // reject with nobody listening. This rule needs type information, which
      // is why the type-checked config above is used.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // Prefer `??` over `||` when the left side may legitimately be 0 or '',
      // which the nullish coalescing operator preserves and `||` discards.
      '@typescript-eslint/prefer-nullish-coalescing': 'error',

      // Consistent, explicit equality.
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // Consistent, explicit equality.
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // Console output is allowed. Phase 1 logs deliberate startup and shutdown
      // messages, and the prompt asks for visible diagnostics. A structured
      // logger is a later-phase concern, not something to add speculatively.
      'no-console': 'off',
    },
  },

  // Tests may assert on loosely typed fixtures and use non-null assertions.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },

  // Must be last: it disables formatting rules that would fight Prettier.
  prettierConfig,
);
