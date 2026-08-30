import { afterEach, describe, expect, it } from 'vitest'
import { buildLiveUrl, parseLiveListing, probeLiveModels, resolveEnvKey } from '../src/live.ts'

describe('resolveEnvKey', () => {
  const before = process.env.MS_TEST_KEY
  afterEach(() => {
    if (before === undefined) delete process.env.MS_TEST_KEY
    else process.env.MS_TEST_KEY = before
  })

  it('resolves the referenced environment variable', () => {
    process.env.MS_TEST_KEY = 'sekret'
    expect(resolveEnvKey('MS_TEST_KEY')).toBe('sekret')
    expect(resolveEnvKey(undefined)).toBeUndefined()
    expect(resolveEnvKey('MISSING_MS_KEY')).toBeUndefined()
  })
})

describe('buildLiveUrl', () => {
  it('appends /models without doubling slashes', () => {
    expect(buildLiveUrl('https://opencode.ai/zen/go/v1')).toBe('https://opencode.ai/zen/go/v1/models')
    expect(buildLiveUrl('https://opencode.ai/zen/go/v1/')).toBe('https://opencode.ai/zen/go/v1/models')
  })
})

describe('parseLiveListing', () => {
  it('extracts ids from the OpenAI listing shape', () => {
    expect(parseLiveListing({ data: [{ id: 'a' }, { id: 'b' }] })).toEqual(['a', 'b'])
    expect(parseLiveListing({ data: [{ id: 'a' }, { name: 'b' }] })).toEqual(['a'])
  })

  it('returns undefined for unparseable bodies', () => {
    expect(parseLiveListing(null)).toBeUndefined()
    expect(parseLiveListing({ data: 'nope' })).toBeUndefined()
  })
})

describe('probeLiveModels', () => {
  it('returns ids on success', async () => {
    const probe = await probeLiveModels({
      baseURL: 'https://opencode.ai/zen/go/v1',
      apiKey: 'k',
      fetchImpl: (async () => new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 })) as typeof fetch,
    })
    expect(probe).toEqual({ ok: true, ids: ['m1'] })
  })

  it('reports refusal instead of throwing', async () => {
    const probe = await probeLiveModels({
      baseURL: 'https://opencode.ai/zen/go/v1',
      fetchImpl: (async () => { throw new Error('offline') }) as typeof fetch,
    })
    expect(probe.ok).toBe(false)
  })
})