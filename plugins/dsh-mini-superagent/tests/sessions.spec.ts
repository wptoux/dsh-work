import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mandateFor, roleOf, Sessions } from '../src/sessions.ts'
import { Store } from '../src/store.ts'
import { assignment, ticket } from './fixtures.ts'

let dir: string
let store: Store

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mini-sessions-')); store = new Store(join(dir, 'state.sqlite')) })
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

const fakeHost = () => {
  const created: string[] = []
  const prompted: { requestId: string; sessionId: string; mode: string; text: string }[] = []
  const decoratedCalls: { sessionId: string; timeoutMs: number }[] = []
  const events: string[] = []
  return {
    created, prompted, decorated: decoratedCalls, events,
    host: {
      stateDir: dir, workerPreset: 'standard', store,
      session: {
        create: async ({ sessionId }: { sessionId: string }) => { created.push(sessionId); events.push(`create:${sessionId}`) },
        rename: async () => {},
        resolve: async (sessionId: string) => created.includes(sessionId),
        prompt: async ({ requestId, sessionId, mode, content }: { requestId: string; sessionId: string; mode: string; content: { text: string }[] }) => {
          prompted.push({ requestId, sessionId, mode, text: content[0]!.text }); events.push(`prompt:${sessionId}`)
        },
      },
      workspace: { create: async (_cwd: string) => ({ id: 'ws-1' }) },
      decorated: async (sessionId: string, timeoutMs: number) => {
        decoratedCalls.push({ sessionId, timeoutMs }); events.push(`decorated:${sessionId}:${timeoutMs}`)
      },
    },
  }
}

describe('roles', () => {
  it('classifies hub, worker and other sessions', () => {
    expect(roleOf('mini-hub-abcd', 'mini-hub-abcd')).toBe('hub')
    expect(roleOf('worker-t-1-a1', 'mini-hub-abcd')).toBe('worker')
    expect(roleOf('some-session', 'mini-hub-abcd')).toBe('other')
  })

  it('renders the mandate with the request, the ticket folder and every report state', () => {
    const text = mandateFor(ticket(), '/tmp/mini/superagent')
    expect(text).toContain(ticket().request)
    expect(text).toContain('work/t-1a2b3c4d')
    expect(text).toContain('/tmp/mini/superagent')
    // A shell `cd` does not persist across bash tool calls, so the prefix must be per command.
    expect(text).toContain('每条命令都带上该前缀')
    expect(text).not.toContain('先 cd 进去')
    expect(text).toContain('report({ state: "ended"')
    expect(text).toContain('report({ state: "waiting"')
    expect(text).toContain('report({ state: "blocked"')
    expect(text).toContain('report({ state: "failed"')
  })

  it('appends the recovery note only when one is supplied', () => {
    expect(mandateFor(ticket(), '/tmp/mini/superagent')).not.toContain('上一轮')
    expect(mandateFor(ticket(), '/tmp/mini/superagent', '上一轮被中断')).toContain('上一轮被中断')
  })
})

