import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Engine } from '../src/engine.ts'
import { Store } from '../src/store.ts'
import { MiniError } from '../src/types.ts'

let dir: string
let store: Store
let engine: Engine

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mini-engine-'))
  store = new Store(join(dir, 'state.sqlite'))
  engine = new Engine(store)
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

const create = () => engine.createTicket({ title: 'fix readme', request: 'update commands', originSessionId: 'mini-hub-1' })

/** Runs `fn` and returns the typed `MiniError` it throws. */
const errorOf = (fn: () => unknown): MiniError => {
  try { fn() } catch (error) {
    if (error instanceof MiniError) return error
    throw error
  }
  throw new Error('expected a MiniError, but nothing was thrown')
}

describe('Engine', () => {
  it('creates a queued ticket with a work dir under the workspace', () => {
    const t = create()
    expect(t.state).toBe('queued')
    expect(t.workDir).toBe(`work/${t.id}`)
    expect(t.revision).toBe(0)
  })

  it('dispatches the oldest queued ticket once', async () => {
    const first = create()
    // Dispatch order is (created_at, id); a real delay keeps the timestamps distinct and the test deterministic.
    await new Promise(resolve => { setTimeout(resolve, 2) })
    const second = create()
    const claim = engine.dispatchNext()
    expect(claim?.ticket.id).toBe(first.id)
    expect(claim?.assignment.attempt).toBe(1)
    expect(store.ticket(first.id)?.state).toBe('working')
    expect(engine.dispatchNext()?.ticket.id).toBe(second.id)
    expect(engine.dispatchNext()).toBeUndefined()
  })

  it('moves a ticket through report states and notifies only on terminal states', () => {
    const t = create()
    const claim = engine.dispatchNext()!
    expect(engine.report(claim.assignment.sessionId, 'progress', 'halfway')).toEqual({ ticket: expect.objectContaining({ state: 'working', summary: 'halfway' }), notify: false })
    const done = engine.report(claim.assignment.sessionId, 'ended', 'shipped')
    expect(done.ticket.state).toBe('ended')
    expect(done.ticket.outcome).toBe('completed')
    expect(done.notify).toBe(true)
    expect(errorOf(() => engine.report(claim.assignment.sessionId, 'ended', 'again')).code).toBe('report/terminal-twice')
    expect(errorOf(() => engine.report('worker-unknown', 'progress', 'x')).code).toBe('assignment/not-running')
  })

  it('recovers a running assignment into a queued ticket with a recovery note', () => {
    const t = create()
    engine.dispatchNext()
    expect(engine.recover()).toBe(1)
    expect(store.ticket(t.id)?.state).toBe('queued')
    const claim = engine.dispatchNext()!
    expect(claim.assignment.attempt).toBe(2)
    expect(claim.assignment.recoveryNote).toContain('中断')
  })

  it('rejects retry from a non-retryable state and allows it from blocked', () => {
    const t = create()
    const claim = engine.dispatchNext()!
    engine.report(claim.assignment.sessionId, 'blocked', 'need a decision')
    expect(store.ticket(t.id)?.state).toBe('blocked')
    expect(engine.retry(t.id).state).toBe('queued')
    expect(errorOf(() => engine.retry(t.id)).code).toBe('ticket/not-retryable')
  })

  it('stops a working ticket and returns its session id', () => {
    const t = create()
    engine.dispatchNext()
    const stopped = engine.stop(t.id)
    expect(stopped.ticket.state).toBe('ended')
    expect(stopped.ticket.outcome).toBe('stopped')
    expect(stopped.sessionId).toBe(`worker-${t.id}`)
  })

  it('fails a dispatched ticket with the launch error in its summary', () => {
    const t = create()
    engine.dispatchNext()
    const failed = engine.failDispatch(t.id, 'no session')
    expect(failed.state).toBe('failed')
    expect(failed.summary).toContain('no session')
    expect(store.runningAssignment(t.id)).toBeUndefined()
  })

  it('refuses to fail-dispatch a ticket that already ended', () => {
    const t = create()
    engine.stop(t.id)
    expect(errorOf(() => engine.failDispatch(t.id, 'too late')).code).toBe('ticket/not-open')
    expect(store.ticket(t.id)?.state).toBe('ended')
  })
})
