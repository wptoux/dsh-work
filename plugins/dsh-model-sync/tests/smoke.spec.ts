import { describe, expect, it } from 'vitest'
import { name } from '../src/index.ts'

describe('plugin identity', () => {
  it('registers under the stable cordis id', () => {
    expect(name).toBe('model-sync')
  })
})