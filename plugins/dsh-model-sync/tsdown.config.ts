import type { UserConfig } from 'tsdown'

export default {
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  // build script removes lib/ before tsc; tsdown clean would wipe the
  // lib/types declarations tsc just emitted.
  clean: false,
} satisfies UserConfig