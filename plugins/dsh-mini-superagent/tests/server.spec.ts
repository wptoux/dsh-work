import { mkdtempSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Engine } from '../src/engine.ts'
import { registerRoutes } from '../src/server.ts'
import type { Sessions } from '../src/sessions.ts'
import { Store } from '../src/store.ts'

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

let dir: string
let store: Store
let engine: Engine

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mini-server-'))
  store = new Store(join(dir, 'state.sqlite'))
  engine = new Engine(store)
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

const mount = (ensureHub: () => Promise<string>) => {
  const routes = new Map<string, Handler>()
  const ctx = {
    webServer: {
      register(route: { path: string; handler: Handler }) {
        routes.set(route.path, route.handler)
        return () => { routes.delete(route.path) }
      },
    },
  } as unknown as Context
  const disposers = registerRoutes(ctx, { engine, sessions: { ensureHub } as unknown as Sessions })
  return { routes, disposers }
}

const call = async (handler: Handler): Promise<{ status: number; json: unknown }> => {
  let status = 0
  let body = ''
  const res = { writeHead: (value: number) => { status = value }, end: (value: string) => { body = value } } as unknown as ServerResponse
  await handler({} as IncomingMessage, res)
  return { status, json: JSON.parse(body) as unknown }
}

describe('routes', () => {
  it('answers /hub with the hub session and the tickets', async () => {
    const { routes } = mount(async () => 'mini-hub-1')
    const ticket = engine.createTicket({ title: 'fix readme', request: 'update commands', originSessionId: 'mini-hub-1' })
    const response = await call(routes.get('/mini-superagent/api/hub')!)
    expect(response.status).toBe(200)
    expect(response.json).toMatchObject({ hubSessionId: 'mini-hub-1', tickets: [{ id: ticket.id, state: 'queued' }] })
  })

  it('answers 500 with the error when the hub cannot be ensured', async () => {
    const { routes } = mount(async () => { throw new Error('no session') })
    const response = await call(routes.get('/mini-superagent/api/hub')!)
    expect(response.status).toBe(500)
    expect(response.json).toEqual({ error: 'no session' })
  })

  it('counts running and queued tickets on /health', async () => {
    const { routes } = mount(async () => 'mini-hub-1')
    engine.createTicket({ title: 'a', request: 'a', originSessionId: 'mini-hub-1' })
    engine.createTicket({ title: 'b', request: 'b', originSessionId: 'mini-hub-1' })
    engine.dispatchNext()
    const response = await call(routes.get('/mini-superagent/api/health')!)
    expect(response.status).toBe(200)
    expect(response.json).toEqual({ ok: true, running: 1, queued: 1 })
  })

  it('removes both routes when disposed', () => {
    const { routes, disposers } = mount(async () => 'mini-hub-1')
    expect([...routes.keys()]).toEqual(['/mini-superagent/api/hub', '/mini-superagent/api/health'])
    for (const dispose of disposers) dispose()
    expect(routes.size).toBe(0)
  })
})
