import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Store } from '../src/store.ts'
import { assignment, ticket } from './fixtures.ts'

let dir: string
let store: Store

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mini-store-')); store = new Store(join(dir, 'state.sqlite')) })
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

describe('Store', () => {
  it('round-trips a ticket with optional fields omitted', () => {
    store.insertTicket(ticket())
    expect(store.ticket('t-1a2b3c4d')).toEqual(ticket())
    expect(store.ticket('missing')).toBeUndefined()
  })

  it('round-trips an assignment and finds it by session', () => {
    store.insertTicket(ticket())
    store.insertAssignment(assignment())
    expect(store.assignmentBySession('worker-t-1a2b3c4d')?.id).toBe('a-00000001')
    expect(store.runningAssignment('t-1a2b3c4d')?.attempt).toBe(1)
  })

  it('rejects a second running assignment for the same ticket', () => {
    store.insertTicket(ticket())
    store.insertAssignment(assignment())
    expect(() => store.insertAssignment(assignment({ id: 'a-00000002', attempt: 2 })))
      .toThrow(/UNIQUE constraint failed/)
    store.endAssignment('a-00000001', 'ended')
    expect(() => store.insertAssignment(assignment({ id: 'a-00000003', attempt: 3 }))).not.toThrow()
  })

  it('keeps dispatch FIFO when tickets share one creation millisecond', () => {
    const createdAt = '2026-11-01T00:00:00.000Z'
    store.insertTicket(ticket({ id: 't-bbbbbbbb', createdAt }))
    store.insertTicket(ticket({ id: 't-aaaaaaaa', createdAt }))
    // Insertion order (rowid), not the random id, decides the tie.
    expect(store.oldestQueued()?.id).toBe('t-bbbbbbbb')
  })

  it('looks up the newest assignment when start times tie', () => {
    const startedAt = '2026-11-01T00:00:01.000Z'
    store.insertTicket(ticket())
    store.insertAssignment(assignment({ id: 'a-00000001', attempt: 1, state: 'ended', startedAt }))
    store.insertAssignment(assignment({ id: 'a-00000002', attempt: 2, startedAt }))
    expect(store.assignmentBySession('worker-t-1a2b3c4d')?.id).toBe('a-00000002')
  })

  it('rolls a transaction back when the callback throws', () => {
    expect(() => store.tx(() => { store.insertTicket(ticket()); throw new Error('boom') })).toThrow('boom')
    expect(store.ticket('t-1a2b3c4d')).toBeUndefined()
  })

  it('keeps meta values', () => {
    store.setMeta('hub_session', 'mini-hub-1')
    expect(store.meta('hub_session')).toBe('mini-hub-1')
  })
})
