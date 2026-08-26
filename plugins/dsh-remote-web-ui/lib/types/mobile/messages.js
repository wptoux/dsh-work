/** Runtime shape guard for the lossless-JSON `data` of a `WireEvent`. */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function pickString(value) {
    return typeof value === 'string' ? value : undefined;
}
function pickNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
/** Fallback message id for events without a stable wire id. */
function syntheticId(prefix, seq) {
    return `${prefix}#${String(seq)}`;
}
/** Concatenate the plain text of every `text` content block. */
function textFromContent(content) {
    return blocksOfType(content, 'text');
}
/** Concatenate the plain text of every `reasoning` content block. */
function reasoningFromContent(content) {
    return blocksOfType(content, 'reasoning');
}
/** Concatenate the plain text of every content block of one type. */
function blocksOfType(content, type) {
    if (!Array.isArray(content))
        return '';
    let out = '';
    for (const block of content) {
        if (!isRecord(block))
            continue;
        if (block['type'] !== type)
            continue;
        const text = pickString(block['text']);
        if (text !== undefined)
            out += text;
    }
    return out;
}
/**
 * Extract a text-chunk target from `assistant/chunk` or the mobile alias
 * `message/chunk`.
 *
 * - DSH shape: `data.chunk = { type: 'text-delta', text }` keyed by
 *   `(turn, step)`; the pending message is created/aggregated on the owning
 *   step and later finalized by the matching `assistant/message`.
 * - Mobile shape: `data.text` with an optional `messageId` binding the delta
 *   to a specific assistant message.
 *
 * Returns null for non-text chunk variants (usage / finish / block-start).
 */
function chunkTarget(data) {
    if (!isRecord(data))
        return null;
    let text;
    let kind = 'text';
    let idValue;
    let turn;
    let step;
    const chunk = data['chunk'];
    if (isRecord(chunk)) {
        if (chunk['type'] !== 'text-delta' && chunk['type'] !== 'reasoning-delta')
            return null;
        text = pickString(chunk['text']);
        kind = chunk['type'] === 'reasoning-delta' ? 'reasoning' : 'text';
        turn = pickNumber(data['turn']);
        step = pickNumber(data['step']);
    }
    else {
        text = pickString(data['text']);
        kind = pickString(data['kind']) === 'reasoning' ? 'reasoning' : 'text';
        idValue = pickString(data['messageId']) ?? pickString(data['id']);
        turn = pickNumber(data['turn']);
        step = pickNumber(data['step']);
    }
    if (text === undefined)
        return null;
    const result = { text, kind };
    if (idValue !== undefined)
        result.id = idValue;
    if (turn !== undefined)
        result.turn = turn;
    if (step !== undefined)
        result.step = step;
    return result;
}
function createState(existing) {
    const messages = existing === undefined ? [] : [...existing];
    const state = {
        messages,
        byId: new Map(),
        pendingByTurnStep: new Map(),
        turnStepMessage: new Map(),
        messageTurn: new Map(),
        completedTurns: new Set(),
        toolNames: new Map(),
        maxSeq: -1,
    };
    for (const message of messages) {
        if (message.seq > state.maxSeq)
            state.maxSeq = message.seq;
        state.byId.set(message.id, message);
        if (message.kind !== 'assistant')
            continue;
        // Rebuild the (turn, step) and turn index maps lost when `existing` was
        // handed back to us as plain rows. The wire `turn` field (when present)
        // restores the turn index even for messages with real wire ids.
        const decoded = decodePendingTurnStep(message.id);
        const key = decoded === undefined ? undefined : tsKey(decoded.turn, decoded.step);
        if (message.pending === true && key !== undefined) {
            state.pendingByTurnStep.set(key, message);
            state.turnStepMessage.set(key, message);
        }
        if (decoded !== undefined) {
            state.messageTurn.set(message.id, decoded.turn);
        }
        else if (message.turn !== undefined) {
            state.messageTurn.set(message.id, message.turn);
        }
        if (message.turnEnded === true && message.turn !== undefined) {
            state.completedTurns.add(message.turn);
        }
    }
    return state;
}
/**
 * Mark a message of an already-completed turn as ended. Folded in a
 * different batch than its turn/end (a turn split across history pages),
 * the message still folds into its completed turn (已处理).
 */