describe('Sessions', () => {
  it('creates the hub once and reuses the stored id', async () => {
    const f = fakeHost()
    const sessions = new Sessions(f.host)
    const first = await sessions.ensureHub()
    const second = await sessions.ensureHub()
    expect(first).toBe(second)
    expect(first).toMatch(/^mini-hub-[0-9a-f]{8}$/)
    expect(f.created.filter(id => id.startsWith('mini-hub-'))).toHaveLength(1)
    expect(store.meta('hub_session')).toBe(first)
  })

  it('shares one hub creation between concurrent callers', async () => {
    const f = fakeHost()
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const create = f.host.session.create
    f.host.session.create = async (request: { sessionId: string }) => {
      calls += 1
      await gate
      await create(request)
    }
    const sessions = new Sessions(f.host)
    const first = sessions.ensureHub()
    const second = sessions.ensureHub()
    release()
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
    expect(calls).toBe(1)
    expect(f.created.filter(id => id.startsWith('mini-hub-'))).toHaveLength(1)
  })

  it('clears a rejected hub creation so the next call retries', async () => {
    const f = fakeHost()
    let calls = 0
    const create = f.host.session.create
    f.host.session.create = async (request: { sessionId: string }) => {
      calls += 1
      if (calls === 1) throw new Error('boom')
      await create(request)
    }
    const sessions = new Sessions(f.host)
    await expect(sessions.ensureHub()).rejects.toThrow('boom')
    await expect(sessions.ensureHub()).resolves.toMatch(/^mini-hub-[0-9a-f]{8}$/)
    expect(calls).toBe(2)
  })

  it('records the hub id before creating it, so agent/created sees the role', async () => {
    const f = fakeHost()
    let metaAtCreate: string | undefined
    const create = f.host.session.create
    f.host.session.create = async (request: { sessionId: string }) => {
      metaAtCreate = store.meta('hub_session')
      await create(request)
    }
    const sessions = new Sessions(f.host)
    const hub = await sessions.ensureHub()
    expect(metaAtCreate).toBe(hub)
  })

  it('replaces a stored hub id that no longer resolves', async () => {
    store.setMeta('hub_session', 'mini-hub-deadbeef')
    const f = fakeHost()
    const sessions = new Sessions(f.host)
    const hub = await sessions.ensureHub()
    expect(hub).not.toBe('mini-hub-deadbeef')
    expect(store.meta('hub_session')).toBe(hub)
  })

  it('creates the workspace directory before registering it', async () => {
    const f = fakeHost()
    let dirExisted: boolean | undefined
    f.host.workspace.create = async (cwd: string) => {
      // The kernel realpaths the cwd, so a missing directory fails registration.
      dirExisted = existsSync(cwd)
      return { id: 'ws-1' }
    }
    await new Sessions(f.host).ensureHub()
    expect(dirExisted).toBe(true)
    expect(existsSync(join(dir, 'superagent'))).toBe(true)
  })

  it('creates the ticket folder before prompting the worker', async () => {
    const f = fakeHost()
    await new Sessions(f.host).launch(ticket(), assignment())
    expect(existsSync(join(dir, 'superagent', 'work', 't-1a2b3c4d'))).toBe(true)
  })

  it('creates the workspace once and reuses the stored id', async () => {
    let calls = 0
    const f = fakeHost()
    f.host.workspace.create = async () => { calls += 1; return { id: 'ws-1' } }
    const sessions = new Sessions(f.host)
    expect(await sessions.ensureWorkspace()).toBe('ws-1')
    expect(await sessions.ensureWorkspace()).toBe('ws-1')
    expect(calls).toBe(1)
    expect(store.meta('workspace')).toBe('ws-1')
  })

  it('launches a worker session and prompts the mandate', async () => {
    const f = fakeHost()
    const sessions = new Sessions(f.host)
    await sessions.launch(ticket(), assignment())
    expect(f.created).toContain('worker-t-1a2b3c4d-a1')
    expect(f.prompted[0]?.text).toContain('票据 t-1a2b3c4d')
    // Tools must exist before the first message, and the decorated timeout must be the 5s contract.
    expect(f.decorated).toEqual([{ sessionId: 'worker-t-1a2b3c4d-a1', timeoutMs: 5000 }])
    const decoratedIndex = f.events.indexOf('decorated:worker-t-1a2b3c4d-a1:5000')
    const promptIndex = f.events.indexOf('prompt:worker-t-1a2b3c4d-a1')
    expect(decoratedIndex).toBeGreaterThanOrEqual(0)
    expect(promptIndex).toBeGreaterThanOrEqual(0)
    expect(decoratedIndex).toBeLessThan(promptIndex)
  })

  it('sends a prompt with a fresh request id and the requested mode', async () => {
    const f = fakeHost()
    const sessions = new Sessions(f.host)
    await sessions.send('mini-hub-00000000', 'hello')
    await sessions.send('mini-hub-00000000', 'steer me', 'steer')
    expect(f.prompted[0]).toMatchObject({ sessionId: 'mini-hub-00000000', mode: 'queue' })
    expect(f.prompted[1]).toMatchObject({ sessionId: 'mini-hub-00000000', mode: 'steer' })
    expect(f.prompted[0]!.requestId).not.toBe(f.prompted[1]!.requestId)
  })
})
