import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parsePiAiCatalog } from '../src/catalog-json.ts'

const fixture = async () => {
  const dir = fileURLToPath(new URL('.', import.meta.url))
  return JSON.parse(await readFile(join(dir, 'fixtures/opencode-go.sample.json'), 'utf8')) as unknown
}

describe('parsePiAiCatalog', () => {
  it('flattens per-api groups into an id-keyed map', async () => {
    const models = parsePiAiCatalog(await fixture())
    expect([...models.keys()]).toEqual(['alpha-1', 'alpha-2', 'beta-1'])
    expect(models.get('alpha-1')).toMatchObject({ id: 'alpha-1', api: 'openai-completions', contextWindow: 1_000_000 })
    expect(models.get('beta-1')?.api).toBe('openai-responses')
  })

  it('skips non-object entries but keeps the rest', async () => {
    const models = parsePiAiCatalog(await fixture())
    expect(models.size).toBe(3)
  })

  it('throws on a non-object root', () => {
    expect(() => parsePiAiCatalog(null)).toThrow(TypeError)
    expect(() => parsePiAiCatalog([])).toThrow(TypeError)
  })
})