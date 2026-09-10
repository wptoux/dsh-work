/**
 * Shared browser platform modules. Seeding, bundling externals, and Vite
 * aliases consume this list so their module identities cannot drift.
 * Mirrors the shell's frozen module table (dsh-web-frontend staticModules,
 * verified against the 0.1.5-rc.1 dist: react, react/jsx-runtime, react-dom,
 * react-dom/client, cordis, dsh-client-ui-slots, dsh-client-ui-primitives,
 * dsh-client-store, dsh-client-ui-dockkit; dsh-client-runtime was re-homed
 * into the dsh-client-store seed in 0.1.2-alpha).
 * @module dsh-web-ui/shared/web-platform
 */

/** The module specifiers the shell shares into the frozen module table. */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-store',
] as const
