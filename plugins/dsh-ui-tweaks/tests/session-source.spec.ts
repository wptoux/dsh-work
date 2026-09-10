/** @vitest-environment jsdom */
/**
 * The 0.1.5 session source: the port of the old single `ConversationSnapshot`
 * read path onto its two 0.1.5 homes — the sessions service's `SessionSnapshot`
 * (openState/hasMore/loadingOlder) and the Conversation assembly's `chat`
 * target (order/nodes/timeline). Fakes both faces structurally; no kernel
 * services are booted.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SessionBinding, SessionFace, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  ChatLocationNodeIndex,
  ChatNodeStore,
  ChatSnapshot,
  ChatTurnNavigationIndex,
  LegacyConversationSlice,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationTimelineSnapshot, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { windowFromSnapshot } from '../src/client/fold-driver'
import { planFolds } from '../src/client/fold-plan'
import { createSessionSource, projectSnapshot } from '../src/client/session-source'

/** A full SessionSnapshot with overridable fields (the 0.1.5 lifecycle face). */
function sessionSnapshot(over: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
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
    ...over,
  } as unknown as SessionSnapshot
}

/** One turn boundary as the timeline publishes it: a `turn/start` | `turn/end` event, or absent. */
function boundary(turn: number, type: 'turn/start' | 'turn/end', time: number): TurnLocation['start'] {
  return { type, seq: time, time, data: { turn } } as unknown as TurnLocation['start']
}

/** A ChatSnapshot with only the fields the projection reads populated. */
function chatSnapshot(build: {
  order?: readonly string[]
  turns?: Array<[number, { startTime?: number; endTime?: number }]>
  nodes?: Array<[string, string, number, 'turn' | 'step' | 'session' | 'unresolved', number?]>
} = {}): ChatSnapshot {
  const store = new Map<string, unknown>()
  for (const [key, kind, anchorSeq, kindOfLocation, turn] of build.nodes ?? []) {
    const location = kindOfLocation === 'turn'
      ? { kind: 'turn', turn: { turn: turn ?? 1 } }
      : kindOfLocation === 'step'
        ? { kind: 'step', turn: { turn: turn ?? 1 }, step: { step: 1 } }
        : { kind: kindOfLocation }
    store.set(key, { key, kind, id: key, target: 'chat', anchorSeq, location, visibility: 'visible', data: {} })
  }
  const turns = new Map<number, TurnLocation>()
  for (const [number, times] of build.turns ?? []) {
    turns.set(number, {
      turn: number,
      start: times.startTime === undefined ? undefined : boundary(number, 'turn/start', times.startTime),
      end: times.endTime === undefined ? undefined : boundary(number, 'turn/end', times.endTime),
      status: times.endTime === undefined ? 'open' : 'closed',
      steps: [],
      data: {},
    } as unknown as TurnLocation)
  }
  return {
    order: build.order ?? [...store.keys()],
    nodes: { get: (key: string) => store.get(key) } as unknown as ChatNodeStore,
    locations: {} as ChatLocationNodeIndex,
    navigation: {} as ChatTurnNavigationIndex,
    timeline: { turnOrder: [...turns.keys()], turns } as unknown as ConversationTimelineSnapshot,
    legacy: {} as LegacyConversationSlice,
  }
}

/** One fake session behind the two service faces the source resolves. */
function fakeSession(id: string, session: SessionSnapshot, chat: ChatSnapshot | undefined) {
  const sessionListeners = new Set<() => void>()
  const chatListeners = new Set<() => void>()
  const loadOlder = vi.fn(async () => {})
  const face = {
    getSnapshot: () => session,
    subscribe: (fn: () => void) => {
      sessionListeners.add(fn)
      return () => sessionListeners.delete(fn)
    },
    loadOlder,
  } as unknown as SessionFace
  const target = {
    getSnapshot: () => chat,
    subscribe: (fn: () => void) => {
      chatListeners.add(fn)
      return () => chatListeners.delete(fn)
    },
  }
  return {
    binding: { sessionId: id, session: face } as unknown as SessionBinding,
    target,
    loadOlder,
    live: () => sessionListeners.size + chatListeners.size,
    notifySession: () => { for (const fn of [...sessionListeners]) fn() },
    notifyChat: () => { for (const fn of [...chatListeners]) fn() },
  }
}

