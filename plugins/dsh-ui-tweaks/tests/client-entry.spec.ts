/** @vitest-environment jsdom */
/**
 * Client-entry smoke test: the real `apply()` wired to the two 0.1.5 faces,
 * driven through the actual DOM contract the host Chat view publishes
 * (`[data-chat-flow]` + `data-chat-flow-key` rows). Proves the ported read
 * path end to end — session source → driver → plan → fold chrome — including
 * that a lifecycle publication re-runs the fold pass and that a click on the
 * inserted「已处理」header routes into the driver's toggle.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionBinding, SessionFace, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ChatNodeStore, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationTimelineSnapshot, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply, inject } from '../src/client/index'

/** One flow row as ChatView renders it (key + kind on the direct child). */
function row(key: string, kind: string): HTMLElement {
  const el = document.createElement('div')
  el.dataset.chatFlowKey = key
  el.dataset.chatFlowKind = kind
  el.dataset.chatAnchorKey = key
  return el
}

function flowColumn(rows: Array<[key: string, kind: string]>): HTMLElement {
  const column = document.createElement('div')
  column.dataset.chatFlow = ''
  for (const [key, kind] of rows) column.appendChild(row(key, kind))
  document.body.appendChild(column)
  return column
}

/** A closed turn 1: user prompt, tool row, final answer. */
function chatSnapshot(): ChatSnapshot {
  const nodes = new Map<string, unknown>([
    ['u1', { key: 'u1', kind: 'user', anchorSeq: 10, location: { kind: 'turn', turn: { turn: 1 } } }],
    ['t1', { key: 't1', kind: 'tool-result', anchorSeq: 30, location: { kind: 'turn', turn: { turn: 1 } } }],
    ['a2', { key: 'a2', kind: 'assistant-step', anchorSeq: 40, location: { kind: 'turn', turn: { turn: 1 } } }],
  ])
  const turns = new Map<number, TurnLocation>([[
    1,
    {
      turn: 1,
      start: { type: 'turn/start', seq: 1, time: 1_000, data: { turn: 1 } },
      end: { type: 'turn/end', seq: 4, time: 4_000, data: { turn: 1, reason: 'completed' } },
      status: 'closed',
      steps: [],
      data: {},
    } as unknown as TurnLocation,
  ]])
  return {
    order: ['u1', 't1', 'a2'],
    nodes: { get: (key: string) => nodes.get(key) } as unknown as ChatNodeStore,
    locations: {},
    navigation: {},
    timeline: { turnOrder: [1], turns } as unknown as ConversationTimelineSnapshot,
    legacy: {},
  } as unknown as ChatSnapshot
}

/** The client root context the plugin needs: effects, locale, sessions, uiConversation. */
function fakeContext() {
  const disposers: Array<() => void> = []
  let session = {
    sessionId: 's1',
    queue: [],
    pendingSubmissions: [],
    running: false,
    subagent: null,
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: false,
    lastAgentError: null,
    promptAttempted: false,
    awaitingFirstTurn: false,
  } as unknown as SessionSnapshot
  const sessionListeners = new Set<() => void>()
  const chatListeners = new Set<() => void>()
  const dictionaries = new Map<string, Record<string, string>>()
  const face = {
    getSnapshot: () => session,
    subscribe: (fn: () => void) => {
      sessionListeners.add(fn)
      return () => sessionListeners.delete(fn)
    },
    loadOlder: vi.fn(async () => {}),
  } as unknown as SessionFace
  const binding = { sessionId: 's1', session: face } as unknown as SessionBinding
  const target = {
    getSnapshot: () => chatSnapshot(),
    subscribe: (fn: () => void) => {
      chatListeners.add(fn)
      return () => chatListeners.delete(fn)
    },
  }
  const ctx = {
    effect(fn: () => (() => void) | void) {
      const off = fn()
      if (typeof off === 'function') disposers.push(off)
      return off ?? (() => {})
    },
    locale: {
      register(namespace: string, dicts: Record<string, Record<string, string>>) {
        dictionaries.set(namespace, dicts.zh)
        return () => dictionaries.delete(namespace)
      },
      bind(namespace: string) {
        return (key: string, params?: { n?: number }) => {
          const text = dictionaries.get(namespace)?.[key] ?? key
          return params?.n === undefined ? text : text.replace('{n}', String(params.n))
        }
      },
    },
    sessions: {
      list: { getSnapshot: () => ({ current: 's1' }), subscribe: () => () => {} },
      binding: () => binding,
    },
    uiConversation: { binding: () => ({ target: () => target }) },
    get: () => undefined,
  } as unknown as ClientContext
  return {
    ctx,
    loadOlder: face.loadOlder as unknown as ReturnType<typeof vi.fn>,
    /** Publish a lifecycle change (e.g. the window closing) to the fold source. */
    publish(over: Partial<SessionSnapshot>) {
      session = { ...session, ...over } as unknown as SessionSnapshot
      for (const fn of [...sessionListeners]) fn()
    },
    disposeAll() {
      for (const off of disposers.splice(0)) off()
    },
  }
}

/** Resolve after the entry's rAF-coalesced pass has run. */
function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('client entry (0.1.5 wiring)', () => {
  it('declares the services its read path needs', () => {
    expect(inject).toEqual(['sessions', 'locale'])
  })

  it('folds a completed turn from the 0.1.5 faces and toggles it from the DOM', async () => {
    const column = flowColumn([['u1', 'user'], ['t1', 'tool-result'], ['a2', 'assistant-step']])
    const fake = fakeContext()
    apply(fake.ctx)

    const header = column.querySelector<HTMLElement>('[data-dsh-fold-header]')
    expect(header).not.toBeNull()
    expect(header?.getAttribute('data-dsh-fold-turn')).toBe('1')
    expect(header?.querySelector('.dsh-fold-label')?.textContent).toBe('已处理')
    expect(header?.querySelector('.dsh-fold-count')?.textContent).toBe('1 条')
    expect(header?.querySelector('.dsh-fold-duration')?.textContent).toBe('3s')
    // The tool row is folded; the user prompt and the final answer stay visible.
    expect(column.querySelectorAll('[data-dsh-fold-row]').length).toBe(1)
    expect(column.querySelector('[data-chat-flow-key="t1"]')?.getAttribute('data-dsh-fold-row')).toBe('1')
    expect(column.querySelector('[data-chat-flow-key="a2"]')?.getAttribute('data-dsh-fold-last')).toBe('1')

    header?.click()
    expect(column.querySelector('[data-dsh-fold-header]')?.getAttribute('aria-expanded')).toBe('true')
    fake.disposeAll()
  })

  it('re-runs the fold pass when the session lifecycle publishes', async () => {
    const column = flowColumn([['u1', 'user'], ['t1', 'tool-result'], ['a2', 'assistant-step']])
    const fake = fakeContext()
    apply(fake.ctx)
    expect(column.querySelectorAll('[data-dsh-fold-header]').length).toBe(1)

    // The history window closes (loading): no fold while the window is not open.
    fake.publish({ openState: 'loading' })
    await nextFrame()
    expect(column.querySelectorAll('[data-dsh-fold-header]').length).toBe(0)
    expect(column.querySelectorAll('[data-dsh-fold-row]').length).toBe(0)

    // Reopening folds again — the driver kept its session identity.
    fake.publish({ openState: 'open' })
    await nextFrame()
    expect(column.querySelectorAll('[data-dsh-fold-header]').length).toBe(1)
    fake.disposeAll()
  })
})
