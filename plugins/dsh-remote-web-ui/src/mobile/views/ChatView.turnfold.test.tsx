// @vitest-environment jsdom
/**
 * ChatView completed-turn fold: once a turn ends (turn/end), every
 * assistant message of that turn collapses behind a 已处理 header and
 * only the last reply stays visible; tapping the header expands the full
 * turn. Turns that are still running stream unfolded, and failed turns
 * fold too (the failure tag rides the visible last reply).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionModels } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'
import { ChatView } from './ChatView.tsx'
import { type SessionView } from './App.tsx'
import type { HistoryPage } from '../api.ts'
import type { WireEvent } from '../messages.ts'

vi.mock('../api.ts', () => ({
  fetchMobilePreferences: vi.fn(),
  models: vi.fn(),
  selectModel: vi.fn(),
  sendCommand: vi.fn(),
}))
vi.mock('./App.tsx', async importOriginal => {
  const actual = await importOriginal<typeof import('./App.tsx')>()
  return {
    ...actual,
    loadHistory: vi.fn(),
    prompt: vi.fn(async () => {}),
  }
})
import { fetchMobilePreferences, models } from '../api.ts'
import { loadHistory } from './App.tsx'

const loadHistoryMock = vi.mocked(loadHistory)
const fetchMobilePreferencesMock = vi.mocked(fetchMobilePreferences)
const modelsMock = vi.mocked(models)

const session: SessionView = {
  sessionId: 's-1',
  title: '测试会话',
  updatedAt: 1_700_000_000_000,
  running: false,
  blank: false,
}

/** Assemble one history entry wrapping a WireEvent (host history-page shape). */
function makeEntry(type: string, data: unknown, seq: number): { event: WireEvent } {
  return { event: { type, seq, time: seq * 1_000, data } }
}

/** Build a history page from loose wire events (the host union is strict). */
function historyPage(events: Array<{ event: WireEvent }>, extra: Record<string, unknown> = {}): HistoryPage {
  return { events: events as never, hasMore: false, ...extra } as HistoryPage
}

/** Minimal mux stand-in: captures the ChatView's frame listener for hand-off. */
class FakeMux {
  listeners = new Set<(frame: unknown) => void>()
  onFrame(listener: (frame: unknown) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  emit(frame: unknown): void {
    for (const listener of this.listeners) listener(frame)
  }
}

/** A completed turn: user prompt, an intermediate step with a tool call, then the final reply. */
function completedTurn(): Array<{ event: WireEvent }> {
  return [
    makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '帮我修改代码' }] }, 0),
    makeEntry('assistant/message', {
      turn: 0,
      step: 0,
      message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '我先查看文件结构' }] },
    }, 1),
    makeEntry('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' }, 2),
    makeEntry('assistant/message', {
      turn: 0,
      step: 1,
      message: { id: 'a-2', role: 'assistant', content: [{ type: 'text', text: '已完成修改' }] },
    }, 3),
    makeEntry('turn/end', { turn: 0, reason: { kind: 'success' } }, 4),
  ]
}

