import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Loads the `ctx.webServer` cordis Context augmentation.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Engine } from './engine.ts'
import type { Sessions } from './sessions.ts'

export interface RouteDeps {
  sessions: Sessions
  engine: Engine
}

const writeJson = (res: ServerResponse, status: number, value: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

/**
 * Registers the plugin's read-only HTTP surface and returns the route
 * disposers. `/hub` makes sure the hub session exists before answering, so a
 * sidebar panel can link to it on first load.
 */
export function registerRoutes(ctx: Context, deps: RouteDeps): (() => void)[] {
  const hub = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const hubSessionId = await deps.sessions.ensureHub()
      writeJson(res, 200, { hubSessionId, tickets: deps.engine.listTickets(50) })
    } catch (error) {
      writeJson(res, 500, { error: messageOf(error) })
    }
  }
  const health = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const tickets = deps.engine.listTickets(200)
    writeJson(res, 200, {
      ok: true,
      running: tickets.filter(ticket => ticket.state === 'working').length,
      queued: tickets.filter(ticket => ticket.state === 'queued').length,
    })
  }
  return [
    ctx.webServer.register({ kind: 'exact', path: '/mini-superagent/api/hub', handler: hub }),
    ctx.webServer.register({ kind: 'exact', path: '/mini-superagent/api/health', handler: health }),
  ]
}
