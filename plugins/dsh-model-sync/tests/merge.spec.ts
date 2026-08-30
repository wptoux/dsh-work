import { describe, expect, it } from 'vitest'
import { buildMirrorModels, generateEntry, type ModelEntry } from '../src/merge.ts'
import type { PiAiModelJson } from '../src/catalog-json.ts'

const alpha1: PiAiModelJson = {
  id: 'alpha-1',
  name: 'Alpha One',
  api: 'openai-completions',
  baseUrl: 'https://opencode.ai/zen/go/v1',
  reasoning: true,
  input: ['text'],
  contextWindow: 1_000_000,
  maxTokens: 384_000,
  compat: { supportsStore: false, thinkingFormat: 'deepseek', openRouterRouting: true },
  thinkingLevelMap: { minimal: null, high: 'high', max: 'max' },
}

const beta1: PiAiModelJson = {
  id: 'beta-1',
  api: 'openai-responses',
  baseUrl: 'https://opencode.ai/zen/go/v1',
  reasoning: false,
  input: ['text', 'image'],
  contextWindow: 524_288,
  maxTokens: 65_536,
}

describe('generateEntry', () => {
  it('spells out the llm-pi-ai entry fields from pi-ai metadata', () => {
    const entry = generateEntry(alpha1)
    expect(entry).toMatchObject({
      id: 'alpha-1',
      name: 'Alpha One',
      contextWindow: 1_000_000,
      maxTokens: 384_000,
      input: ['text'],
      reasoningEfforts: { high: 'high', max: 'max' },
      compat: { supportsStore: false, thinkingFormat: 'deepseek' },
    })
    expect(entry.compat).not.toHaveProperty('openRouterRouting')
  })

  it('declares non-reasoning models without efforts but keeps modalities', () => {
    const entry = generateEntry(beta1)
    expect(entry.reasoningEfforts).toBe(false)
    expect(entry.input).toEqual(['text', 'image'])
  })
})

describe('buildMirrorModels', () => {
  const latest = new Map([['alpha-1', alpha1], ['beta-1', beta1], ['gamma-1', { id: 'gamma-1', api: 'openai-completions', baseUrl: 'x', input: ['text'], contextWindow: 1000, maxTokens: 100 }]])

  it('keeps previous entries verbatim and appends only genuinely new models', () => {
    const previous: ModelEntry[] = [
      { id: 'alpha-1', name: 'Alpha One Customised', contextWindow: 999 },
      { id: 'custom-0', name: 'User Gateway Model', contextWindow: 4096, maxTokens: 1024 },
    ]
    const result = buildMirrorModels({ previous, latest, served: ['alpha-1', 'custom-0'] })
    expect(result.models[0]).toBe(previous[0])
    expect(result.models[1]).toBe(previous[1])
    expect(result.models.map(m => m.id)).toEqual(['alpha-1', 'custom-0', 'beta-1', 'gamma-1'])
    expect(result.added).toEqual(['beta-1', 'gamma-1'])
    expect(result.changed).toBe(true)
  })

  it('reports no change when new ids are already served', () => {
    const previous = [generateEntry(alpha1), generateEntry(beta1)]
    const result = buildMirrorModels({ previous, latest, served: ['alpha-1', 'beta-1', 'gamma-1'] })
    expect(result.changed).toBe(false)
    expect(result.added).toEqual([])
  })

  it('does not duplicate an id present in previous and latest', () => {
    const previous = [generateEntry(alpha1)]
    const result = buildMirrorModels({ previous, latest, served: ['alpha-1'] })
    expect(result.models.filter(m => m.id === 'alpha-1')).toHaveLength(1)
  })
})