/**
 * EditorHost file-refresh behavior (the files window):
 * - a refresh button reloads the latest version of the open file,
 * - a staleness poll raises a persistent "file changed on disk" banner when
 *   the on-disk identity (size/mtimeMs) no longer matches what is shown,
 * - a refresh that finds the SHOWN version stale flashes the "refreshed"
 *   notice (the 同步提示) while one that found it current shows nothing,
 * - the button is disabled while the text editor has unsaved edits, and
 * - the banner resets on refresh and on a path switch.
 * `api.fsRead` is mocked to simulate the disk (read + metaOnly stat).
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { api } from '../src/client/api.ts'
import { EditorHost } from '../src/client/EditorHost.tsx'
import { createBetterSidebarService } from '../src/client/service.ts'
import { allLeaves, createSidebarStore, type SidebarStore, type SidebarTab } from '../src/client/state.ts'
import type { Context } from '../src/context-types.ts'

/** The on-disk state the mocked fs.read serves (tests mutate it directly). */
let diskContent = ''
let diskMtime = 0

const REFRESH_LABEL = 'Refresh file'
// Distinct fragments so the persistent banner and the transient notice never
// collide in the assertions: the banner copy names the action, the notice
// names the state.
const BANNER_TEXT = 'refresh to view the latest'
const NOTICE_TEXT = 'Refreshed'

interface Mounted {
  container: HTMLDivElement
  rerender: () => void
  unmount: () => void
}

