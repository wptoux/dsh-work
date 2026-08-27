/**
 * Sidebar auto-activation contract on narrow (mobile) viewports: a new
 * background job or a newly spawned subagent must NEVER auto-open the panel
 * there — on mobile the panel IS a full-screen drawer, and popping it over
 * the conversation the user is reading is the exact behavior the mobile
 * breakpoint exists to avoid. Desktop behavior is untouched.
 *
 * Regression-guards the two auto-activation effects in Sidebar.tsx (the
 * job auto-open effect and the debounced subagent auto-open effect): the
 * narrow early-return must leave the store state completely untouched
 * (no panel toggle, no tab focus — "完全无动作"), and a viewport narrowed
 * while a subagent debounce is already armed must suppress its fire.
 *
 * Rendered with the REAL Sidebar shell + real store/service against a
 * controllable sessions-list feed (the repo's jsdom + React act pattern).
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// The act() environment flag (React 18.2 reads it before flushing effects).
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { Sidebar } from '../src/client/Sidebar.tsx'
import { allLeaves, createSidebarStore, type SidebarStore } from '../src/client/state.ts'
import { createBetterSidebarService, type BetterSidebarService } from '../src/client/service.ts'
import type { SidebarSessionList, SidebarSessionSummary } from '../src/context-types.ts'

/** jsdom has no WebSocket; the agent-terminals push effect constructs one on mount. */
class FakeWebSocket {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  close = (): void => {}
  constructor(_url: string) {}
}

/** The mobile breakpoint boundary (breakpoints.ts: NARROW_MAX_WIDTH = 768). */
const WIDE = 1024
const NARROW = 700

/** Force `window.innerWidth` (the narrow hook + the store seed both read it). */
function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

/** A subscribable sessions-list feed (mirror of the runtime list feed). */
class SessionsList {
  private snapshot: SidebarSessionList
  private readonly listeners = new Set<() => void>()
  constructor(snapshot: SidebarSessionList) {
    this.snapshot = snapshot
  }
  getSnapshot = (): SidebarSessionList => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  push(next: SidebarSessionList): void {
    this.snapshot = next
    for (const fn of [...this.listeners]) fn()
  }
}

interface Mounted {
  store: SidebarStore
  sessions: SessionsList
  unmount: () => void
}

