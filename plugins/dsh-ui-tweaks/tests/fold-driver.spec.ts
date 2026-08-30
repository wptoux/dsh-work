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
  pinnedAtBottom,
  restoreElementPosition,
  restoreHeaderPosition,
  windowFromSnapshot,
  type DriverNode,
  type DriverSnapshot,
  type FoldSessionHandle,
  type FoldSessionSource,
} from '../src/client/fold-driver'
import { formatDuration, type FoldCopy } from '../src/client/fold-dom'

/** @vitest-environment jsdom */
const COPY: FoldCopy = {
  header: () => '已处理',
  count: (n: number) => `${n} 条`,
  duration: formatDuration,
}

function node(key: string, kind: string, anchorSeq: number, turn?: number): DriverNode {
  return { kind, anchorSeq, location: turn === undefined ? { kind: 'session' } : { kind: 'turn', turn } }
}

interface SnapBuild {
  openState?: DriverSnapshot['openState']
  hasMore?: boolean
  loadingOlder?: boolean
  /** [turn, startLoaded, endLoaded, startTime?, endTime?] — times default to 1000/2000 when loaded. */
  turns?: Array<[number, boolean, boolean, startTime?: number, endTime?: number]>
  order?: readonly string[]
  nodes?: Array<[key: string, kind: string, seq: number, turn?: number]>
}

function snap(build: SnapBuild): DriverSnapshot {
  const turns = new Map<number, { startTime?: number; endTime?: number }>()
  for (const [n, startLoaded, endLoaded, startTime, endTime] of build.turns ?? []) {
    turns.set(n, {
      startTime: startLoaded ? startTime ?? 1000 : undefined,
      endTime: endLoaded ? endTime ?? 2000 : undefined,
    })
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

/** Stub getBoundingClientRect with a live getter so tests can move an element between reads. */
function stubRect(el: HTMLElement, get: () => { top: number; bottom: number; height: number }): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => {
      const { top, bottom, height } = get()
      return {
        top, bottom, height,
        left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}),
      } as DOMRect
    },
  })
}

/** A scrollport + flow with stubbed geometry: client 500, content 1200, viewport 0..500. */
function stubbedScroller(rows: Array<[key: string, kind: string]>): { scroller: HTMLElement; flow: HTMLElement } {
  const scroller = document.createElement('div')
  scroller.dataset.conversationScroll = ''
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1200 })
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 500 })
  scroller.scrollTop = 400 // mid-view: 1200-400-500 = 300 > 24 → not pinned
  const flow = document.createElement('div')
  flow.dataset.chatFlow = ''
  for (const [key, kind] of rows) {
    const el = document.createElement('div')
    el.dataset.chatFlowKey = key
    el.dataset.chatFlowKind = kind
    el.dataset.chatAnchorKey = key
    flow.appendChild(el)
  }
  scroller.appendChild(flow)
  document.body.replaceChildren(scroller)
  stubRect(scroller, () => ({ top: 0, bottom: 500, height: 500 }))
  return { scroller, flow }
}

/** Resolve after the driver's double-rAF restore window has run. */
function settleFrames(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 20)
      })
    })
  })
}

