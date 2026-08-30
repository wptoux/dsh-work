import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as tar from 'tar'
import { extractTarballEntry, NpmRegistryClient } from '../src/registry.ts'

const sampleCatalog = {
  'openai-completions': {
    'alpha-1': { id: 'alpha-1', api: 'openai-completions', baseUrl: 'https://example.test/v1', input: ['text'], contextWindow: 1000, maxTokens: 100 },
  },
}

function fakeFetch(results: Map<string, unknown>): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0] | URL) => {
    const url = String(input)
    const body = results.get(url)
    if (body === undefined) throw new Error(`unexpected fetch: ${url}`)
    return new Response(typeof body === 'string' ? body : body instanceof Uint8Array ? body : JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
}

describe('extractTarballEntry', () => {
  it('extracts a single entry from a gzipped tarball', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-model-sync-test-'))
    try {
      await mkdir(join(dir, 'package/dist/providers/data'), { recursive: true })
      await writeFile(join(dir, 'package/dist/providers/data/opencode-go.json'), JSON.stringify(sampleCatalog))
      await tar.c({ gzip: true, file: join(dir, 'pkg.tgz'), cwd: dir }, ['package/dist/providers/data/opencode-go.json'])
      const bytes = await readFile(join(dir, 'pkg.tgz'))
      const out = await extractTarballEntry(new Uint8Array(bytes), 'package/dist/providers/data/opencode-go.json')
      expect(JSON.parse(out!)).toEqual(sampleCatalog)
      expect(await extractTarballEntry(new Uint8Array(bytes), 'package/not-there.json')).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('NpmRegistryClient', () => {
  const registry = 'https://registry.npmjs.org'
  const pkg = '@earendil-works/pi-ai'
  const metaUrl = `${registry}/${encodeURIComponent(pkg)}/latest` // encodeURIComponent('@earendil-works/pi-ai')
  const tgzUrl = `${registry}/@earendil-works/pi-ai/-/pi-ai-9.9.9.tgz`

  it('downloads on a cold cache and serves the parsed catalog', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'dsh-model-sync-cache-'))
    try {
      const bytes = await makeTgz()
      const results = new Map<string, unknown>([
        [metaUrl, { version: '9.9.9', dist: { tarball: tgzUrl } }],
        [String(tgzUrl), bytes],
      ])
      const client = new NpmRegistryClient({ cacheDir, pkg, registry, fetchImpl: fakeFetch(results) })
      const catalog = await client.fetchCatalog('opencode-go')
      expect(catalog?.version).toBe('9.9.9')
      expect(catalog?.models.get('alpha-1')?.contextWindow).toBe(1000)
      // Cache files landed.
      await expect(readFile(join(cacheDir, 'opencode-go.meta.json'), 'utf8')).resolves.toContain('9.9.9')
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('serves the cache without network while fresh', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'dsh-model-sync-cache-'))
    try {
      await writeFile(join(cacheDir, 'opencode-go.json'), JSON.stringify(sampleCatalog))
      await writeFile(join(cacheDir, 'opencode-go.meta.json'), JSON.stringify({ version: '8.8.8', cachedAt: 5_000 }))
      let calls = 0
      const fetchImpl = (async (): Promise<Response> => {
        calls += 1
        throw new Error('network must not be used')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any as typeof fetch
      const client = new NpmRegistryClient({ cacheDir, pkg, registry, fetchImpl, now: () => 10_000, maxAgeMs: 60_000 })
      const catalog = await client.fetchCatalog('opencode-go')
      expect(calls).toBe(0)
      expect(catalog?.version).toBe('8.8.8')
      expect(catalog?.models.get('alpha-1')?.id).toBe('alpha-1')
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('returns undefined on network failure', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'dsh-model-sync-cache-'))
    try {
      const fetchImpl = (async (): Promise<Response> => {
        throw new Error('offline')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any as typeof fetch
      const client = new NpmRegistryClient({ cacheDir, pkg, registry, fetchImpl, maxAgeMs: 0 })
      expect(await client.fetchCatalog('opencode-go')).toBeUndefined()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('does not poison the cache when the extracted catalog fails to parse', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'dsh-model-sync-cache-'))
    try {
      const bytes = await makeTgz('[]') // valid JSON whose root is an array → parse TypeError
      const results = new Map<string, unknown>([
        [metaUrl, { version: '9.9.9', dist: { tarball: tgzUrl } }],
        [String(tgzUrl), bytes],
      ])
      const client = new NpmRegistryClient({ cacheDir, pkg, registry, fetchImpl: fakeFetch(results) })
      await expect(client.fetchCatalog('opencode-go')).resolves.toBeUndefined()
      // A bad bundle must never land in the cache: it would shadow the good
      // one until maxAge expires.
      await expect(readFile(join(cacheDir, 'opencode-go.json'), 'utf8')).rejects.toThrow()
      await expect(readFile(join(cacheDir, 'opencode-go.meta.json'), 'utf8')).rejects.toThrow()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })
})

async function makeTgz(raw: string = JSON.stringify(sampleCatalog)): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-model-sync-tgz-'))
  try {
    const entry = 'package/dist/providers/data/opencode-go.json'
    await mkdir(join(dir, 'package/dist/providers/data'), { recursive: true })
    await writeFile(join(dir, entry), raw)
    await tar.c({ gzip: true, file: join(dir, 'pkg.tgz'), cwd: dir }, [entry])
    return new Uint8Array(await readFile(join(dir, 'pkg.tgz')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}