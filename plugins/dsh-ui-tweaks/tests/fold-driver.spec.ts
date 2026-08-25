/** @vitest-environment jsdom */
/**
 * Fold driver: turns ConversationSnapshot-shaped data into DOM folds via the
 * pure planner + DOM applier, auto-loads older history to complete page-split
 * closed turns, and owns the per-session expanded state. Fakes the session
 * source — no kernel services needed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFoldDriver,
  windowFromSnapshot,
  type DriverNode,
  type DriverSnapshot,
  type FoldSessionHandle,
  type FoldSessionSource,
} from '../src/client/fold-driver'
import type { FoldCopy } from '../src/client/fold-dom'

/** @vitest-environment jsdom */
const COPY: FoldCopy = {
  header: () => '已处理',
  count: (n: number) => `${n} 条`,
}

function node(key: string, kind: string, anchorSeq: number, turn?: number): DriverNode {
  return { kind, anchorSeq, location: turn === undefined ? { kind: 'session' } : { kind: 'turn', turn } }
}

interface SnapBuild {
  openState?: DriverSnapshot['openState']
  hasMore?: boolean
  loadingOlder?: boolean
  turns?: Array<[number, boolean, boolean]>
  order?: readonly string[]
  nodes?: Array<[key: string, kind: string, seq: number, turn?: number]>
}

function snap(build: SnapBuild): DriverSnapshot {
  const turns = new Map<number, { start?: unknown; end?: unknown }>()
  for (const [n, startLoaded, endLoaded] of build.turns ?? []) {
    turns.set(n, { start: startLoaded ? {} : undefined, end: endLoaded ? {} : undefined })
  }
  const store = new Map<string, DriverNode>()
  for (const [key, kind, seq, turn] of build.nodes ?? []) store.set(key, node(key, kind, seq, turn))
  return {
    openState: build.openState ?? 'open',
    hasMore: build.hasMore ?? false,
    loadingOlder: build.loadingOlder ?? false,
    turns,
    order: build.order ?? [...store.keys()],
    nodes: { get: (key: string) => store.get(key) },
  }
}

function row(key: string, kind: string): HTMLElement {
  const el = document.createElement('div')
  el.dataset.chatFlowKey = key
  el.dataset.chatFlowKind = kind
  return el
}

function flowContainer(rows: Array<[key: string, kind: string]>): HTMLElement {
  const container = document.createElement('div')
  container.dataset.chatFlow = ''
  for (const [key, kind] of rows) container.appendChild(row(key, kind))
  return container
}

function fakeSource() {
  let handle: FoldSessionHandle | null = null
  const listeners = new Set<() => void>()
  return {
    source: {
      current: () => handle,
      subscribe: (fn: () => void) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    } as FoldSessionSource,
    set(handle_: FoldSessionHandle | null) {
      handle = handle_
      for (const fn of [...listeners]) fn()
    },
    notify() {
      for (const fn of [...listeners]) fn()
    },
  }
}

function fakeHandle(sessionId: string, snapshot: () => DriverSnapshot | null, onLoad?: () => void): FoldSessionHandle {
  return {
    sessionId,
    snapshot,
    loadOlder: vi.fn(async () => {
      onLoad?.()
    }),
  }
}

describe('windowFromSnapshot', () => {
  it('projects the snapshot into the fold window (turn coordinates mapped, floating nodes ignored)', () => {
    const s = snap({
      turns: [[1, true, true]],
      nodes: [
        ['u1', 'user', 10, 1],
        ['a1', 'assistant-step', 20, 1],
        ['ctx1', 'context', 5], // no turn
      ],
    })
    const w = windowFromSnapshot(s)
    expect(w).not.toBeNull()
    expect(w?.turns.get(1)).toEqual({ turn: 1, startLoaded: true, endLoaded: true })
    expect(w?.nodes.map(n => [n.key, n.turn])).toEqual([['u1', 1], ['a1', 1], ['ctx1', undefined]])
    expect(w?.hasMore).toBe(false)
  })

  it('returns null while the session is not open', () => {
    expect(windowFromSnapshot(snap({ openState: 'loading' }))).toBeNull()
    expect(windowFromSnapshot(snap({ openState: 'cold' }))).toBeNull()
  })
})

