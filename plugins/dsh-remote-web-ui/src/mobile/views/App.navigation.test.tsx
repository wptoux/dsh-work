// @vitest-environment jsdom
/**
 * Mobile navigation + browser history: forward moves push a history entry
 * per level, so the hardware/system back (popstate) walks up one level at
 * a time instead of leaving the /m page, and the header back button rides
 * the same history to stay in sync.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from './App.tsx'

const api = vi.hoisted(() => ({
  fetchMobilePreferences: vi.fn(),
  history: vi.fn(),
  listSessions: vi.fn(),
  listWorkspaces: vi.fn(),
  prompt: vi.fn(),
}))

const nav = vi.hoisted(() => ({
  workspace: { workspaceId: 'w1', title: '工作区一', path: '/w1', sessionIds: [] as string[] },
  session: { sessionId: 's1', title: '会话一', updatedAt: 0, running: false, blank: false },
}))

vi.mock('../api.ts', () => api)
vi.mock('../mux.ts', () => ({
  MuxClient: class {
    start(): void {}
    stop(): void {}
    observe(): void {}
  },
}))

// Interactive stand-ins: each wired to the props PairedApp passes down.
vi.mock('./WorkspaceView.tsx', () => ({
  WorkspaceView: ({ onPick }: { onPick(workspace: unknown): void }) => (
    <button type="button" onClick={() => { onPick(nav.workspace) }}>open-workspace</button>
  ),
}))
vi.mock('./SessionListView.tsx', () => ({
  SessionListView: ({ workspace, onBack, onPick }: { workspace: { title: string }, onBack(): void, onPick(session: unknown): void }) => (
    <div>
      <span>sessions:{workspace.title}</span>
      <button type="button" onClick={() => { onPick(nav.session) }}>open-chat</button>
      <button type="button" onClick={onBack}>back-button</button>
    </div>
  ),
}))
vi.mock('./ChatView.tsx', () => ({
  ChatView: ({ onBack }: { onBack(): void }) => (
    <div>
      <span>chat-ready</span>
      <button type="button" onClick={onBack}>back-button</button>
    </div>
  ),
}))

import { RpcTransportError } from '../rpc.ts'

/** Simulate the browser's back/forward navigation to one history entry. */
function popTo(state: unknown): void {
  window.dispatchEvent(new PopStateEvent('popstate', { state }))
}

beforeEach(() => {
  // Start each test from a single, marker-free entry.
  window.history.replaceState(null, '')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.history.replaceState(null, '')
})

describe('mobile history navigation', () => {
  it('pushes one entry per level and steps back one level per popstate', async () => {
    api.fetchMobilePreferences.mockResolvedValue({ mobileEnterToSend: true })
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'open-workspace' })).toBeDefined())

    // workspaces → sessions → chat, each forward move pushing a marker.
    fireEvent.click(screen.getByRole('button', { name: 'open-workspace' }))
    expect(await screen.findByText('sessions:工作区一')).toBeTruthy()
    expect(window.history.state).toEqual({ dshMobile: 1 })

    fireEvent.click(screen.getByRole('button', { name: 'open-chat' }))
    expect(await screen.findByText('chat-ready')).toBeTruthy()
    expect(window.history.state).toEqual({ dshMobile: 2 })

    // Hardware back from the chat: one level up to the session list, with
    // the opened workspace's payload restored.
    popTo({ dshMobile: 1 })
    expect(await screen.findByText('sessions:工作区一')).toBeTruthy()
    expect(screen.queryByText('chat-ready')).toBeNull()

    // Hardware back again: back to the workspaces root (the marker-free
    // entry — the browser would leave the page on a further back).
    popTo(null)
    expect(await screen.findByRole('button', { name: 'open-workspace' })).toBeDefined()
    expect(screen.queryByText('chat-ready')).toBeNull()
  })

  it('routes the header back button through window.history.back', async () => {
    api.fetchMobilePreferences.mockResolvedValue({ mobileEnterToSend: true })
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'open-workspace' })).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'open-workspace' }))
    fireEvent.click(await screen.findByRole('button', { name: 'open-chat' }))
    await screen.findByText('chat-ready')

    fireEvent.click(screen.getByRole('button', { name: 'back-button' }))
    expect(backSpy).toHaveBeenCalledTimes(1)

    // The popstate side effect performs the actual level-up.
    popTo({ dshMobile: 1 })
    expect(await screen.findByText('sessions:工作区一')).toBeTruthy()
    backSpy.mockRestore()
  })

  it('keeps the pairing gate independent of the history wiring', async () => {
    api.fetchMobilePreferences.mockRejectedValue(new RpcTransportError('HTTP 403'))
    render(<App initialPairError="配对链接已被使用。" />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('配对链接已被使用。'))
    expect(screen.queryByRole('button', { name: 'open-workspace' })).toBeNull()
  })
})