/** A root-context fake exposing only `sessions` + `uiConversation`. */
function fakeContext(sessions: Map<string, ReturnType<typeof fakeSession>>) {
  const listListeners = new Set<() => void>()
  const state = { current: 's1' as string | undefined }
  const ctx = {
    sessions: {
      list: {
        getSnapshot: () => ({ current: state.current }),
        subscribe: (fn: () => void) => {
          listListeners.add(fn)
          return () => listListeners.delete(fn)
        },
      },
      binding: (id: string) => sessions.get(id)?.binding,
    },
    uiConversation: {
      binding: (source: SessionBinding) => ({ target: () => sessions.get(source.sessionId)?.target }),
    },
  } as unknown as ClientContext
  return {
    ctx,
    select(id: string | undefined) {
      state.current = id
      for (const fn of [...listListeners]) fn()
    },
    liveListSubscribers: () => listListeners.size,
  }
}

describe('projectSnapshot', () => {
  it('takes openState/hasMore/loadingOlder from the SessionSnapshot (0.1.5 sessions face)', () => {
    const snapshot = projectSnapshot(
      sessionSnapshot({ openState: 'loading', hasMore: true, loadingOlder: true }),
      chatSnapshot(),
    )
    expect(snapshot.openState).toBe('loading')
    expect(snapshot.hasMore).toBe(true)
    expect(snapshot.loadingOlder).toBe(true)
  })

  it('takes order/nodes/timeline from the chat target (0.1.5 Conversation face)', () => {
    const snapshot = projectSnapshot(sessionSnapshot(), chatSnapshot({
      turns: [[1, { startTime: 1_000, endTime: 2_000 }]],
      nodes: [
        ['u1', 'user', 10, 'turn', 1],
        ['a1', 'assistant-step', 20, 'step', 1],
        ['ctx1', 'context', 5, 'session'],
      ],
    }))
    expect(snapshot.order).toEqual(['u1', 'a1', 'ctx1'])
    expect(snapshot.turns.get(1)).toEqual({ startTime: 1_000, endTime: 2_000 })
    expect(snapshot.nodes.get('u1')).toEqual({ kind: 'user', anchorSeq: 10, location: { kind: 'turn', turn: 1 } })
    // A step-located node reports its owning turn too.
    expect(snapshot.nodes.get('a1')).toEqual({ kind: 'assistant-step', anchorSeq: 20, location: { kind: 'step', turn: 1 } })
    // Session-level (floating) nodes carry no turn, so the planner ignores them.
    expect(snapshot.nodes.get('ctx1')).toEqual({ kind: 'context', anchorSeq: 5, location: { kind: 'session', turn: undefined } })
    expect(snapshot.nodes.get('missing')).toBeUndefined()
  })

  it('leaves a boundary timestamp undefined when its event is outside the window', () => {
    const snapshot = projectSnapshot(sessionSnapshot(), chatSnapshot({
      turns: [[1, { startTime: 1_000 }], [2, { endTime: 2_000 }]],
    }))
    expect(snapshot.turns.get(1)).toEqual({ startTime: 1_000, endTime: undefined })
    expect(snapshot.turns.get(2)).toEqual({ startTime: undefined, endTime: 2_000 })
  })

  it('projects an empty window while the chat target has no snapshot yet', () => {
    const snapshot = projectSnapshot(sessionSnapshot(), undefined)
    expect(snapshot).toMatchObject({ openState: 'open', hasMore: false, loadingOlder: false, order: [] })
    expect(snapshot.turns.size).toBe(0)
    expect(snapshot.nodes.get('u1')).toBeUndefined()
  })

  it('feeds the unchanged driver/planner pipeline (fold parity end to end)', () => {
    const snapshot = projectSnapshot(sessionSnapshot(), chatSnapshot({
      turns: [[1, { startTime: 500_000, endTime: 696_000 }]],
      nodes: [
        ['u1', 'user', 10, 'turn', 1],
        ['a1', 'assistant-step', 20, 'turn', 1],
        ['t1', 'tool-result', 30, 'turn', 1],
        ['a2', 'assistant-step', 40, 'turn', 1],
      ],
    }))
    const foldWindow = windowFromSnapshot(snapshot)
    expect(foldWindow?.turns.get(1)).toEqual({ turn: 1, startLoaded: true, endLoaded: true, durationMs: 196_000 })
    const plan = planFolds(foldWindow!)
    expect(plan.folds).toHaveLength(1)
    expect(plan.folds[0]).toMatchObject({
      turn: 1,
      hiddenKeys: ['a1', 't1'],
      lastAssistantKey: 'a2',
      durationMs: 196_000,
    })
  })

  it('does not fold while the session window is not open', () => {
    const snapshot = projectSnapshot(sessionSnapshot({ openState: 'cold' }), chatSnapshot({
      turns: [[1, { startTime: 1, endTime: 2 }]],
      nodes: [['a1', 'assistant-step', 20, 'turn', 1]],
    }))
    expect(windowFromSnapshot(snapshot)).toBeNull()
  })
})

