import { describe, expect, it } from 'vitest'
import { SettingsConflictError, syncMirror, SETTINGS_NS, type CatalogLike, type LlmLike, type SettingsLike } from '../src/sync.ts'

const spec = { source: 'opencode-go', id: 'opencode-go-live', api: 'openai-completions', baseURL: 'https://opencode.ai/zen/go/v1' }
const tarballModels = new Map<string, { id: string; api?: string; baseUrl?: string; input?: string[]; contextWindow?: number; maxTokens?: number }>([
  ['alpha-1', { id: 'alpha-1', api: 'openai-completions', baseUrl: spec.baseURL!, input: ['text'], contextWindow: 1000, maxTokens: 100 }],
  ['beta-1', { id: 'beta-1', api: 'openai-completions', baseUrl: spec.baseURL!, input: ['text'], contextWindow: 2000, maxTokens: 200 }],
])

function makeDeps(overrides: Partial<{
  section: unknown
  providers: string[]
  served: string[]
  previous: unknown[]
  catalog: unknown
  conflictCount?: number
  mutateError?: Error
}> = {}) {
  const state = {
    section: overrides.section ?? { providers: { [spec.source]: { apiKeyEnv: 'OPENCODE_GO_API_KEY' } } },
    providers: overrides.providers ?? [spec.source],
    served: overrides.served ?? [],
    previous: overrides.previous ?? [],
    ops: [] as { op: string; path: string[]; value?: unknown }[],
    revision: 1,
    mutateCalls: 0,
  }
  let conflictsLeft = overrides.conflictCount ?? 0
  const settings: SettingsLike = {
    get: () => state.section,
    describe: () => [{ ns: SETTINGS_NS, revision: state.revision }],
    mutate: async (_ns, ops, expectedRevision) => {
      state.mutateCalls += 1
      if (overrides.mutateError !== undefined) throw overrides.mutateError
      if (conflictsLeft > 0) {
        conflictsLeft -= 1
        throw new SettingsConflictError(SETTINGS_NS, expectedRevision ?? 0, state.revision)
      }
      if (expectedRevision !== undefined && expectedRevision !== state.revision) {
        throw new SettingsConflictError(SETTINGS_NS, expectedRevision, state.revision)
      }
      for (const op of ops) {
        state.ops.push({ op: op.op, path: [...op.path], value: (op as { value?: unknown }).value })
        if (op.op === 'set' && op.path[0] === 'providers' && op.path[2] === 'models' && Array.isArray(op.value)) {
          state.previous = op.value
        }
      }
      state.revision += 1
    },
  }
  const llm: LlmLike = {
    listProviders: () => state.providers.map(id => ({ id })),
    listModels: async (provider) => (provider === spec.id ? state.served.map(id => ({ id })) : []),
  }
  const catalog: CatalogLike = { fetchCatalog: async () => ({ version: '9.9.9', models: tarballModels }) }
  const logs: string[] = []
  return { state, settings, llm, catalog, logs }
}

describe('syncMirror', () => {
  it('bootstraps a missing mirror route with skeleton + models', async () => {
    const { state, settings, llm, catalog, logs } = makeDeps()
    await syncMirror({ settings, llm, catalog, log: m => logs.push(m) }, spec, { fetchLive: false })
    const setOps = state.ops.filter(o => o.op === 'set')
    expect(setOps.map(o => o.path.join('.'))).toEqual([
      'providers.opencode-go-live.api',
      'providers.opencode-go-live.baseURL',
      'providers.opencode-go-live.apiKeyEnv',
      'providers.opencode-go-live.models',
    ])
    expect((setOps[3]!.value as { id: string }[]).map(m => m.id)).toEqual(['alpha-1', 'beta-1'])
  })

  it('skips when nothing changed and the mirror already exists', async () => {
    const { state, settings, llm, catalog, logs } = makeDeps({
      section: {
        providers: {
          [spec.source]: { apiKeyEnv: 'OPENCODE_GO_API_KEY' },
          [spec.id]: { api: spec.api, baseURL: spec.baseURL, apiKeyEnv: 'OPENCODE_GO_API_KEY', models: [
            { id: 'alpha-1', contextWindow: 1000 },
            { id: 'beta-1', contextWindow: 2000 },
          ] },
        },
      },
      served: ['alpha-1', 'beta-1'],
      previous: [{ id: 'alpha-1', contextWindow: 1000 }, { id: 'beta-1', contextWindow: 2000 }],
    })
    await syncMirror({ settings, llm, catalog, log: m => logs.push(m) }, spec, { fetchLive: false })
    expect(state.ops).toHaveLength(0)
  })

  it('skips when the source route is not serving', async () => {
    const { state, settings, llm, catalog, logs } = makeDeps({ providers: [] })
    await syncMirror({ settings, llm, catalog, log: m => logs.push(m) }, spec, { fetchLive: false })
    expect(state.ops).toHaveLength(0)
    expect(logs.join('\n')).toContain('not serving')
  })

  it('appends only genuinely new models', async () => {
    const { state, settings, llm, catalog, logs } = makeDeps({
      section: {
        providers: {
          [spec.source]: { apiKeyEnv: 'OPENCODE_GO_API_KEY' },
          [spec.id]: { api: spec.api, baseURL: spec.baseURL, apiKeyEnv: 'OPENCODE_GO_API_KEY', models: [{ id: 'alpha-1', contextWindow: 1000 }] },
        },
      },
      served: ['alpha-1'],
      previous: [{ id: 'alpha-1', contextWindow: 1000 }],
    })
    await syncMirror({ settings, llm, catalog, log: m => logs.push(m) }, spec, { fetchLive: false })
    const modelsOp = state.ops.find(o => o.path.join('.').endsWith('models') && o.op === 'set')
    expect((modelsOp!.value as { id: string }[]).map(m => m.id)).toEqual(['alpha-1', 'beta-1'])
  })

  it('retries once after a conflict and writes', async () => {
    const { state, settings, llm, catalog, logs } = makeDeps({ conflictCount: 1 })
    await syncMirror({ settings, llm, catalog, log: m => logs.push(m) }, spec, { fetchLive: false })
    expect(state.mutateCalls).toBe(2)
    expect(state.ops.some(o => o.op === 'set' && o.path.join('.').endsWith('models'))).toBe(true)
    expect(logs.join('\n')).not.toContain('conflicted twice')
  })

  it('gives up after two conflicts and keeps last-good', async () => {
    const { state, settings, llm, catalog, logs } = makeDeps({ conflictCount: 2 })
    await syncMirror({ settings, llm, catalog, log: m => logs.push(m) }, spec, { fetchLive: false })
    expect(logs.join('\n')).toContain('conflicted twice')
    expect(state.ops).toHaveLength(0)
  })

  it('logs sync failed and does not throw on a non-conflict write error', async () => {
    const { state, settings, llm, catalog, logs } = makeDeps({ mutateError: new Error('disk full') })
    await expect(syncMirror({ settings, llm, catalog, log: m => logs.push(m) }, spec, { fetchLive: false })).resolves.toBeUndefined()
    expect(logs.join('\n')).toContain('sync failed')
    expect(logs.join('\n')).toContain('disk full')
    expect(state.ops).toHaveLength(0)
  })
})