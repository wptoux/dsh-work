import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'

/**
 * The slice of DSH's `connection` service this plugin reads: the per-request
 * admission check the whole `/api` surface goes through (Host/Origin fence
 * against loopback, the bound address and configured/trusted tunnel
 * authorities, plus the signed browser-session cookie). Reusing it keeps the
 * panel on exactly the trust boundary the GUI itself uses instead of
 * inventing a second one — a visitor the app serves can read the ticket list,
 * and a visitor the app refuses cannot.
 */
export interface ConnectionFence {
  requestRejection(request: IncomingMessage): number | undefined
}

const isFence = (value: unknown): value is ConnectionFence => {
  if (value === null || typeof value !== 'object') return false
  return typeof (value as { requestRejection?: unknown }).requestRejection === 'function'
}

/**
 * Resolve the app-level admission predicate, if this runtime exposes it.
 *
 * Optional by design: a non-web profile, a test context, or an older kernel
 * without `connection` yields `undefined`, and callers fall back to the
 * plugin's own loopback fence. Looked up per call (the caller may retry) so a
 * service registered after this plugin still gets picked up.
 * @param ctx - plugin context.
 * @returns a predicate that is true when the app would serve the request, or
 *   `undefined` when no admission seam is available.
 */
export function admissionOf(ctx: Context): ((request: IncomingMessage) => boolean) | undefined {
  let service: unknown
  try {
    service = (ctx as unknown as { get(name: string): unknown }).get('connection')
  } catch {
    return undefined
  }
  const fence = service
  if (!isFence(fence)) return undefined
  return (request) => {
    try {
      return fence.requestRejection(request) === undefined
    } catch {
      return false
    }
  }
}
