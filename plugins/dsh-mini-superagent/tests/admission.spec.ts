import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { admissionOf } from '../src/admission.ts'

const ctxWith = (lookup: () => unknown): Context => ({ get: lookup }) as unknown as Context
const request = {} as IncomingMessage

describe('admissionOf', () => {
  it('returns undefined when the connection service is absent', () => {
    expect(admissionOf(ctxWith(() => { throw new Error('missing service') }))).toBeUndefined()
    expect(admissionOf(ctxWith(() => undefined))).toBeUndefined()
  })

  it('returns undefined when the service has no requestRejection', () => {
    expect(admissionOf(ctxWith(() => ({})))).toBeUndefined()
  })

  it('admits a request the connection fence has no rejection for', () => {
    const admit = admissionOf(ctxWith(() => ({ requestRejection: () => undefined })))
    expect(admit?.(request)).toBe(true)
  })

  it('refuses a request the connection fence rejects', () => {
    const admit = admissionOf(ctxWith(() => ({ requestRejection: () => 403 })))
    expect(admit?.(request)).toBe(false)
  })

  it('refuses when the fence throws instead of crashing the route', () => {
    const admit = admissionOf(ctxWith(() => ({ requestRejection: () => { throw new Error('boom') } })))
    expect(admit?.(request)).toBe(false)
  })
})