/** Mount the real Sidebar shell with a controllable sessions feed. */
function mountSidebar(viewport: number, collapsed: boolean): Mounted {
  vi.stubGlobal('WebSocket', FakeWebSocket)
  setViewport(viewport)
  const container = document.createElement('div')
  document.body.append(container)
  const store = createSidebarStore()
  const service = createBetterSidebarService(store)
  // The auto-activation effects open the 'subagent' tab; openTab is a no-op
  // for an unregistered type, so register a cheap stand-in (the builtins are
  // not part of the test's fresh service instance).
  service.registerTab({
    id: 'subagent',
    title: 'Tasks',
    single: true,
    component: () => createElement('div', null, 'tasks'),
  })
  // openByDefault: true mirrors a user who wants the panel on desktop; the
  // narrow seed still collapses (the drawer never opens on first paint).
  store.setPrefs({ ...store.getPrefs(), openByDefault: true })
  store.setSession('s1')
  if (collapsed) {
    act(() => {
      store.reduce(s => (s.panelOpen ? { ...s, panelOpen: false } : s))
    })
  }
  // Stable snapshots (useSyncExternalStore loops on fresh objects per call).
  const localeSnapshot = { active: 'en' }
  const sessions = new SessionsList({
    current: 's1',
    // cwd present → api.sessionCwd is never called in these tests.
    byId: { s1: { id: 's1', cwd: '/tmp', displayTitle: 'Main' } },
  })
  const ctx = {
    locale: { subscribe: () => () => {}, getSnapshot: () => localeSnapshot },
    sessions: { list: sessions },
    betterSidebar: service,
  }
  const root: Root = createRoot(container)
  act(() => { root.render(createElement(Sidebar, { ctx: ctx as never, store })) })
  return {
    store,
    sessions,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

/** Whether a tab of the given type is open anywhere (either tree). */
function tabTypeOpen(store: SidebarStore, type: string): boolean {
  const state = store.getSnapshot().state
  if (state === undefined) return false
  return allLeaves(state.splits).concat(allLeaves(state.bottomSplits))
    .some(leaf => leaf.tabs.some(tab => tab.type === type))
}

/** A snapshot with one new background job for the current session. */
function withNewJob(sessionId: string, jobId: string): SidebarSessionList {
  return {
    current: sessionId,
    byId: { s1: { id: 's1', cwd: '/tmp', displayTitle: 'Main' } },
    jobsBySession: {
      [sessionId]: [{
        id: jobId,
        kind: 'bash',
        label: `run ${jobId}`,
        status: 'running',
        startedAt: 1_000,
      }],
    },
  }
}

/** A snapshot with one new direct subagent child under the current session. */
function withNewSubagent(sessionId: string, childId: string): SidebarSessionList {
  const parent = (): SidebarSessionSummary => ({ id: sessionId, cwd: '/tmp', displayTitle: 'Main' })
  return {
    current: sessionId,
    byId: {
      [sessionId]: parent(),
      [childId]: { id: childId, displayTitle: 'Child', origin: 'subagent', parentId: sessionId },
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setViewport(WIDE)
  document.body.innerHTML = ''
})

describe('job auto-activation on narrow viewports', () => {
  it('never auto-opens the panel for a new background job when the viewport is narrow', () => {
    const { store, sessions, unmount } = mountSidebar(NARROW, false)
    try {
      const before = store.getSnapshot().state!
      expect(before.panelOpen).toBe(false)

      // A new background job arrives (the auto-open trigger).
      act(() => { sessions.push(withNewJob('s1', 'bash-1')) })

      // 完全无动作: the drawer stays collapsed, no tab is focused, and the
      // store state was not touched at all.
      expect(store.getSnapshot().state!.panelOpen).toBe(false)
      expect(tabTypeOpen(store, 'subagent')).toBe(false)
      expect(store.getSnapshot().state).toBe(before)
    } finally {
      unmount()
    }
  })

  it('still auto-opens the panel and Jobs page on a wide viewport (desktop unchanged)', () => {
    const { store, sessions, unmount } = mountSidebar(WIDE, true)
    try {
      expect(store.getSnapshot().state!.panelOpen).toBe(false)

      act(() => { sessions.push(withNewJob('s1', 'bash-1')) })

      expect(store.getSnapshot().state!.panelOpen).toBe(true)
      expect(tabTypeOpen(store, 'subagent')).toBe(true)
    } finally {
      unmount()
    }
  })
})

describe('subagent auto-activation on narrow viewports', () => {
  it('never auto-opens the panel when a new subagent spawns on a narrow viewport', async () => {
    vi.useFakeTimers()
    const { store, sessions, unmount } = mountSidebar(NARROW, false)
    try {
      const before = store.getSnapshot().state!
      expect(before.panelOpen).toBe(false)

      // A new direct subagent spawns (the debounced auto-open trigger).
      act(() => { sessions.push(withNewSubagent('s1', 'child1')) })
      // Give the debounce window (500ms) and more: still nothing.
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })

      expect(store.getSnapshot().state!.panelOpen).toBe(false)
      expect(tabTypeOpen(store, 'subagent')).toBe(false)
      expect(store.getSnapshot().state).toBe(before)
    } finally {
      unmount()
    }
  })

  it('still auto-opens the panel and Tasks page after the debounce on a wide viewport', async () => {
    vi.useFakeTimers()
    const { store, sessions, unmount } = mountSidebar(WIDE, true)
    try {
      expect(store.getSnapshot().state!.panelOpen).toBe(false)

      act(() => { sessions.push(withNewSubagent('s1', 'child1')) })
      // The decision is debounced: nothing within the window…
      await act(async () => { await vi.advanceTimersByTimeAsync(499) })
      expect(store.getSnapshot().state!.panelOpen).toBe(false)

      // …and the panel pops once the debounce settles (desktop unchanged).
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(store.getSnapshot().state!.panelOpen).toBe(true)
      expect(tabTypeOpen(store, 'subagent')).toBe(true)
    } finally {
      unmount()
    }
  })

  it('a viewport narrowed while the debounce is armed suppresses the pending auto-open', async () => {
    vi.useFakeTimers()
    const { store, sessions, unmount } = mountSidebar(WIDE, true)
    try {
      expect(store.getSnapshot().state!.panelOpen).toBe(false)

      // A subagent spawns on desktop (the debounce is armed)…
      act(() => { sessions.push(withNewSubagent('s1', 'child1')) })
      // …but the window is resized to mobile BEFORE the 500ms window closes.
      act(() => {
        // Synchronous rAF: the narrow hook's resize listener re-measures
        // within the same act flush (fake timers may not control jsdom's rAF).
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
          callback(0)
          return 1
        })
        setViewport(NARROW)
        window.dispatchEvent(new Event('resize'))
      })
      // The debounce fires now — but the viewport is mobile: no drawer pop.
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })

      expect(store.getSnapshot().state!.panelOpen).toBe(false)
      expect(tabTypeOpen(store, 'subagent')).toBe(false)
    } finally {
      unmount()
    }
  })
})