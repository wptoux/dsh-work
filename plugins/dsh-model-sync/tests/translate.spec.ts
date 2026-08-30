import { describe, expect, it } from 'vitest'
import { COMPAT_OFFERED_FIELDS, filterCompat, translateInput, translateThinkingLevelMap } from '../src/translate.ts'

describe('translateThinkingLevelMap', () => {
  it('drops null wire values and off', () => {
    expect(translateThinkingLevelMap({ minimal: null, high: 'high', max: 'max' })).toEqual({ high: 'high', max: 'max' })
  })

  it('returns undefined for absent or empty maps', () => {
    expect(translateThinkingLevelMap(undefined)).toBeUndefined()
    expect(translateThinkingLevelMap(null)).toBeUndefined()
    expect(translateThinkingLevelMap({ off: null })).toBeUndefined()
  })
})

describe('translateInput', () => {
  it('keeps text and image only', () => {
    expect(translateInput(['text', 'image'])).toEqual(['text', 'image'])
    expect(translateInput(['text', 'video'])).toEqual(['text'])
  })

  it('returns undefined for absent or empty input', () => {
    expect(translateInput(undefined)).toBeUndefined()
    expect(translateInput([])).toBeUndefined()
  })
})

describe('filterCompat', () => {
  it('keeps only offered fields', () => {
    const out = filterCompat({ supportsStore: false, thinkingFormat: 'deepseek', openRouterRouting: true })
    expect(out).toEqual({ supportsStore: false, thinkingFormat: 'deepseek' })
  })

  it('returns undefined when nothing is offered', () => {
    expect(filterCompat({ openRouterRouting: true })).toBeUndefined()
    expect(filterCompat(undefined)).toBeUndefined()
  })

  it('offers the fields llm-pi-ai accepts', () => {
    expect(COMPAT_OFFERED_FIELDS).toContain('supportsStore')
    expect(COMPAT_OFFERED_FIELDS).toContain('thinkingFormat')
    expect(COMPAT_OFFERED_FIELDS).toContain('maxTokensField')
  })
})