/**
 * Test double for the `@deepseek-ai/dsh-client-ui-primitives` platform seed.
 *
 * The published 0.1.5 package is the shell's browser bundle: its
 * `lib/index.js` value-imports runtime dependencies it does not declare
 * (shiki, katex, anser, …) plus `.module.css` files, none of which resolve
 * from a plugin's own store. In the browser that never matters — the
 * specifier is answered by the shell's frozen module table, so the client
 * bundle keeps it external. Under vitest the SDK is inlined, so the
 * specifier is aliased to this file (see `vitest.config.ts`), which provides
 * just the surface this plugin imports (the four panel action icons).
 */
import { createElement } from 'react'

/** One icon stand-in: any rendered `<svg>` satisfies the panel's icon usage. */
function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return createElement('svg', { 'data-stub-icon': name, width: size, height: size })
}

export function IconCloseOutline16({ size }: { size?: number }) {
  return Icon({ name: 'close', size })
}

export function IconCopyOutline16({ size }: { size?: number }) {
  return Icon({ name: 'copy', size })
}

export function IconRefreshOutline16({ size }: { size?: number }) {
  return Icon({ name: 'refresh', size })
}

export function IconStopFill16({ size }: { size?: number }) {
  return Icon({ name: 'stop', size })
}