beforeEach(() => {
  fetchMobilePreferencesMock.mockResolvedValue({ mobileEnterToSend: true })
  modelsMock.mockResolvedValue({
    current: { provider: 'fx', model: 'fx-1' },
    routable: true,
    groups: [],
    failures: [],
  } satisfies SessionModels)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('ChatView completed-turn fold', () => {
  it('folds a completed turn behind 已处理 and shows only the last reply', async () => {
    loadHistoryMock.mockResolvedValue(historyPage(completedTurn()))
    render(<ChatView session={session} onBack={() => {}} />)

    await screen.findByText('帮我修改代码')
    // The turn ended: a 已处理 header exists, the final reply is visible,
    // and the intermediate message with its tool call is folded away.
    expect(screen.getByRole('button', { name: /已处理/ })).toBeTruthy()
    expect(screen.getByText('已完成修改')).toBeTruthy()
    expect(screen.queryByText('我先查看文件结构')).toBeNull()
    expect(screen.queryByRole('button', { name: /工具/ })).toBeNull()
  })

  it('expands the 已处理 block to reveal every message of the turn', async () => {
    loadHistoryMock.mockResolvedValue(historyPage(completedTurn()))
    render(<ChatView session={session} onBack={() => {}} />)

    await screen.findByText('已完成修改')
    const head = screen.getByRole('button', { name: /已处理/ })
    expect(head.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(head)
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(await screen.findByText('我先查看文件结构')).toBeTruthy()
    expect(screen.getByRole('button', { name: /工具/ })).toBeTruthy()
    expect(screen.getByText('已完成修改')).toBeTruthy()
  })

  it('folds a single-reply completed turn too (the example shape)', async () => {
    loadHistoryMock.mockResolvedValue(historyPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '帮我修改xxxx' }] }, 0),
      makeEntry('assistant/message', {
        turn: 0,
        step: 0,
        message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '已完成修改' }] },
      }, 1),
      makeEntry('turn/end', { turn: 0, reason: { kind: 'success' } }, 2),
    ]))
    render(<ChatView session={session} onBack={() => {}} />)

    await screen.findByText('帮我修改xxxx')
    expect(screen.getByRole('button', { name: /已处理/ })).toBeTruthy()
    expect(screen.getByText('已完成修改')).toBeTruthy()
  })

  it('keeps a running turn unfolded until turn/end arrives, then folds it', async () => {
    loadHistoryMock.mockResolvedValue(historyPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '改一下' }] }, 0),
      makeEntry('assistant/message', {
        turn: 0,
        step: 0,
        message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '第一步' }] },
      }, 1),
      makeEntry('assistant/message', {
        turn: 0,
        step: 1,
        message: { id: 'a-2', role: 'assistant', content: [{ type: 'text', text: '最终回复' }] },
      }, 2),
    ]))
    const mux = new FakeMux()
    render(<ChatView session={session} mux={mux as never} onBack={() => {}} />)

    // No turn/end yet: every message streams unfolded, no 已处理 header.
    await screen.findByText('第一步')
    expect(screen.getByText('最终回复')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /已处理/ })).toBeNull()

    // The turn closes: the two messages fold behind 已处理, only the last shows.
    await act(async () => {
      mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('turn/end', { turn: 0, reason: { kind: 'success' } }, 3).event })
    })
    expect(await screen.findByRole('button', { name: /已处理/ })).toBeTruthy()
    expect(screen.getByText('最终回复')).toBeTruthy()
    expect(screen.queryByText('第一步')).toBeNull()
  })

  it('folds a failed turn too and keeps the failure tag on the visible reply', async () => {
    loadHistoryMock.mockResolvedValue(historyPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '改一下' }] }, 0),
      makeEntry('assistant/message', {
        turn: 0,
        step: 0,
        message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '抱歉，执行出错了' }] },
      }, 1),
      makeEntry('turn/end', { turn: 0, reason: { kind: 'error', message: 'boom' } }, 2),
    ]))
    render(<ChatView session={session} onBack={() => {}} />)

    await screen.findByText('抱歉，执行出错了')
    expect(screen.getByRole('button', { name: /已处理/ })).toBeTruthy()
    expect(screen.getByText('本次回复失败')).toBeTruthy()
  })

  it('renders a long newest reply inside the fold expanded (no 展开全文 toggle)', async () => {
    const longText = '长'.repeat(1800)
    loadHistoryMock.mockResolvedValue(historyPage([
      makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '写长文' }] }, 0),
      makeEntry('assistant/message', {
        turn: 0,
        step: 0,
        message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '第一段' }] },
      }, 1),
      makeEntry('assistant/message', {
        turn: 0,
        step: 1,
        message: { id: 'a-2', role: 'assistant', content: [{ type: 'text', text: longText }] },
      }, 2),
      makeEntry('turn/end', { turn: 0, reason: { kind: 'success' } }, 3),
    ]))
    render(<ChatView session={session} onBack={() => {}} />)

    await screen.findByRole('button', { name: /已处理/ })
    // The final reply is still the newest session message: no long-text fold.
    expect(screen.queryByRole('button', { name: /展开全文/ })).toBeNull()
  })
})