const CLOSED_SNAP = (): DriverSnapshot => snap({
  openState: 'open',
  turns: [[1, true, true]],
  nodes: [
    ['u1', 'user', 10, 1],
    ['a1', 'assistant-step', 20, 1],
    ['t1', 'tool-result', 30, 1],
    ['a2', 'assistant-step', 40, 1],
    ['tail', 'turn-tail', 50, 1],
  ],
})

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
    expect(w?.turns.get(1)).toEqual({ turn: 1, startLoaded: true, endLoaded: true, durationMs: 1000 })
    expect(w?.nodes.map(n => [n.key, n.turn])).toEqual([['u1', 1], ['a1', 1], ['ctx1', undefined]])
    expect(w?.hasMore).toBe(false)
  })

  it('returns null while the session is not open', () => {
    expect(windowFromSnapshot(snap({ openState: 'loading' }))).toBeNull()
    expect(windowFromSnapshot(snap({ openState: 'cold' }))).toBeNull()
  })

  it('derives the turn duration from the boundary timestamps', () => {
    const s = snap({
      turns: [[1, true, true, 500_000, 696_000]],
      nodes: [['u1', 'user', 10, 1], ['a1', 'assistant-step', 20, 1]],
    })
    const w = windowFromSnapshot(s)
    expect(w?.turns.get(1)).toMatchObject({ startLoaded: true, endLoaded: true, durationMs: 196_000 })
  })

  it('leaves the duration undefined while either boundary timestamp is missing', () => {
    const open = windowFromSnapshot(snap({
      turns: [[1, true, false, 500_000]],
      nodes: [],
    }))
    expect(open?.turns.get(1)?.durationMs).toBeUndefined()
    const split = windowFromSnapshot(snap({
      turns: [[1, false, true, undefined, 696_000]],
      nodes: [],
    }))
    expect(split?.turns.get(1)?.durationMs).toBeUndefined()
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
    expect(containers[0].querySelector('[data-dsh-fold-turn="1"]')?.nextElementSibling?.getAttribute('data-chat-flow-key')).toBe('a1')
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

  it('keeps the fold header as the first row of its block through a toggle', () => {
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
    driver.start()
    const before = containers[0].querySelector('[data-dsh-fold-turn="1"]')?.nextElementSibling?.getAttribute('data-chat-flow-key')
    driver.toggle(1) // expand — header stays at the top, messages expand below
    const after = containers[0].querySelector('[data-dsh-fold-turn="1"]')?.nextElementSibling?.getAttribute('data-chat-flow-key')
    driver.toggle(1) // collapse
    const collapsed = containers[0].querySelector('[data-dsh-fold-turn="1"]')?.nextElementSibling?.getAttribute('data-chat-flow-key')
    expect(before).toBe('a1')
    expect(after).toBe('a1')
    expect(collapsed).toBe('a1')
  })

  it('restoreHeaderPosition returns the header to its exact pre-toggle viewport top', () => {
    const scroller = document.createElement('div')
    scroller.dataset.conversationScroll = ''
    const flow = flowContainer([['u1', 'user']])
    scroller.appendChild(flow)
    document.body.replaceChildren(scroller)
    const header = document.createElement('button')
    header.setAttribute('data-dsh-fold-header', '')
    flow.appendChild(header)
    const rect = (top: number): DOMRect => ({
      top, bottom: top + 32, left: 0, right: 100, width: 100, height: 32, x: 0, y: top, toJSON: () => ({}),
    } as DOMRect)
    // The at-bottom follow pushed the header 200px up (was 500, now 300).
    Object.defineProperty(header, 'getBoundingClientRect', { configurable: true, value: () => rect(300) })
    scroller.scrollTop = 400
    expect(restoreHeaderPosition(header, 500)).toBe(true)
    expect(scroller.scrollTop).toBe(200) // scroll up by the 200px shift
    // Already at the captured position → no scroll.
    Object.defineProperty(header, 'getBoundingClientRect', { configurable: true, value: () => rect(500) })
    expect(restoreHeaderPosition(header, 500)).toBe(false)
    expect(scroller.scrollTop).toBe(200)
  })

  it('restoreElementPosition works on any element (header alias shares the math)', () => {
    const scroller = document.createElement('div')
    scroller.dataset.conversationScroll = ''
    const flow = flowContainer([['u1', 'user']])
    scroller.appendChild(flow)
    document.body.replaceChildren(scroller)
    const row = flow.firstElementChild as HTMLElement
    stubRect(row, () => ({ top: 600, bottom: 700, height: 100 }))
    scroller.scrollTop = 400
    expect(restoreElementPosition(row, 500)).toBe(true) // 600-500 → +100
    expect(scroller.scrollTop).toBe(500)
  })

  it('pinnedAtBottom mirrors the host follow threshold', () => {
    const scroller = document.createElement('div')
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 400 })
    scroller.scrollTop = 600 // 1000-600-400 = 0
    expect(pinnedAtBottom(scroller)).toBe(true)
    scroller.scrollTop = 580 // 20px off the floor → still within the 24px threshold
    expect(pinnedAtBottom(scroller)).toBe(true)
    scroller.scrollTop = 500 // 100px off the floor
    expect(pinnedAtBottom(scroller)).toBe(false)
  })

  it('auto re-apply folds a completed turn above the reader and restores the visible anchor row', async () => {
    const { scroller, flow } = stubbedScroller([
      ['u1', 'user'],
      ['a1', 'assistant-step'],
      ['t1', 'tool-result'],
      ['a2', 'assistant-step'],
      ['tail', 'turn-tail'],
    ])
    let closed = false
    const snapshot = () => (closed ? CLOSED_SNAP() : snap({
      openState: 'open',
      turns: [[1, true, false]], // streaming — never folded
      nodes: [
        ['u1', 'user', 10, 1],
        ['a1', 'assistant-step', 20, 1],
        ['t1', 'tool-result', 30, 1],
        ['a2', 'assistant-step', 40, 1],
        ['tail', 'turn-tail', 50, 1],
      ],
    }))
    source.set(fakeHandle('s1', snapshot))
    const driver = createFoldDriver(source.source, { containers: () => [flow], copy: COPY })
    driver.start()
    // Reader mid-view on the last reply ('a2'): give it the only in-viewport rect.
    let a2Top = 300
    stubRect(flow.querySelector('[data-chat-flow-key="a2"]') as HTMLElement, () => ({
      top: a2Top, bottom: a2Top + 100, height: 100,
    }))
    // 'tail' below the viewport, hidden rows (a1/t1) far above.
    stubRect(flow.querySelector('[data-chat-flow-key="tail"]') as HTMLElement, () => ({
      top: 900, bottom: 1000, height: 100,
    }))
    stubRect(flow.querySelector('[data-chat-flow-key="a1"]') as HTMLElement, () => ({
      top: 50, bottom: 150, height: 100,
    }))
    expect(scroller.scrollTop).toBe(400)
    // turn/end arrives late (weak network): the auto re-apply folds a1/t1,
    // which slides 'a2' up 100px — the driver must compensate.
    closed = true
    source.notify()
    a2Top = 200 // the fold's height change lands (simulated)
    await settleFrames()
    expect(scroller.scrollTop).toBe(300) // scrolled back so 'a2' sits at its captured top
    expect(flow.querySelectorAll('[data-dsh-fold-row]').length).toBe(2)
  })

  it('does not compensate auto re-applies while the reader is pinned at the bottom', async () => {
    const { scroller, flow } = stubbedScroller([
      ['u1', 'user'],
      ['a1', 'assistant-step'],
      ['t1', 'tool-result'],
      ['a2', 'assistant-step'],
      ['tail', 'turn-tail'],
    ])
    scroller.scrollTop = 700 // 1200-700-500 = 0 → pinned
    let closed = false
    const snapshot = () => (closed ? CLOSED_SNAP() : snap({
      openState: 'open',
      turns: [[1, true, false]],
      nodes: [
        ['u1', 'user', 10, 1],
        ['a1', 'assistant-step', 20, 1],
        ['t1', 'tool-result', 30, 1],
        ['a2', 'assistant-step', 40, 1],
        ['tail', 'turn-tail', 50, 1],
      ],
    }))
    source.set(fakeHandle('s1', snapshot))
    const driver = createFoldDriver(source.source, { containers: () => [flow], copy: COPY })
    driver.start()
    stubRect(flow.querySelector('[data-chat-flow-key="a2"]') as HTMLElement, () => ({
      top: 300, bottom: 400, height: 100,
    }))
    closed = true
    source.notify()
    await settleFrames()
    // Pinned readers stay pinned (the host follow owns the view); no scroll.
    expect(scroller.scrollTop).toBe(700)
  })

  it('manual toggle restores the clicked header after an at-bottom follow shift', async () => {
    const { scroller, flow } = stubbedScroller([
      ['u1', 'user'],
      ['a1', 'assistant-step'],
      ['t1', 'tool-result'],
      ['a2', 'assistant-step'],
      ['tail', 'turn-tail', ],
    ])
    source.set(fakeHandle('s1', CLOSED_SNAP))
    const driver = createFoldDriver(source.source, { containers: () => [flow], copy: COPY })
    driver.start()
    const header = flow.querySelector<HTMLElement>('[data-dsh-fold-turn="1"]')
    expect(header).not.toBeNull()
    let headerTop = 472
    stubRect(header as HTMLElement, () => ({ top: headerTop, bottom: headerTop + 28, height: 28 }))
    expect(scroller.scrollTop).toBe(400)
    // Expanding the fold regrows the column; the at-bottom follow shifts the
    // header 100px up (simulated AFTER the apply, before the restore window).
    driver.toggle(1)
    headerTop = 372
    await settleFrames()
    expect(scroller.scrollTop).toBe(300) // scrolled back up so the header returns to 472
  })

  it('never anchors a row the plan is about to hide (falls back to no compensation)', async () => {
    const { scroller, flow } = stubbedScroller([
      ['u1', 'user'],
      ['a1', 'assistant-step'],
      ['t1', 'tool-result'],
      ['a2', 'assistant-step'],
      ['tail', 'turn-tail'],
    ])
    source.set(fakeHandle('s1', CLOSED_SNAP))
    const driver = createFoldDriver(source.source, { containers: () => [flow], copy: COPY })
    driver.start()
    // Only 'a1' — a row the incoming fold hides — is in the viewport.
    stubRect(flow.querySelector('[data-chat-flow-key="a1"]') as HTMLElement, () => ({
      top: 100, bottom: 200, height: 100,
    }))
    expect(scroller.scrollTop).toBe(400)
    // Fold 'a1' under the reader's current spot (a second fold on turn 2
    // whose hidden set covers the in-viewport row).
    const snap2 = () => snap({
      openState: 'open',
      turns: [[1, true, true], [2, true, true]],
      nodes: [
        ['u1', 'user', 10, 1],
        ['a1', 'assistant-step', 20, 2],
        ['t1', 'tool-result', 30, 1],
        ['a2', 'assistant-step', 40, 2],
        ['tail', 'turn-tail', 50, 1],
      ],
    })
    source.set(fakeHandle('s2', snap2))
    driver.run()
    await settleFrames()
    // No in-viewport anchor survived the plan → nothing to restore, no scroll.
    expect(scroller.scrollTop).toBe(400)
  })

  it('fold-driven loadOlder arms a prepend anchor and restores the reader when the page lands', async () => {
    const { scroller, flow } = stubbedScroller([
      ['u1', 'user'],
      ['a1', 'assistant-step'],
      ['t1', 'tool-result'],
      ['a2', 'assistant-step'],
      ['tail', 'turn-tail'],
    ])
    // Closed but page-split turn: the head is outside the window, so the
    // driver pulls older history on its own (the host anchors ONLY button
    // clicks, so this is the un-stabilized path we must cover).
    const snapshot = () => snap({
      openState: 'open',
      turns: [[1, false, true]],
      hasMore: true,
      nodes: [
        ['u1', 'user', 10, 1],
        ['a1', 'assistant-step', 20, 1],
        ['t1', 'tool-result', 30, 1],
        ['a2', 'assistant-step', 40, 1],
        ['tail', 'turn-tail', 50, 1],
      ],
    })
    source.set(fakeHandle('s1', snapshot))
    // Stub the reader's row BEFORE starting so the arming pass sees it.
    let a2Top = 300
    stubRect(flow.querySelector('[data-chat-flow-key="a2"]') as HTMLElement, () => ({
      top: a2Top, bottom: a2Top + 100, height: 100,
    }))
    const driver = createFoldDriver(source.source, { containers: () => [flow], copy: COPY, maxAutoPages: 1 })
    driver.start()
    expect(scroller.scrollTop).toBe(400)
    // The fetched page lands in the DOM (React prepends it above u1) and the
    // reader's row slides 50px down with it.
    const u0 = document.createElement('div')
    u0.dataset.chatFlowKey = 'u0'
    flow.insertBefore(u0, flow.firstElementChild)
    a2Top = 350
    driver.run() // the container MutationObserver-driven pass
    await settleFrames()
    expect(scroller.scrollTop).toBe(450) // prepend shift cancelled, view stable
  })

  it('drops the prepend anchor when the reader scrolls while the page is loading', async () => {
    const { scroller, flow } = stubbedScroller([
      ['u1', 'user'],
      ['a1', 'assistant-step'],
      ['t1', 'tool-result'],
      ['a2', 'assistant-step'],
      ['tail', 'turn-tail'],
    ])
    const snapshot = () => snap({
      openState: 'open',
      turns: [[1, false, true]],
      hasMore: true,
      nodes: [
        ['u1', 'user', 10, 1],
        ['a1', 'assistant-step', 20, 1],
        ['t1', 'tool-result', 30, 1],
        ['a2', 'assistant-step', 40, 1],
        ['tail', 'turn-tail', 50, 1],
      ],
    })
    source.set(fakeHandle('s1', snapshot))
    stubRect(flow.querySelector('[data-chat-flow-key="a2"]') as HTMLElement, () => ({
      top: 300, bottom: 400, height: 100,
    }))
    const driver = createFoldDriver(source.source, { containers: () => [flow], copy: COPY, maxAutoPages: 1 })
    driver.start()
    // Reader scrolls mid-flight → the pending anchor is discarded.
    scroller.dispatchEvent(new Event('scroll'))
    const u0 = document.createElement('div')
    u0.dataset.chatFlowKey = 'u0'
    flow.insertBefore(u0, flow.firstElementChild)
    driver.run()
    await settleFrames()
    expect(scroller.scrollTop).toBe(400) // no anchoring; the reader owns the view
  })

  it('does not arm a prepend anchor while the reader is pinned at the bottom', async () => {
    const { scroller, flow } = stubbedScroller([
      ['u1', 'user'],
      ['a1', 'assistant-step'],
      ['t1', 'tool-result'],
      ['a2', 'assistant-step'],
      ['tail', 'turn-tail'],
    ])
    scroller.scrollTop = 700 // 1200-700-500 = 0 → pinned
    const snapshot = () => snap({
      openState: 'open',
      turns: [[1, false, true]],
      hasMore: true,
      nodes: [
        ['u1', 'user', 10, 1],
        ['a1', 'assistant-step', 20, 1],
        ['t1', 'tool-result', 30, 1],
        ['a2', 'assistant-step', 40, 1],
        ['tail', 'turn-tail', 50, 1],
      ],
    })
    source.set(fakeHandle('s1', snapshot))
    stubRect(flow.querySelector('[data-chat-flow-key="a2"]') as HTMLElement, () => ({
      top: 300, bottom: 400, height: 100,
    }))
    const driver = createFoldDriver(source.source, { containers: () => [flow], copy: COPY, maxAutoPages: 1 })
    driver.start()
    const u0 = document.createElement('div')
    u0.dataset.chatFlowKey = 'u0'
    flow.insertBefore(u0, flow.firstElementChild)
    driver.run()
    await settleFrames()
    // Pinned readers keep the follow-owned view; no scroll to compensate.
    expect(scroller.scrollTop).toBe(700)
  })
})