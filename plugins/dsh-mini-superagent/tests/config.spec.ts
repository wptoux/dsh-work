import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'

describe('config', () => {
  it('defaults maxWorkers to 1 and workerPreset to standard', () => {
    const value = Config({ stateDir: '/tmp/mini' })
    expect(value.maxWorkers).toBe(1)
    expect(value.workerPreset).toBe('standard')
  })

  it('rejects a relative stateDir', () => {
    expect(() => Config({ stateDir: 'relative/path' })).toThrow()
  })
})
