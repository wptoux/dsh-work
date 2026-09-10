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
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client';
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { DriverSnapshot, FoldSessionSource } from './fold-driver';
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
export declare function projectSnapshot(session: SessionSnapshot, chat: ChatSnapshot | undefined): DriverSnapshot;
/**
 * The fold driver's session source: the current selection's session face
 * (lifecycle read + `loadOlder`) and Chat target (content read), both
 * re-subscribed when the selection changes.
 * @param ctx - the client root context.
 * @returns the driver-facing source.
 */
export declare function createSessionSource(ctx: ClientContext): FoldSessionSource;
//# sourceMappingURL=session-source.d.ts.map