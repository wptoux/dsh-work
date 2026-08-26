/**
 * Pure fold-plan computation for the desktop chat flow.
 *
 * Given an immutable view of the current chat window (turns with their loaded
 * turn/start · turn/end boundaries plus the flow-ordered nodes), decides:
 *
 * - which completed, whole turns fold into a「已处理」block,
 * - which flow rows hide inside each fold (everything up to — but excluding —
 *   the turn's last assistant message, minus user/steering prompts), and
 * - whether the head of a closed turn sits outside the window, which means
 *   older history should be pulled so the turn can complete and fold.
 *
 * The desktop session window is contiguous, so a turn is *whole* exactly when
 * both its turn/start and turn/end events are loaded. A closed turn whose
 * turn/start is missing is a page-split turn: it must never be half-folded —
 * it stays unfolded until the head loads in (mirroring the mobile client's
 * "expand the load range to the turn boundary" fix).
 */
/** Prompt roles that a fold must never hide (the user's own words). */
const PROMPT_KINDS = new Set(['user', 'steering']);
/** The chat-node kind of assistant message rows. */
export const ASSISTANT_KIND = 'assistant-step';
/** Compute the fold plan for one window pass. Pure — no side effects. */
export function planFolds(window) {
    const folds = [];
    let completionRequest = null;
    const byTurn = new Map();
    for (const node of window.nodes) {
        if (node.turn === undefined)
            continue;
        const list = byTurn.get(node.turn);
        if (list === undefined)
            byTurn.set(node.turn, [node]);
        else
            list.push(node);
    }
    const turnNumbers = [...window.turns.keys()].sort((a, b) => a - b);
    for (const number of turnNumbers) {
        const t = window.turns.get(number);
        if (t === undefined)
            continue;
        if (!t.endLoaded)
            continue; // open (streaming) turn — never folded
        if (!t.startLoaded) {
            // Closed but page-split: never half-fold. Request the head only for the
            // oldest such turn, once, when history exists and nothing is in flight.
            if (completionRequest === null && window.hasMore && !window.loadingOlder) {
                completionRequest = { turn: number };
            }
            continue;
        }
        const nodes = byTurn.get(number) ?? [];
        const assistants = nodes.filter(n => n.kind === ASSISTANT_KIND);
        if (assistants.length === 0)
            continue; // nothing to fold
        const last = assistants.reduce((max, n) => (n.anchorSeq > max.anchorSeq ? n : max), assistants[0]);
        const hiddenKeys = nodes
            .filter(n => n.anchorSeq < last.anchorSeq && !PROMPT_KINDS.has(n.kind))
            .map(n => n.key);
        folds.push({
            turn: number,
            hiddenKeys,
            lastAssistantKey: last.key,
            hiddenCount: hiddenKeys.length,
            ...t.durationMs === undefined ? {} : { durationMs: t.durationMs },
        });
    }
    return { folds, completionRequest };
}