function completedAware(state, message) {
    if (message.turnEnded === true)
        return message;
    if (message.turn === undefined || !state.completedTurns.has(message.turn))
        return message;
    return { ...message, turnEnded: true };
}
function tsKey(turn, step) {
    return turn === undefined || step === undefined ? undefined : `${turn}.${step}`;
}
/**
 * Recover the `(turn, step)` a pending assistant message was created under from
 * its synthetic id (`assistant,<turn>.<step>#<seq>`), so an incremental fold
 * over an `existing` list can re-attach index maps that were lost across calls.
 */
function decodePendingTurnStep(id) {
    if (!id.startsWith('assistant,'))
        return undefined;
    const rest = id.slice('assistant,'.length);
    const hash = rest.indexOf('#');
    const tsPart = hash === -1 ? rest : rest.slice(0, hash);
    const dot = tsPart.indexOf('.');
    if (dot <= 0 || dot === tsPart.length - 1)
        return undefined;
    const turn = Number(tsPart.slice(0, dot));
    const step = Number(tsPart.slice(dot + 1));
    if (!Number.isInteger(turn) || !Number.isInteger(step))
        return undefined;
    return { turn, step };
}
/**
 * Swap in a replacement message object at the old message's position and
 * re-index it. Immutable: `next` is a fresh object; the old one is untouched.
 */
function replaceMessage(state, oldMessage, next) {
    const index = state.messages.indexOf(oldMessage);
    if (index !== -1)
        state.messages[index] = next;
    state.byId.delete(oldMessage.id);
    state.byId.set(next.id, next);
}
/** Bundle the maps keyed per `(turn, step)` over to a newly swapped message. */
function retargetTurnStep(state, key, oldMessage, next) {
    if (key === undefined)
        return;
    if (state.pendingByTurnStep.get(key) === oldMessage)
        state.pendingByTurnStep.set(key, next);
    if (state.turnStepMessage.get(key) === oldMessage)
        state.turnStepMessage.set(key, next);
}
/** Fold one event into the working state. Assumes the event passes the watermark. */
function applyEvent(state, event) {
    if (event.seq > state.maxSeq)
        state.maxSeq = event.seq;
    switch (event.type) {
        case 'user/message':
            applyUserMessage(state, event);
            break;
        case 'assistant/message':
            applyAssistantMessage(state, event);
            break;
        case 'assistant/chunk':
        case 'message/chunk':
            applyChunk(state, event);
            break;
        case 'message/update':
            applyUpdate(state, event);
            break;
        case 'message/delete':
            applyDelete(state, event);
            break;
        case 'turn/end':
            applyTurnEnd(state, event);
            break;
        case 'tool/call':
            applyToolCall(state, event);
            break;
        case 'request/context': {
            // Wire shape: { provider, model, contextWindow? }. A present finite
            // contextWindow seeds every later assistant message that reports usage.
            const data = isRecord(event.data) ? event.data : {};
            const window = pickNumber(data['contextWindow']);
            if (window !== undefined)
                state.contextWindow = window;
            break;
        }
        // turn/start, session/end-seed, and every other/unknown type render nothing.
        default:
            break;
    }
}
function applyUserMessage(state, event) {
    const data = isRecord(event.data) ? event.data : {};
    const id = pickString(data['id']) ?? syntheticId('user', event.seq);
    const text = textFromContent(data['content']);
    const source = isRecord(data['source']) ? data['source'] : {};
    const sourceKind = pickString(source['kind']);
    const existing = state.byId.get(id);
    if (existing !== undefined) {
        // Idempotent replace (replayed events update in place, never duplicate).
        replaceMessage(state, existing, {
            ...existing,
            ...(sourceKind !== undefined ? { sourceKind } : {}),
            text,
            seq: event.seq,
            time: event.time,
        });
        return;
    }
    const message = {
        id,
        kind: 'user',
        text,
        ...(sourceKind !== undefined ? { sourceKind } : {}),
        seq: event.seq,
        time: event.time,
    };
    state.messages.push(message);
    state.byId.set(id, message);
}
function applyAssistantMessage(state, event) {
    const data = isRecord(event.data) ? event.data : {};
    const messageData = isRecord(data['message']) ? data['message'] : data;
    const id = pickString(messageData['id']) ?? pickString(data['id']) ?? syntheticId('assistant', event.seq);
    const turn = pickNumber(data['turn']);
    const step = pickNumber(data['step']);
    const finalText = textFromContent(messageData['content']);
    const finalReasoning = reasoningFromContent(messageData['content']);
    const key = tsKey(turn, step);
    const usage = usageFromData(data);
    const contextWindow = state.contextWindow;
    // Finalize the matching assistant message (by id, or by turn/step for the
    // streaming partial that chunks built before the final event arrived).
    let target = state.byId.get(id);
    if (target === undefined && key !== undefined)
        target = state.pendingByTurnStep.get(key);
    if (target !== undefined) {
        const next = {
            ...target,
            id,
            text: finalText,
            // The final content block list is authoritative; an adapter that omits
            // reasoning from the final message keeps the streamed reasoning text.
            ...(finalReasoning !== '' ? { reasoning: finalReasoning } : {}),
            ...(usage !== undefined ? { usage } : {}),
            ...(usage !== undefined && contextWindow !== undefined ? { contextWindow } : {}),
            ...(turn !== undefined ? { turn } : {}),
            seq: event.seq,
            time: event.time,
            pending: false,
        };
        replaceMessage(state, target, completedAware(state, next));
        retargetTurnStep(state, key, target, next);
        if (turn !== undefined)
            state.messageTurn.set(next.id, turn);
        return;
    }
    const message = completedAware(state, {
        id,
        kind: 'assistant',
        text: finalText,
        ...(finalReasoning !== '' ? { reasoning: finalReasoning } : {}),
        ...(usage !== undefined ? { usage } : {}),
        ...(usage !== undefined && contextWindow !== undefined ? { contextWindow } : {}),
        ...(turn !== undefined ? { turn } : {}),
        seq: event.seq,
        time: event.time,
    });
    state.messages.push(message);
    state.byId.set(id, message);
    if (key !== undefined) {
        state.pendingByTurnStep.delete(key);
        state.turnStepMessage.set(key, message);
    }
    if (turn !== undefined)
        state.messageTurn.set(id, turn);
}
/**
 * Extract token usage from an assistant event payload. Only attaches when the
 * wire carries finite `inputTokens` AND `outputTokens`; the cache fields are
 * included only for finite numbers.
 */