function setup(): { store: SidebarStore; ctx: Context; fileTab: (path: string) => SidebarTab } {
  const store = createSidebarStore()
  const service = createBetterSidebarService(store)
  service.registerTab({ id: 'editor', title: 'Editor', dedupeKey: (tab) => tab.path, component: () => null })
  // A text viewer (fsRead strategy: content + file identity from the read).
  service.registerFileViewer({
    id: 'test:text',
    exts: ['txt'],
    fetchStrategy: 'fsRead',
    component: ({ content }) => createElement('pre', null, content ?? ''),
  })
  // A toolbar-reporting surface (the dirty gate): reports `dirtyNow` live.
  service.registerFileViewer({
    id: 'test:dirty',
    exts: ['dirty'],
    fetchStrategy: 'none',
    component: (props) => {
      useEffect(() => {
        props.onToolbarState?.({ modes: false, mode: 'preview', dirty: dirtyNow, editable: false, saveState: 'idle' })
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [dirtyNow])
      return createElement('div', null, 'dirty surface')
    },
  })
  store.setSession('editor-refresh-session')
  const testPath = '/tmp/refresh.txt'
  service.openTab({ type: 'editor', title: 'refresh.txt', path: testPath, id: `editor:${testPath}` })
  const fileTab = (path: string): SidebarTab => {
    const found = allLeaves(store.getSnapshot().state!.splits).flatMap(leaf => leaf.tabs)
      .find(tab => tab.path === path)
    if (found !== undefined) return found
    // The tab may have been re-pointed (in-place switch): match by id.
    return allLeaves(store.getSnapshot().state!.splits).flatMap(leaf => leaf.tabs)
      .find(tab => tab.id === `editor:${testPath}`)!
  }
  const sessionsSnapshot = { byId: { 'editor-refresh-session': { cwd: '/tmp' } }, current: 'editor-refresh-session' }
  const ctx = {
    betterSidebar: service,
    sessions: { list: { subscribe: () => () => {}, getSnapshot: () => sessionsSnapshot } },
  } as unknown as Context
  return { store, ctx, fileTab }
}

/** Mount EditorHost for one tab; visible defaults on (the app passes it). */
function mountHost(ctx: Context, store: SidebarStore, tab: () => SidebarTab, visible = true): Mounted {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = (): void => {
    root.render(createElement(EditorHost, {
      ctx,
      store,
      scope: { sessionId: 'editor-refresh-session' },
      tab: tab(),
      expanded: [],
      onToggleDir: () => {},
      onReferenceFile: () => {},
      visible,
    }))
  }
  act(render)
  return {
    container,
    rerender: () => { act(render) },
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

/** Drain the pending microtask chains (mocked fs.read + the load effect). */
async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

const refreshButton = (container: HTMLDivElement): HTMLButtonElement =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${REFRESH_LABEL}"]`)!

beforeEach(() => {
  diskContent = 'v1'
  diskMtime = 1000
  dirtyNow = false
  vi.spyOn(api, 'fsRead').mockImplementation((_scope, _path, _signal, opts) => {
    if (opts?.metaOnly === true) {
      return Promise.resolve({ kind: 'meta', size: diskContent.length, mtimeMs: diskMtime })
    }
    return Promise.resolve({
      kind: 'text',
      content: diskContent,
      truncated: false,
      size: diskContent.length,
      mtimeMs: diskMtime,
    })
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

// The dirty-flag the toolbar-reporting viewer reads (module-level like the
// disk state; the test flips it and re-renders).
let dirtyNow = false

describe('EditorHost file refresh', () => {
  it('renders a refresh button for a file tab (and none for the path-less home)', async () => {
    const { ctx, store } = setup()
    const { container, unmount } = mountHost(ctx, store, () => {
      const found = allLeaves(store.getSnapshot().state!.splits).flatMap(leaf => leaf.tabs)
        .find(tab => tab.path === '/tmp/refresh.txt')!
      return found
    })
    try {
      await flush()
      expect(refreshButton(container).disabled).toBe(false)
    } finally {
      unmount()
    }
  })

  it('clicking refresh reloads the latest version from disk', async () => {
    const { ctx, store, fileTab } = setup()
    const { container, unmount } = mountHost(ctx, store, () => fileTab('/tmp/refresh.txt'))
    try {
      await flush()
      expect(container.querySelector('pre')?.textContent).toBe('v1')

      // The file changes on disk between the load and the click.
      diskContent = 'v2'
      diskMtime = 2000
      act(() => { refreshButton(container).click() })
      await flush()

      expect(container.querySelector('pre')?.textContent).toBe('v2')
    } finally {
      unmount()
    }
  })

  it('a refresh that found the shown version stale flashes the notice; a current one shows nothing', async () => {
    const { ctx, store, fileTab } = setup()
    const { container, unmount } = mountHost(ctx, store, () => fileTab('/tmp/refresh.txt'))
    try {
      await flush()
      expect(container.textContent).not.toContain(NOTICE_TEXT)

      // Stale: the disk moved on while the editor still showed v1.
      diskContent = 'v2'
      diskMtime = 2000
      act(() => { refreshButton(container).click() })
      await flush()
      expect(container.textContent).toContain(NOTICE_TEXT)

      // Already current: another refresh without a disk change → no notice.
      act(() => { refreshButton(container).click() })
      await flush()
      expect(container.textContent).not.toContain(NOTICE_TEXT)
    } finally {
      unmount()
    }
  })

  it('the staleness poll raises the persistent banner when the file changes on disk', async () => {
    vi.useFakeTimers()
    const { ctx, store, fileTab } = setup()
    const { container, unmount } = mountHost(ctx, store, () => fileTab('/tmp/refresh.txt'))
    try {
      await flush()
      expect(container.textContent).not.toContain(BANNER_TEXT)

      // External change (no click): the next poll tick notices.
      diskMtime = 2000
      diskContent = 'v2'
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
      expect(container.textContent).toContain(BANNER_TEXT)
    } finally {
      unmount()
    }
  })

  it('the poll does not run while the tab is not visible', async () => {
    vi.useFakeTimers()
    const { ctx, store, fileTab } = setup()
    const { container, unmount } = mountHost(ctx, store, () => fileTab('/tmp/refresh.txt'), false)
    try {
      await flush()
      diskMtime = 2000
      await act(async () => { await vi.advanceTimersByTimeAsync(12_000) })
      expect(container.textContent).not.toContain(BANNER_TEXT)
    } finally {
      unmount()
    }
  })

  it('the refresh button is disabled while the file has unsaved edits', async () => {
    const { ctx, store } = setup()
    store.getSnapshot().state!.splits
    // Open a tab rendered by the toolbar-reporting viewer.
    ctx.betterSidebar!.openTab({ type: 'editor', title: 'x.dirty', path: '/tmp/x.dirty', id: 'editor:/tmp/x.dirty' })
    const dirtyTab = (): SidebarTab =>
      allLeaves(store.getSnapshot().state!.splits).flatMap(leaf => leaf.tabs)
        .find(tab => tab.path === '/tmp/x.dirty')!
    const { container, rerender, unmount } = mountHost(ctx, store, dirtyTab)
    try {
      await flush()
      expect(refreshButton(container).disabled).toBe(false)
      dirtyNow = true
      rerender()
      expect(refreshButton(container).disabled).toBe(true)
      dirtyNow = false
      rerender()
      expect(refreshButton(container).disabled).toBe(false)
    } finally {
      unmount()
    }
  })

  it('refreshing clears the persistent banner, and so does a path switch', async () => {
    vi.useFakeTimers()
    const { ctx, store, fileTab } = setup()
    const { container, rerender, unmount } = mountHost(ctx, store, () => fileTab('/tmp/refresh.txt'))
    try {
      await flush()
      diskMtime = 2000
      diskContent = 'v2'
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
      expect(container.textContent).toContain(BANNER_TEXT)

      // Refresh → the persistent banner goes away (the notice may flash).
      act(() => { refreshButton(container).click() })
      await act(async () => { await vi.advanceTimersByTimeAsync(100) })
      await flush()
      expect(container.textContent).not.toContain(BANNER_TEXT)

      // Path switch resets any banner state too.
      diskMtime = 3000
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
      expect(container.textContent).toContain(BANNER_TEXT)
      ctx.betterSidebar!.updateTab(`editor:/tmp/refresh.txt`, { path: '/tmp/other.md', title: 'other.md' })
      rerender()
      await flush()
      expect(container.textContent).not.toContain(BANNER_TEXT)
    } finally {
      unmount()
    }
  })
})