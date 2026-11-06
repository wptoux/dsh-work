import { mkdtempSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Engine } from '../src/engine.ts'
import { registerRoutes, isLoopbackHost } from '../src/server.ts'
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

const mount = (ensureHub: () => Promise<string>, admitted?: (req: IncomingMessage) => boolean) => {
  const routes = new Map<string, Handler>()
  const ctx = {
    webServer: {
      register(route: { path: string; handler: Handler }) {
        routes.set(route.path, route.handler)
        return () => { routes.delete(route.path) }
      },
    },
  } as unknown as Context
  const disposers = registerRoutes(ctx, {
    engine,
    sessions: { ensureHub } as unknown as Sessions,
    ...(admitted === undefined ? {} : { admitted }),
  })
  return { routes, disposers }
}

const call = async (
  handler: Handler,
  host: string | null = 'localhost:3080',
  extra: Record<string, string> = {},
  peer = '127.0.0.1',
): Promise<{ status: number; json: unknown }> => {
  let status = 0
  let body = ''
  const res = { writeHead: (value: number) => { status = value }, end: (value: string) => { body = value } } as unknown as ServerResponse
  await handler({
    headers: { ...(host === null ? {} : { host }), ...extra },
    socket: { remoteAddress: peer },
  } as unknown as IncomingMessage, res)
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
    expect(response.json).toEqual({ ok: true, schemaVersion: 1, running: 1, queued: 1 })
  })

  it('removes both routes when disposed', () => {
    const { routes, disposers } = mount(async () => 'mini-hub-1')
    expect([...routes.keys()]).toEqual(['/mini-superagent/api/hub', '/mini-superagent/api/health'])
    for (const dispose of disposers) dispose()
    expect(routes.size).toBe(0)
  })

  it('accepts a request the app-level admission already served (tunnel + browser session)', async () => {
    const hosts: (string | undefined)[] = []
    const { routes } = mount(async () => 'mini-hub-1', (req) => {
      hosts.push(req.headers.host)
      return true
    })
    // A tunneled request carries a foreign Host and proxy headers; the connection
    // fence + signed browser cookie already vetted it, so the panel must not 403.
    const response = await call(
      routes.get('/mini-superagent/api/hub')!,
      'abc.trycloudflare.com',
      { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-proto': 'https' },
      '127.0.0.1',
    )
    expect(response.status).toBe(200)
    expect(hosts).toEqual(['abc.trycloudflare.com'])
  })

  it('refuses a loopback Host when the peer socket is not loopback', async () => {
    const { routes } = mount(async () => 'mini-hub-1')
    const response = await call(routes.get('/mini-superagent/api/health')!, '127.0.0.1:3080', {}, '203.0.113.9')
    expect(response.status).toBe(403)
  })

  it('refuses instead of crashing when the admission check throws', async () => {
    const { routes } = mount(async () => 'mini-hub-1', () => { throw new Error('boom') })
    const response = await call(routes.get('/mini-superagent/api/health')!, 'abc.trycloudflare.com', { 'cf-connecting-ip': '203.0.113.7' })
    expect(response.status).toBe(403)
  })

  it('rejects a non-loopback Host before touching sessions', async () => {
    let ensured = false
    const { routes } = mount(async () => { ensured = true; return 'mini-hub-1' })
    const hub = await call(routes.get('/mini-superagent/api/hub')!, 'tunnel.example.com:443')
    expect(hub.status).toBe(403)
    expect(hub.json).toEqual({ error: 'forbidden host' })
    expect(ensured).toBe(false)
    const health = await call(routes.get('/mini-superagent/api/health')!, 'tunnel.example.com:443')
    expect(health.status).toBe(403)
    expect(health.json).toEqual({ error: 'forbidden host' })
  })

  it('rejects a request with no Host header', async () => {
    const { routes } = mount(async () => 'mini-hub-1')
    const response = await call(routes.get('/mini-superagent/api/health')!, null)
    expect(response.status).toBe(403)
  })

  it('rejects a loopback Host when a proxy/tunnel added forwarding headers', async () => {
    const { routes } = mount(async () => 'mini-hub-1')
    const health = routes.get('/mini-superagent/api/health')!
    const forwardedVariants: Record<string, string>[] = [
      { 'x-forwarded-for': '203.0.113.7' },
      { 'x-forwarded-host': 'abc.trycloudflare.com' },
      { 'x-forwarded-proto': 'https' },
      { forwarded: 'for=203.0.113.7' },
      { 'cf-connecting-ip': '203.0.113.7' },
    ]
    for (const extra of forwardedVariants) {
      const response = await call(health, '127.0.0.1:3080', extra)
      expect(response.status, JSON.stringify(extra)).toBe(403)
      expect(response.json).toEqual({ error: 'forbidden host' })
    }
  })

  it('accepts every loopback Host spelling', async () => {
    const { routes } = mount(async () => 'mini-hub-1')
    const health = routes.get('/mini-superagent/api/health')!
    for (const host of ['localhost', 'localhost:3080', '127.0.0.1', '127.0.0.1:3080', '[::1]', '[::1]:3080', 'LOCALHOST:3080']) {
      const response = await call(health, host)
      expect(response.status, host).toBe(200)
    }
  })
})

describe('isLoopbackHost', () => {
  it('matches only real loopback hosts', () => {
    for (const host of ['localhost', 'localhost:3080', '127.0.0.1', '127.0.0.1:3080', '[::1]', '[::1]:3080']) {
      expect(isLoopbackHost(host), host).toBe(true)
    }
    for (const host of [undefined, '', 'localhost.evil.com', '127.0.0.1.nip.io', 'evil.example:3080', '[::1']) {
      expect(isLoopbackHost(host), String(host)).toBe(false)
    }
  })
})
