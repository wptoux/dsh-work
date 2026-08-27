/**
 * Host fs.read identity contract — the file-refresh staleness seam. The
 * editor reads files while tracking "the version on disk": text and binary
 * reads now carry the file's size + mtimeMs, and a metaOnly request returns
 * just that identity WITHOUT reading content (image/PDF and binary-download
 * surfaces stat the file instead of re-reading bytes on every check).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.ts'
import type { SidebarWebRoute, SidebarWebUpgradeRoute } from '../src/context-types.ts'

interface InvokeResult {
  ok: boolean
  value?: Record<string, unknown>
  error?: { message: string }
}

describe('fs.read identity (refresh staleness)', () => {
  let dir: string
  let route: SidebarWebRoute

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-fs-identity-'))
    const routes: SidebarWebRoute[] = []
    const ctx = {
      webRuntime: { trustedHosts: [] },
      webServer: {
        register: (r: SidebarWebRoute) => { routes.push(r); return () => {} },
        registerUpgrade: (r: SidebarWebUpgradeRoute) => { void r; return () => {} },
      },
      // The session's header cwd is the temp workspace: absolute paths ride
      // through resolveGitPath untouched (no repo-relative resolution).
      sessions: { get: () => ({ header: { cwd: dir } }) },
      tools: { register: () => () => {} },
      effect: (fn: () => void | (() => void)) => { fn() },
      inject: () => () => {},
      get: () => undefined,
    }
    apply(ctx as never)
    route = routes.find(r => r.path === '/sidebar/api')!
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const invoke = async (method: string, payload: unknown): Promise<InvokeResult> => {
    const body = Buffer.from(JSON.stringify(payload))
    const req = {
      method: 'POST',
      url: `/sidebar/api/${method}`,
      headers: { host: '127.0.0.1:3080' },
      [Symbol.asyncIterator]: async function* () { yield body },
    } as never
    const out: { status: number; body: string } = { status: 200, body: '' }
    const res = {
      writeHead: (status: number) => { out.status = status },
      end: (chunk: unknown) => { out.body += String(chunk ?? '') },
    } as never
    await route.handler(req, res)
    return JSON.parse(out.body) as InvokeResult
  }

  it('fs.read text responses carry the file size and mtime', async () => {
    const path = join(dir, 'a.txt')
    await writeFile(path, 'hello', 'utf8')
    const result = await invoke('fs.read', { sessionId: 's1', path })
    expect(result.ok).toBe(true)
    expect(result.value?.kind).toBe('text')
    expect(result.value?.content).toBe('hello')
    expect(result.value?.size).toBe(5)
    expect(typeof result.value?.mtimeMs).toBe('number')
    expect(result.value!.mtimeMs as number).toBeGreaterThanOrEqual(0)
  })

  it('fs.read binary responses carry the file size and mtime', async () => {
    const path = join(dir, 'b.bin')
    await writeFile(path, Buffer.from([0x00, 0x01, 0x02]))
    const result = await invoke('fs.read', { sessionId: 's1', path })
    expect(result.ok).toBe(true)
    expect(result.value?.kind).toBe('binary')
    expect(result.value?.size).toBe(3)
    expect(typeof result.value?.head).toBe('string')
    expect(typeof result.value?.mtimeMs).toBe('number')
  })

  it('fs.read metaOnly returns the identity without reading content', async () => {
    const path = join(dir, 'c.txt')
    await writeFile(path, 'hello', 'utf8')
    const result = await invoke('fs.read', { sessionId: 's1', path, metaOnly: true })
    expect(result.ok).toBe(true)
    expect(result.value?.kind).toBe('meta')
    expect(result.value?.content).toBeUndefined()
    expect(result.value?.size).toBe(5)
    expect(typeof result.value?.mtimeMs).toBe('number')
  })
})