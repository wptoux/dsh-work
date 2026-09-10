/**
 * Test double for the `@deepseek-ai/dsh-client-ui-primitives` platform seed.
 *
 * The published package is the shell's browser bundle: its `lib/index.js`
 * value-imports runtime dependencies it does not declare (shiki, katex,
 * micromark, mdast, clsx, anser) plus `.module.css` files, none of which
 * resolve from a plugin's own store. In the browser that never matters — the
 * specifier is answered by the shell's frozen module table, so the client
 * bundle keeps it external. Under vitest the SDK is inlined, so the specifier
 * is aliased to this file (see `vitest.config.ts`), which provides just the
 * surface the plugin imports.
 */
import { createElement } from 'react'

/** Stand-in for the DeepSeek whale logo: any rendered `<svg>` satisfies the trigger. */
export function FishLogo({ size }: { size?: number }) {
  return createElement('svg', { 'data-stub-fish-logo': '', width: size, height: size })
}
