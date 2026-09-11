import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tsconfigPaths({
    projects: [
      './tsconfig.vitest.json',
    ],
  })],
  resolve: {
    alias: {
      // The 0.1.5 primitives package is the shell's own browser bundle: its
      // lib/index.js value-imports undeclared runtime deps (shiki, anser, …)
      // plus .module.css files. In the browser the specifier is answered by
      // the frozen module table (the client bundle keeps it external), so
      // tests substitute the same surface with a small double instead of
      // installing the shell's dependency tree here.
      '@deepseek-ai/dsh-client-ui-primitives':
        new URL('./tests/stubs/primitives.tsx', import.meta.url).pathname,
    },
  },
  // npm SDK packages reference sourcemaps that are not published (files
  // exclude *.map); do not attempt to load them during transform.
  server: {
    sourcemapIgnoreList: () => true,
  },
  test: {
    include: [
      'tests/**/*.spec.ts', 'tests/**/*.spec.tsx',
      'src/**/*.spec.ts', 'src/**/*.spec.tsx',
      'src/**/*.test.ts', 'src/**/*.test.tsx',
    ],
    pool: 'forks',
    setupFiles: ['./vitest.setup.ts'],
    // @deepseek-ai SDK packages ship browser bundles (CSS imports included);
    // keep them vite-transformed instead of node-externalized.
    server: {
      deps: {
        inline: [/@deepseek-ai\//],
      },
    },
  },
})
