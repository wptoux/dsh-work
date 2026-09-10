/**
 * The fold driver's session source over the DSH 0.1.5 client services.
 *
 * DSH 0.1.5 split the old single `ConversationSnapshot` (session lifecycle +
 * assembled chat, both reached through `ctx.sessions` in 0.1.1) into two
 * independently addressable faces, and moved the sessions service out of the
 * removed `dsh-client-runtime` into `dsh-api-session-controller`:
 *
 * - Session lifecycle/control (`openState`, `hasMore`, `loadingOlder`) now
 *   lives in `SessionSnapshot`, read through `ctx.sessions.binding(id).session`
 *   — `SessionFace = ISession & ObservableSnapshot<SessionSnapshot>`
 *   (dsh-api-session-controller client/contract/session.d.ts), i.e. the exact
 *   value the official `useSession` slot hook hands to mounted components.
 * - The assembled chat window (`order`, `nodes`, `timeline`) is published as
 *   the `chat` target of the per-session Conversation assembly
 *   (`ConversationViewSnapshotMap['chat']`), read through
 *   `ctx.uiConversation.binding(binding).target('chat')`
 *   (dsh-client-ui-conversation client/conversation/assembly.d.ts). This is
 *   the path the official Chat view itself uses for a non-slot consumer
 *   (dsh-client-ui-chat lib/client.js: `ctx.uiConversation.binding(binding).target('chat')`).
 *
 * Both faces are subscribed: the Session snapshot carries lifecycle
 * transitions, while the chat target carries Chat publication (a `turn/end`
 * that changes no flow row structure — or a node materializing between two
 * existing rows — never reaches the driver through the DOM observer alone).
 *
 * Note: `target('chat')` activates the Chat target for the session on its
 * first subscriber (assembly.d.ts: "The first subscriber activates the target
 * … activation lasts for the remaining Session lifetime"). The plugin only
 * ever subscribes the session the shell has staged (`list.current`), which is
 * the one whose Conversation the shell assembles anyway.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionBinding, SessionFace, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { DriverSnapshot, FoldSessionHandle, FoldSessionSource } from './fold-driver'

/**
 * Structural stand-in for the Chat target source
 * (`ObservableSnapshot<ChatSnapshot | undefined>`); spelled out here so the
 * module stays free of a direct `dsh-client-store` dependency.
 */
interface ChatTargetSource {
  getSnapshot(): ChatSnapshot | undefined
  subscribe(fn: () => void): () => void
}

/**
 * Project the two 0.1.5 faces onto the planner's minimal window shape. The
 * plugin's own `DriverSnapshot` contract, the planner, the driver and their
 * tests are unchanged by the port — only these six reads moved:
 *
 * | DriverSnapshot | 0.1.1 source                    | 0.1.5 source                       |
 * | -------------- | ------------------------------- | ---------------------------------- |
 * | `openState`    | `ConversationSnapshot.openState`| `SessionSnapshot.openState`        |
 * | `hasMore`      | `ConversationSnapshot.hasMore`  | `SessionSnapshot.hasMore`          |
 * | `loadingOlder` | `ConversationSnapshot.loadingOlder` | `SessionSnapshot.loadingOlder` |
 * | `turns`        | `chat.timeline.turns`           | `ChatSnapshot.timeline.turns`      |
 * | `order`        | `chat.order`                    | `ChatSnapshot.order`               |
 * | `nodes`        | `chat.nodes`                    | `ChatSnapshot.nodes`               |
 *
 * The `ChatSnapshot` itself is byte-for-byte the 0.1.1 contract (same
 * `order`/`nodes`/`timeline` shapes; `order` is still visible-node keys only),
 * so only the read path moved. An absent chat snapshot (target not yet
 * activated — the official Chat view defaults it to `EMPTY_CHAT_SNAPSHOT`)
 * projects to an empty window rather than dropping the session handle, so the
 * driver keeps its per-session expanded state across the transient gap.
 * @param session - the session's lifecycle snapshot (SessionFace.getSnapshot()).
 * @param chat - the session's Chat target snapshot, when published yet.
 * @returns the driver's window shape.
 */
export function projectSnapshot(session: SessionSnapshot, chat: ChatSnapshot | undefined): DriverSnapshot {
  const turns = new Map<number, { startTime?: number; endTime?: number }>()
  for (const [number, location] of chat?.timeline.turns ?? []) {
    turns.set(number, { startTime: location.start?.time, endTime: location.end?.time })
  }
  return {
    openState: session.openState,
    hasMore: session.hasMore,
    loadingOlder: session.loadingOlder,
    turns,
    order: chat?.order ?? [],
    nodes: {
      get(key) {
        const node = chat?.nodes.get(key)
        if (node === undefined) return undefined
        const location = node.location
        const turn = location.kind === 'turn' || location.kind === 'step' ? location.turn.turn : undefined
        return { kind: node.kind, anchorSeq: node.anchorSeq, location: { kind: location.kind, turn } }
      },
    },
  }
}

/** One resolved session: the two faces the projection reads, plus the load verb. */
interface BoundSession {
  readonly handle: FoldSessionHandle
  readonly session: SessionFace
  readonly chat: ChatTargetSource
}

/** Branded session identity, spelled off the sessions face rather than a direct dsh-session dependency. */
type SessionId = Parameters<ClientContext['sessions']['binding']>[0]

/**
 * Resolve the two 0.1.5 data faces of one session, or null while the sessions
 * service has no binding for it (unlisted and not yet scoped).
 */
function bind(ctx: ClientContext, id: SessionId): BoundSession | null {
  const binding: SessionBinding | undefined = ctx.sessions.binding(id)
  if (binding === undefined) return null
  const session = binding.session
  const chat = ctx.uiConversation.binding(binding).target('chat')
  return {
    session,
    chat,
    handle: {
      sessionId: id,
      snapshot: () => projectSnapshot(session.getSnapshot(), chat.getSnapshot()),
      loadOlder: () => session.loadOlder().catch(() => {}),
    },
  }
}

/**
 * The fold driver's session source: the current selection's session face
 * (lifecycle read + `loadOlder`) and Chat target (content read), both
 * re-subscribed when the selection changes.
 * @param ctx - the client root context.
 * @returns the driver-facing source.
 */
export function createSessionSource(ctx: ClientContext): FoldSessionSource {
  return {
    current() {
      const id = ctx.sessions.list.getSnapshot().current
      if (id === undefined) return null
      return bind(ctx, id)?.handle ?? null
    },
    subscribe(fn) {
      let offBound: (() => void) | null = null
      const resubscribe = (): void => {
        offBound?.()
        offBound = null
        const id = ctx.sessions.list.getSnapshot().current
        if (id === undefined) return
        const bound = bind(ctx, id)
        if (bound === null) return
        const offSession = bound.session.subscribe(fn)
        const offChat = bound.chat.subscribe(fn)
        offBound = () => {
          offChat()
          offSession()
        }
      }
      const offList = ctx.sessions.list.subscribe(() => {
        resubscribe()
        fn()
      })
      resubscribe()
      return () => {
        offBound?.()
        offList()
      }
    },
  }
}
