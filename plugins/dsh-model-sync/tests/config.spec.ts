import { describe, expect, it } from 'vitest'
import { resolveModelSyncConfig } from '../src/config.ts'

describe('resolveModelSyncConfig', () => {
  it('defaults to the opencode-go mirror and hourly interval', () => {
    const c = resolveModelSyncConfig()
    expect(c.mirrors).toEqual([
      { source: 'opencode-go', id: 'opencode-go-live', api: 'openai-completions', baseURL: 'https://opencode.ai/zen/go/v1' },
    ])
    expect(c.intervalMs).toBe(3_600_000)
    expect(c.fetchLive).toBe(true)
    expect(c.timeoutMs).toBe(15_000)
  })

  it('keeps user-supplied mirrors and overrides', () => {
    const c = resolveModelSyncConfig({
      mirrors: [{ source: 'deepseek', id: 'deepseek-live', api: 'openai-completions' }],
      intervalMs: 60_000,
    })
    expect(c.mirrors).toHaveLength(1)
    expect(c.mirrors[0]!.source).toBe('deepseek')
    expect(c.intervalMs).toBe(60_000)
  })
})