function usageFromData(data) {
    const usageData = data['usage'];
    if (!isRecord(usageData))
        return undefined;
    const inputTokens = pickNumber(usageData['inputTokens']);
    const outputTokens = pickNumber(usageData['outputTokens']);
    if (inputTokens === undefined || outputTokens === undefined)
        return undefined;
    const usage = { inputTokens, outputTokens };
    const cacheReadTokens = pickNumber(usageData['cacheReadTokens']);
    const cacheWriteTokens = pickNumber(usageData['cacheWriteTokens']);
    if (cacheReadTokens !== undefined)
        usage.cacheReadTokens = cacheReadTokens;
    if (cacheWriteTokens !== undefined)
        usage.cacheWriteTokens = cacheWriteTokens;
    return usage;
}
function applyChunk(state, event) {
    const target = chunkTarget(event.data);
    if (target === null)
        return;
    const key = tsKey(target.turn, target.step);
    let message;
    if (target.id !== undefined) {
        message = state.byId.get(target.id);
    }
    else if (key !== undefined) {
        message = state.pendingByTurnStep.get(key) ?? state.turnStepMessage.get(key);
    }
    if (message !== undefined && message.kind === 'assistant') {
        const next = target.kind === 'reasoning'
            ? { ...message, reasoning: (message.reasoning ?? '') + target.text, seq: event.seq, time: event.time }
            : { ...message, text: message.text + target.text, seq: event.seq, time: event.time };
        replaceMessage(state, message, completedAware(state, next));
        retargetTurnStep(state, key, message, next);
        return;
    }
    const id = target.id
        ?? (key !== undefined ? syntheticId(`assistant,${key}`, event.seq) : syntheticId('assistant', event.seq));
    const created = completedAware(state, target.kind === 'reasoning'
        ? { id, kind: 'assistant', text: '', reasoning: target.text, seq: event.seq, time: event.time, pending: true, ...(target.turn !== undefined ? { turn: target.turn } : {}) }
        : { id, kind: 'assistant', text: target.text, seq: event.seq, time: event.time, pending: true, ...(target.turn !== undefined ? { turn: target.turn } : {}) });
    state.messages.push(created);
    state.byId.set(id, created);
    if (key !== undefined) {
        state.pendingByTurnStep.set(key, created);
        state.turnStepMessage.set(key, created);
    }
    if (target.turn !== undefined)
        state.messageTurn.set(id, target.turn);
}
function findByIdOrSeq(state, event) {
    const data = isRecord(event.data) ? event.data : {};
    const id = pickString(data['id']);
    if (id !== undefined) {
        const byId = state.byId.get(id);
        if (byId !== undefined)
            return byId;
    }
    const seq = pickNumber(data['seq'] ?? data['messageSeq']);
    if (seq !== undefined) {
        return state.messages.find(message => message.seq === seq);
    }
    return undefined;
}
function applyUpdate(state, event) {
    const message = findByIdOrSeq(state, event);
    if (message === undefined)
        return;
    const data = isRecord(event.data) ? event.data : {};
    const text = pickString(data['text']);
    const next = {
        ...message,
        ...(text !== undefined ? { text } : {}),
        seq: event.seq,
        time: event.time,
    };
    replaceMessage(state, message, next);
}
function removeMessage(state, message) {
    const index = state.messages.indexOf(message);
    if (index !== -1)
        state.messages.splice(index, 1);
    state.byId.delete(message.id);
    state.messageTurn.delete(message.id);
    state.toolNames.delete(message.id);
    for (const [key, candidate] of state.turnStepMessage) {
        if (candidate === message)
            state.turnStepMessage.delete(key);
    }
    for (const [key, candidate] of state.pendingByTurnStep) {
        if (candidate === message)
            state.pendingByTurnStep.delete(key);
    }
}
function applyDelete(state, event) {
    const message = findByIdOrSeq(state, event);
    if (message === undefined)
        return;
    removeMessage(state, message);
}
function applyToolCall(state, event) {
    const data = isRecord(event.data) ? event.data : {};
    const name = pickString(data['name']);
    if (name === undefined)
        return;
    const turn = pickNumber(data['turn']);
    const step = pickNumber(data['step']);
    const key = tsKey(turn, step);
    let target = key === undefined ? undefined : state.turnStepMessage.get(key);
    if (target === undefined && turn !== undefined) {
        for (let i = state.messages.length - 1; i >= 0; i--) {
            const candidate = state.messages[i];
            if (candidate !== undefined && candidate.kind === 'assistant' && state.messageTurn.get(candidate.id) === turn) {
                target = candidate;
                break;
            }
        }
    }
    if (target === undefined) {
        for (let i = state.messages.length - 1; i >= 0; i--) {
            const candidate = state.messages[i];
            if (candidate !== undefined && candidate.kind === 'assistant') {
                target = candidate;
                break;
            }
        }
    }
    if (target === undefined)
        return;
    const names = state.toolNames.get(target.id) ?? new Set();
    const isNewName = !names.has(name);
    if (isNewName) {
        names.add(name);
        state.toolNames.set(target.id, names);
    }
    const callId = pickString(data['callId']) ?? `${name}#${String(event.seq)}`;
    const args = pickString(data['arguments']);
    const tools = target.tools ?? [];
    const existingIndex = tools.findIndex(tool => tool.callId === callId);
    const isNewCall = existingIndex === -1;
    const nextTools = isNewCall
        ? [...tools, { callId, name, ...(args !== undefined ? { arguments: args } : {}) }]
        : tools.map((tool, index) => index === existingIndex
            ? { ...tool, ...(args !== undefined ? { arguments: args } : {}) }
            : tool);
    const next = completedAware(state, {
        ...target,
        ...(isNewName ? { toolSummary: `使用 ${[...names].join(' / ')}` } : {}),
        ...(isNewCall || args !== undefined ? { tools: nextTools } : {}),
        ...(turn !== undefined ? { turn } : {}),
        seq: event.seq,
        time: event.time,
    });
    replaceMessage(state, target, next);
    retargetTurnStep(state, key, target, next);
}
function applyTurnEnd(state, event) {
    const data = isRecord(event.data) ? event.data : {};
    const turn = pickNumber(data['turn']);
    const reason = isRecord(data['reason']) ? data['reason'] : {};
    const failed = reason['kind'] === 'error';
    if (turn !== undefined)
        state.completedTurns.add(turn);
    let targets;
    if (turn !== undefined) {
        targets = state.messages.filter(message => message.kind === 'assistant' && state.messageTurn.get(message.id) === turn);
    }
    else {
        targets = state.messages.filter(message => message.kind === 'assistant');
    }
    if (targets.length === 0) {
        for (let i = state.messages.length - 1; i >= 0; i--) {
            const candidate = state.messages[i];
            if (candidate !== undefined && candidate.kind === 'assistant') {
                targets = [candidate];
                break;
            }
        }
    }
    for (const message of targets) {
        const wasPending = message.pending === true;
        replaceMessage(state, message, {
            ...message,
            ...(wasPending ? { pending: false } : {}),
            ...(failed ? { failed: true } : {}),
            // The turn closed: fold these messages behind 已处理 once rendered.
            ...(turn !== undefined ? { turn } : {}),
            turnEnded: true,
            // Preserve each step's own final-event seq. Collapsing every message
            // onto turn/end makes same-turn ordering depend on arbitrary ids.
            time: event.time,
        });
    }
}
/**
 * Fold a batch of session events into a renderable message list.
 *
 * @param events - events to apply, in any order (folded by ascending seq).
 * @param existing - the previously rendered list (live-stream incremental tail).
 * @returns messages sorted by seq.
 */
