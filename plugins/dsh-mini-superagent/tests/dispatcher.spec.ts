import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dispatcher } from '../src/dispatcher.ts'
import { Engine } from '../src/engine.ts'
import { Store } from '../src/store.ts'
import type { Assignment, Ticket } from '../src/types.ts'

let dir: string
let store: Store
let engine: Engine
let launched: string[]

const logger = { info() {}, warn() {} }
const okay = async (ticket: Ticket) => { launched.push(ticket.id) }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mini-dispatch-'))
  store = new Store(join(dir, 'state.sqlite'))
  engine = new Engine(store)
  launched = []
})
afterEach(() => {
  vi.useRealTimers()
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

const dispatcherFor = (launch: (ticket: Ticket, assignment: Assignment) => Promise<void>, maxWorkers = 1): Dispatcher =>
  new Dispatcher({ engine, maxWorkers, logger, sessions: { launch } })

const create = (title: string): Ticket => engine.createTicket({ title, request: title, originSessionId: 'mini-hub-1' })

describe('Dispatcher', () => {
  it('claims at most maxWorkers tickets and launches each once', async () => {
    const dispatcher = dispatcherFor(okay)
    create('a')
    create('b')
    await dispatcher.tick()
    expect(launched).toHaveLength(1)
    expect(store.openTickets().filter(t => t.state === 'working')).toHaveLength(1)
  })

  it('launches up to maxWorkers tickets in one tick', async () => {
    const dispatcher = dispatcherFor(okay, 2)
    create('a')
    create('b')
    create('c')
    await dispatcher.tick()
    expect(launched).toHaveLength(2)
    expect(store.openTickets().filter(t => t.state === 'working')).toHaveLength(2)
  })

  it('does not overfill when every worker is already busy', async () => {
    const dispatcher = dispatcherFor(okay, 1)
    create('a')
    create('b')
    await dispatcher.tick()
    await dispatcher.tick()
    expect(launched).toHaveLength(1)
  })

  it('fails the ticket when launch throws', async () => {
    const dispatcher = dispatcherFor(async () => { throw new Error('no session') })
    const t = create('a')
    await dispatcher.tick()
    expect(store.ticket(t.id)?.state).toBe('failed')
    expect(store.ticket(t.id)?.summary).toContain('no session')
    expect(store.runningAssignment(t.id)).toBeUndefined()
  })

  it('does not dispatch after stop', async () => {
    const dispatcher = dispatcherFor(okay)
    dispatcher.stop()
    const t = create('a')
    await dispatcher.tick()
    expect(launched).toEqual([])
    expect(store.ticket(t.id)?.state).toBe('queued')
  })

  it('polls on its interval until stopped', async () => {
    vi.useFakeTimers()
    const dispatcher = dispatcherFor(okay)
    dispatcher.start(1000)
    create('a')
    await vi.advanceTimersByTimeAsync(1000)
    expect(launched).toHaveLength(1)
    dispatcher.stop()
    create('b')
    await vi.advanceTimersByTimeAsync(3000)
    expect(launched).toHaveLength(1)
  })
})
