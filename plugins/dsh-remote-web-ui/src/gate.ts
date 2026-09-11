/**
 * Request-gating helpers for the pairing surfaces: loopback classification,
 * cookie reads, and the live paired-device predicate. The 0.1.1 `api/gate`
 * waterfall (a per-request veto inside the connection plugin's /api bridge)
 * does not exist in DSH 0.1.5 — the harness /api trust fence is declarative
 * (Connection trustedHosts + LAN literals) — so these helpers now serve the
 * plugin's own /api/pair surfaces and the RemoteWebUiPairing service only.
 */

import type { IncomingMessage } from 'node:http'
import type { PairingService } from './pairing.ts'
import { isLoopbackAddress, isLoopbackHostname } from './loopback.ts'

/**
 * Read one cookie value from a Cookie header.
 * @param header - the raw Cookie header value (or undefined).
 * @param name - the cookie name.
 * @returns the value, or undefined when absent.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    if (key === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

/**
 * The effective Host hostname of a request.
 * @param request - node HTTP request.
 * @returns the normalized hostname, or undefined when unparsable.
 */
export function hostnameOf(request: IncomingMessage): string | undefined {
  const host = request.headers.host
  if (typeof host !== 'string') return undefined
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return undefined
  }
}

/** Whether a request comes from the desktop loopback client (loopback socket AND loopback Host). */
export function isLoopbackClient(request: IncomingMessage): boolean {
  const hostname = hostnameOf(request)
  if (hostname === undefined || !isLoopbackHostname(hostname)) return false
  const socket = request.socket as { remoteAddress?: string } | undefined
  return isLoopbackAddress(socket?.remoteAddress)
}

/**
 * Whether a request carries a live, non-revoked paired-device cookie for
 * the given service. Sibling host routes and the RemoteWebUiPairing service
 * use this check to recognize a paired device on their own surfaces.
 * @param service - the pairing service that owns the device table.
 * @param request - the incoming HTTP request.
 * @returns true when the cookie names a live session (and lastSeenAt was refreshed).
 */
export function isPairedDeviceRequest(service: PairingService, request: IncomingMessage): boolean {
  const deviceId = readCookie(request.headers.cookie, service.config.cookieName)
  if (deviceId === undefined) return false
  return service.touchDevice(deviceId)
}