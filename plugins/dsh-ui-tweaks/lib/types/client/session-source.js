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
export function projectSnapshot(session, chat) {
    const turns = new Map();
    for (const [number, location] of chat?.timeline.turns ?? []) {
        turns.set(number, { startTime: location.start?.time, endTime: location.end?.time });
    }
    return {
        openState: session.openState,
        hasMore: session.hasMore,
        loadingOlder: session.loadingOlder,
        turns,
        order: chat?.order ?? [],
        nodes: {
            get(key) {
                const node = chat?.nodes.get(key);
                if (node === undefined)
                    return undefined;
                const location = node.location;
                const turn = location.kind === 'turn' || location.kind === 'step' ? location.turn.turn : undefined;
                return { kind: node.kind, anchorSeq: node.anchorSeq, location: { kind: location.kind, turn } };
            },
        },
    };
}
/**
 * Resolve the two 0.1.5 data faces of one session, or null while the sessions
 * service has no binding for it (unlisted and not yet scoped).
 */
function bind(ctx, id) {
    const binding = ctx.sessions.binding(id);
    if (binding === undefined)
        return null;
    const session = binding.session;
    const chat = ctx.uiConversation.binding(binding).target('chat');
    return {
        session,
        chat,
        handle: {
            sessionId: id,
            snapshot: () => projectSnapshot(session.getSnapshot(), chat.getSnapshot()),
            loadOlder: () => session.loadOlder().catch(() => { }),
        },
    };
}
/**
 * The fold driver's session source: the current selection's session face
 * (lifecycle read + `loadOlder`) and Chat target (content read), both
 * re-subscribed when the selection changes.
 * @param ctx - the client root context.
 * @returns the driver-facing source.
 */
export function createSessionSource(ctx) {
    return {
        current() {
            const id = ctx.sessions.list.getSnapshot().current;
            if (id === undefined)
                return null;
            return bind(ctx, id)?.handle ?? null;
        },
        subscribe(fn) {
            let offBound = null;
            const resubscribe = () => {
                offBound?.();
                offBound = null;
                const id = ctx.sessions.list.getSnapshot().current;
                if (id === undefined)
                    return;
                const bound = bind(ctx, id);
                if (bound === null)
                    return;
                const offSession = bound.session.subscribe(fn);
                const offChat = bound.chat.subscribe(fn);
                offBound = () => {
                    offChat();
                    offSession();
                };
            };
            const offList = ctx.sessions.list.subscribe(() => {
                resubscribe();
                fn();
            });
            resubscribe();
            return () => {
                offBound?.();
                offList();
            };
        },
    };
}