describe('createFoldDriver', () => {
  let containers: HTMLElement[]
  let source: ReturnType<typeof fakeSource>

  beforeEach(() => {
    containers = [
      flowContainer([
        ['u1', 'user'],
        ['a1', 'assistant-step'],
        ['t1', 'tool-result'],
        ['a2', 'assistant-step'],
        ['tail', 'turn-tail'],
      ]),
    ]
    document.body.replaceChildren(containers[0])
    source = fakeSource()
  })

  it('folds the current session into the DOM on start', () => {
    const snapshot = () => snap({
      turns: [[1, true, true]],
      nodes: [
        ['u1', 'user', 10, 1],
        ['a1', 'assistant-step', 20, 1],
        ['t1', 'tool-result', 30, 1],
        ['a2', 'assistant-step', 40, 1],
        ['tail', 'turn-tail', 50, 1],
      ],
    })
    source.set(fakeHandle('s1', snapshot))
    const driver = createFoldDriver(source.source, { containers: () => containers, copy: COPY })
    const dispose = driver.start()
    expect(containers[0].querySelectorAll('[data-dsh-fold-header]').length).toBe(1)
    expect(containers[0].querySelectorAll('[data-dsh-fold-row]').length).toBe(2)
    expect(containers[0].querySelector('[data-dsh-fold-turn="1"]')?.nextElementSibling?.getAttribute('data-chat-flow-key')).toBe('a2')
    dispose()
  })

  it('cleans the flow when the session disappears', () => {
    const snapshot = () => snap({
      turns: [[1, true, true]],
      nodes: [['u1', 'user', 10, 1], ['a1', 'assistant-step', 20, 1]],
    })
    source.set(fakeHandle('s1', snapshot))
    const driver = createFoldDriver(source.source, { containers: () => containers, copy: COPY })
    driver.start()
    expect(containers[0].querySelectorAll('[data-dsh-fold-header]').length).toBe(1)
    source.set(null)
    expect(containers[0].querySelectorAll('[data-dsh-fold-header]').length).toBe(0)
    expect(containers[0].querySelectorAll('[data-dsh-fold-row]').length).toBe(0)
  })

  it('auto-loads older history once for a page-split closed turn, then folds it once the head arrives', async () => {
    let startLoaded = false
    const snapshot = () => snap({
      turns: [[1, startLoaded, true]],
      nodes: startLoaded
        ? [['u1', 'user', 10, 1], ['a1', 'assistant-step', 20, 1], ['a2', 'assistant-step', 40, 1]]
        : [['a1', 'assistant-step', 20, 1], ['a2', 'assistant-step', 40, 1]],
      hasMore: true,
    })
    const handle = fakeHandle('s1', snapshot, () => {
      startLoaded = true
      source.notify() // simulate the snapshot updating after the load
    })
    source.set(handle)
    const driver = createFoldDriver(source.source, { containers: () => containers, copy: COPY })
    driver.start()
    expect(handle.loadOlder).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(containers[0].querySelectorAll('[data-dsh-fold-header]').length).toBe(1)
    })
    expect(handle.loadOlder).toHaveBeenCalledTimes(1) // loaded only until whole
  })

  it('caps the automatic completion loads', async () => {
    const snapshot = () => snap({
      turns: [[1, false, true]],
      nodes: [['a1', 'assistant-step', 20, 1], ['a2', 'assistant-step', 40, 1]],
      hasMore: true,
    })
    const handle = fakeHandle('s1', snapshot)
    source.set(handle)
    const driver = createFoldDriver(source.source, { containers: () => containers, copy: COPY, maxAutoPages: 2 })
    driver.start()
    // Each load settles → the driver re-plans; loadingOlder stays false in the
    // fake so each pass issues another attempt until the cap stops it.
    await vi.waitFor(() => {
      expect(containers[0].querySelectorAll('[data-dsh-fold-header]').length).toBe(0)
    })
    expect((handle.loadOlder as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2)
    expect((handle.loadOlder as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
  })

  it('toggles a fold open, and the state survives re-runs', () => {
    const snapshot = () => snap({
      turns: [[1, true, true]],
      nodes: [
        ['u1', 'user', 10, 1],
        ['a1', 'assistant-step', 20, 1],
        ['t1', 'tool-result', 30, 1],
        ['a2', 'assistant-step', 40, 1],
      ],
    })
    source.set(fakeHandle('s1', snapshot))
    const driver = createFoldDriver(source.source, { containers: () => containers, copy: COPY })
    driver.start()
    driver.toggle(1)
    expect(containers[0].querySelector('[data-dsh-fold-turn="1"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(containers[0].querySelector('[data-chat-flow-key="a1"]')?.getAttribute('data-dsh-fold-expanded')).toBe('true')
    driver.run() // re-plan keeps the user's expansion
    expect(containers[0].querySelector('[data-dsh-fold-turn="1"]')?.getAttribute('aria-expanded')).toBe('true')
    driver.toggle(1) // collapse again
    expect(containers[0].querySelector('[data-dsh-fold-turn="1"]')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('resets expansion when the session changes', () => {
    const snapshotA = () => snap({
      turns: [[1, true, true]],
      nodes: [['u1', 'user', 10, 1], ['a1', 'assistant-step', 20, 1]],
    })
    source.set(fakeHandle('s1', snapshotA))
    const driver = createFoldDriver(source.source, { containers: () => containers, copy: COPY })
    driver.start()
    driver.toggle(1)
    expect(containers[0].querySelector('[data-dsh-fold-turn="1"]')?.getAttribute('aria-expanded')).toBe('true')
    source.set(fakeHandle('s2', snapshotA))
    expect(containers[0].querySelector('[data-dsh-fold-turn="1"]')?.getAttribute('aria-expanded')).toBe('false')
  })
})