describe('createSessionSource', () => {
  it('returns no handle without a current selection or without a binding', () => {
    const source = createSessionSource(fakeContext(new Map()).ctx)
    expect(source.current()).toBeNull()
    const context = fakeContext(new Map())
    context.select(undefined)
    expect(createSessionSource(context.ctx).current()).toBeNull()
    context.select('s1') // listed but no service binding → still no handle
    expect(createSessionSource(context.ctx).current()).toBeNull()
  })

  it('exposes the selected session id, both faces projected, and forwards loadOlder', async () => {
    const fake = fakeSession('s1', sessionSnapshot({ hasMore: true }), chatSnapshot({
      turns: [[1, { startTime: 10, endTime: 20 }]],
      nodes: [['a1', 'assistant-step', 20, 'turn', 1]],
    }))
    const source = createSessionSource(fakeContext(new Map([['s1', fake]])).ctx)
    const handle = source.current()
    expect(handle?.sessionId).toBe('s1')
    expect(handle?.snapshot()).toMatchObject({ openState: 'open', hasMore: true, order: ['a1'] })
    await handle?.loadOlder()
    expect(fake.loadOlder).toHaveBeenCalledTimes(1)
  })

  it('swallows a failing loadOlder (the failure lands in the session snapshot)', async () => {
    const fake = fakeSession('s1', sessionSnapshot(), chatSnapshot())
    fake.loadOlder.mockRejectedValueOnce(new Error('offline'))
    const source = createSessionSource(fakeContext(new Map([['s1', fake]])).ctx)
    await expect(source.current()?.loadOlder()).resolves.toBeUndefined()
  })

  it('subscribes both 0.1.5 faces and notifies on either one', () => {
    const fake = fakeSession('s1', sessionSnapshot(), chatSnapshot())
    const context = fakeContext(new Map([['s1', fake]]))
    const seen = vi.fn()
    const off = createSessionSource(context.ctx).subscribe(seen)
    expect(fake.live()).toBe(2) // session snapshot + chat target
    fake.notifySession()
    fake.notifyChat()
    context.select('s1') // a list publication (and the re-subscribe that follows)
    expect(seen).toHaveBeenCalledTimes(3)
    off()
    expect(fake.live()).toBe(0)
    expect(context.liveListSubscribers()).toBe(0)
    fake.notifySession()
    expect(seen).toHaveBeenCalledTimes(3)
  })

  it('re-subscribes to the new session when the selection changes', () => {
    const first = fakeSession('s1', sessionSnapshot(), chatSnapshot())
    const second = fakeSession('s2', sessionSnapshot({ openState: 'loading' }), chatSnapshot())
    const context = fakeContext(new Map([['s1', first], ['s2', second]]))
    context.select('s2')
    const source = createSessionSource(context.ctx)
    const seen = vi.fn()
    source.subscribe(seen)
    expect(first.live()).toBe(0)
    expect(second.live()).toBe(2)
    first.notifySession() // the old session is detached
    expect(seen).not.toHaveBeenCalled()
    second.notifyChat()
    expect(seen).toHaveBeenCalledTimes(1)
  })
})