export function foldEvents(events, existing) {
    return new EventFolder(existing).fold(events);
}
/**
 * Incremental folder for one message stream. Live chat folds one event at a
 * time; rebuilding the five index maps by scanning every message per event
 * made that path O(n) per event (O(n * events) per turn). A folder keeps the
 * indexes alive across folds, applies each event in O(1) map operations, and
 * returns the previous snapshot identity unchanged when nothing applied, so
 * React skips the re-render entirely. Replayed events are no-ops: the maxSeq
 * watermark advanced by the first application skips them, which also makes a
 * double-invoked React state updater harmless.
 */
export class EventFolder {
    state;
    snapshotList;
    /** @param initial - seed rows (history tail load); omit for an empty stream. */
    constructor(initial) {
        this.state = createState(initial);
    }
    /** Fold one batch incrementally; returns the current snapshot list. */
    fold(events) {
        const sorted = [...events].sort((a, b) => a.seq - b.seq);
        let applied = false;
        for (const event of sorted) {
            if (event.seq <= this.state.maxSeq)
                continue;
            applyEvent(this.state, event);
            applied = true;
        }
        if (!applied && this.snapshotList !== undefined)
            return this.snapshotList;
        this.snapshotList = snapshotOf(this.state);
        return this.snapshotList;
    }
    /** Replace the whole stream (history reload / session switch). */
    seed(messages) {
        this.state = createState(messages);
        this.snapshotList = undefined;
    }
    /** Prepend an older history page (exact seam; no overlapping seqs). */
    prepend(older) {
        this.state = createState([...older, ...this.state.messages]);
        // Head messages of a turn whose tail already completed in an earlier
        // batch (its turn/end lives on a newer page) join the completed fold:
        // without this the older half of a split turn would render unfolded.
        for (const message of older) {
            if (message.kind !== 'assistant' || message.turnEnded === true)
                continue;
            const turn = message.turn;
            if (turn === undefined || !this.state.completedTurns.has(turn))
                continue;
            replaceMessage(this.state, message, { ...message, turnEnded: true });
        }
        this.snapshotList = undefined;
    }
    /** Current snapshot list; a fresh copy whenever the folder changed. */
    snapshot() {
        if (this.snapshotList !== undefined)
            return this.snapshotList;
        this.snapshotList = snapshotOf(this.state);
        return this.snapshotList;
    }
}
/**
 * Does a contiguous raw event range start at a turn boundary? The host
 * pages history by message count, so the oldest edge of a page can land
 * mid-turn; loading older pages until this returns true keeps every loaded
 * chunk a whole turn, which the completed-turn fold (已处理) needs. A user
 * prompt, a turn/start, or a turn/end at the edge are all valid boundaries.
 */
