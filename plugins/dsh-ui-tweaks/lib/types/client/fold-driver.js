/**
 * Fold driver: the orchestrator between the session snapshot, the pure fold
 * planner, and the DOM applier.
 *
 * The client entry wires the observation side (body/container mutation
 * observers, delegated header clicks, session subscriptions) and calls
 * {@link FoldDriver.run} on every change; this driver owns:
 *
 * - projecting the session snapshot into the planner's window,
 * - translating plans into DOM folds (per flow container),
 * - auto-loading older history — once, capped — when a closed turn's head
 *   sits outside the window (page-split turns must complete before folding),
 * - the per-session expanded set (reset on session switch).
 */
import { planFolds } from './fold-plan';
import { applyFoldPlan } from './fold-dom';
/** Project a DriverSnapshot into the planner's window, or null while not open. */
export function windowFromSnapshot(snapshot) {
    if (snapshot.openState !== 'open')
        return null;
    const turns = new Map();
    for (const [number, t] of snapshot.turns) {
        const startLoaded = t.startTime !== undefined;
        const endLoaded = t.endTime !== undefined;
        turns.set(number, {
            turn: number,
            startLoaded,
            endLoaded,
            ...startLoaded && endLoaded ? { durationMs: Math.max(0, t.endTime - t.startTime) } : {},
        });
    }
    const nodes = [];
    for (const key of snapshot.order) {
        const node = snapshot.nodes.get(key);
        if (node === undefined)
            continue;
        nodes.push({ key, kind: node.kind, anchorSeq: node.anchorSeq, turn: node.location?.turn });
    }
    return { turns, nodes, hasMore: snapshot.hasMore, loadingOlder: snapshot.loadingOlder };
}
const EMPTY_PLAN = { folds: [], completionRequest: null };
/** Create a fold driver over one session source. */
export function createFoldDriver(source, options) {
    const maxAutoPages = options.maxAutoPages ?? 5;
    let expanded = new Set();
    let currentSessionId = null;
    let olderInFlight = false;
    let autoPages = 0;
    const clean = () => {
        for (const container of options.containers()) {
            applyFoldPlan(container, EMPTY_PLAN, expanded, options.copy);
        }
    };
    const run = () => {
        const handle = source.current();
        if (handle === null) {
            currentSessionId = null;
            expanded = new Set();
            clean();
            return;
        }
        if (handle.sessionId !== currentSessionId) {
            currentSessionId = handle.sessionId;
            expanded = new Set();
        }
        const snapshot = handle.snapshot();
        if (snapshot === null) {
            clean();
            return;
        }
        const window = windowFromSnapshot(snapshot);
        const plan = window === null ? EMPTY_PLAN : planFolds(window);
        if (plan.completionRequest === null)
            autoPages = 0;
        for (const container of options.containers()) {
            applyFoldPlan(container, plan, expanded, options.copy);
        }
        if (plan.completionRequest !== null && !olderInFlight && autoPages < maxAutoPages) {
            autoPages += 1;
            olderInFlight = true;
            void handle.loadOlder().finally(() => {
                olderInFlight = false;
                run();
            });
        }
    };
    const toggle = (turn) => {
        const next = new Set(expanded);
        if (next.has(turn))
            next.delete(turn);
        else
            next.add(turn);
        expanded = next;
        const header = findFoldHeader(options.containers(), turn);
        // Capture the header's viewport top BEFORE the re-apply: the chat's
        // at-bottom scroll-follow (ResizeObserver, delivered after layout) pins
        // the view to the new bottom on toggle, shifting the header up by the
        // layout delta. Restore its exact position once the follow has settled
        // (rAF2 runs after the observer callbacks — a single rAF is undone by it).
        const captured = header !== null && header.isConnected && header.parentElement !== null
            ? { header, top: header.getBoundingClientRect().top, scroller: scrollerOf(header.parentElement) }
            : null;
        run();
        if (captured !== null && captured.scroller !== null && typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                if (!captured.header.isConnected)
                    return;
                requestAnimationFrame(() => {
                    if (captured.header.isConnected)
                        restoreHeaderPosition(captured.header, captured.top);
                });
            });
        }
    };
    const start = () => {
        run();
        return source.subscribe(run);
    };
    return { run, toggle, start };
}
/** The scroll container the header moves in (the ChatView scroll column). */
function scrollerOf(container) {
    return container.closest('[data-conversation-scroll]') ?? container.parentElement ?? null;
}
/**
 * Scroll the scroller back so the header returns to its captured viewport top
 * (undoing any at-bottom follow shift). Returns whether it scrolled.
 */
export function restoreHeaderPosition(header, capturedTop) {
    const container = header.parentElement;
    if (container === null)
        return false;
    const scroller = scrollerOf(container);
    if (scroller === null)
        return false;
    const delta = header.getBoundingClientRect().top - capturedTop;
    if (delta !== 0) {
        scroller.scrollTop += delta;
        return true;
    }
    return false;
}
function findFoldHeader(containers, turn) {
    for (const container of containers) {
        for (const child of container.children) {
            const el = child;
            if (el.hasAttribute('data-dsh-fold-header') && el.getAttribute('data-dsh-fold-turn') === String(turn)) {
                return el;
            }
        }
    }
    return null;
}
