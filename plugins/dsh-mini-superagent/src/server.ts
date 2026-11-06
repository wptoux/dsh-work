import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Loads the `ctx.webServer` cordis Context augmentation.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Engine } from './engine.ts'
import type { Sessions } from './sessions.ts'

export interface RouteDeps {
  sessions: Sessions
  engine: Engine
  /**
   * App-level admission: true when DSH's own connection fence and browser
   * session would serve this request (loopback, the bind address, a trusted
   * tunnel authority — always with a signed browser cookie). When absent only
   * the local loopback client is served.
   */
  admitted?: (request: IncomingMessage) => boolean
}

const writeJson = (res: ServerResponse, status: number, value: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** Hostnames the read-only API accepts: the loopback interface only, never a tunnel. */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * Headers an upstream reverse proxy or tunnel adds. The cloudflared quick
 * tunnel this profile may enable (`--url http://127.0.0.1…`) rewrites `Host`
 * to the origin, so the Host check alone cannot tell a tunnel request from a
 * local one; these headers can.
 */
const PROXY_HEADERS = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'cf-connecting-ip'] as const

/**
 * Whether a `Host` header names the loopback interface, ignoring any port.
 *
 * These routes live outside the web server's `/api` connection fence and the
 * profile can expose the whole app through a tunnel, so the Host header is the
 * first gate between ticket titles/summaries and a remote visitor.
 * @param host - raw `Host` header value.
 * @returns true for `127.0.0.1`, `localhost`, or `[::1]`, with or without a port.
 */
export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined) return false
  const value = host.trim().toLowerCase()
  if (value === '') return false
  const name = value.startsWith('[')
    ? value.slice(0, value.indexOf(']') + 1)
    : value.replace(/:\d+$/, '')
  return LOOPBACK_HOSTNAMES.has(name)
}

/** Reflect an IPv4/IPv6 loopback peer address. */
const isLoopbackAddress = (address: string | undefined): boolean =>
  address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'

/**
 * Whether the desktop loopback client sent this request: a loopback peer
 * socket, a loopback Host, and no proxy/tunnel markers. The peer check is the
 * primary signal (a client cannot spoof it), the Host check keeps a
 * loopback-bound proxy from relaying; forwarding headers veto both, because
 * cloudflared connects from 127.0.0.1 and rewrites Host to the origin.
 * @param req - incoming request.
 * @returns true only for a genuinely local, direct request.
 */
export function isLoopbackClient(req: IncomingMessage): boolean {
  if (PROXY_HEADERS.some(name => req.headers[name] !== undefined)) return false
  const socket = req.socket as { remoteAddress?: string } | undefined
  if (!isLoopbackAddress(socket?.remoteAddress)) return false
  return isLoopbackHost(req.headers.host)
}

/** Whether the app-level admission seam (when injected) served this request. */
const admittedByApp = (deps: RouteDeps, req: IncomingMessage): boolean => {
  if (deps.admitted === undefined) return false
  try {
    return deps.admitted(req) === true
  } catch {
    return false
  }
}

/**
 * Refuse a request that is neither served by the app's own admission (which
 * covers a tunneled GUI with a live browser session) nor a direct local call.
 * The ticket titles/summaries never reach an unauthenticated remote visitor.
 */
const fenced = (deps: RouteDeps, req: IncomingMessage, res: ServerResponse): boolean => {
  if (admittedByApp(deps, req) || isLoopbackClient(req)) return false
  writeJson(res, 403, { error: 'forbidden host' })
  return true
}

/**
 * Registers the plugin's read-only HTTP surface and returns the route
 * disposers. `/hub` makes sure the hub session exists before answering, so a
 * sidebar panel can link to it on first load. Both routes sit outside the web
 * server's `/api` fence, so they apply the same admission themselves (see
 * `RouteDeps.admitted`); without that seam only the local client is served.
 */
export function registerRoutes(ctx: Context, deps: RouteDeps): (() => void)[] {
  const hub = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (fenced(deps, req, res)) return
    try {
      const hubSessionId = await deps.sessions.ensureHub()
      writeJson(res, 200, { hubSessionId, tickets: deps.engine.listTickets(50) })
    } catch (error) {
      writeJson(res, 500, { error: messageOf(error) })
    }
  }
  const health = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (fenced(deps, req, res)) return
    writeJson(res, 200, {
      ok: true,
      schemaVersion: deps.engine.schemaVersion,
      running: deps.engine.runningCount(),
      queued: deps.engine.queuedCount(),
    })
  }
  return [
    ctx.webServer.register({ kind: 'exact', path: '/mini-superagent/api/hub', handler: hub }),
    ctx.webServer.register({ kind: 'exact', path: '/mini-superagent/api/health', handler: health }),
  ]
}