export function rangeStartsAtTurnBoundary(events) {
    const started = new Set();
    for (const event of events) {
        if (event.type !== 'turn/start')
            continue;
        const turn = isRecord(event.data) ? pickNumber(event.data['turn']) : undefined;
        if (turn !== undefined)
            started.add(turn);
    }
    for (const event of events) {
        if (event.type === 'user/message' || event.type === 'turn/start' || event.type === 'turn/end') {
            return true;
        }
        if (event.type === 'assistant/message'
            || event.type === 'assistant/chunk'
            || event.type === 'message/chunk'
            || event.type === 'message/update'
            || event.type === 'tool/call') {
            const turn = isRecord(event.data) ? pickNumber(event.data['turn']) : undefined;
            // A message without a turn is not interior to any turn: treat as a boundary.
            if (turn === undefined)
                return true;
            return started.has(turn);
        }
    }
    return true;
}
/** Copy the folder's rows and keep them seq-ordered (skips re-sorting the common ordered case). */
function snapshotOf(state) {
    const out = [...state.messages];
    let ordered = true;
    for (let index = 1; index < out.length; index += 1) {
        const prev = out[index - 1];
        const current = out[index];
        if (prev.seq > current.seq) {
            ordered = false;
            break;
        }
    }
    // Array.sort is stable: equal-seq rows keep their event insertion order.
    return ordered ? out : out.sort((a, b) => a.seq - b.seq);
}
