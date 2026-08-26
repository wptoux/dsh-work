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
import { type FoldWindow } from './fold-plan';
import { type FoldCopy } from './fold-dom';
/** Narrowed snapshot shape the driver consumes (projected by the client entry from the real ConversationSnapshot). */
export interface DriverNode {
    readonly kind: string;
    readonly anchorSeq: number;
    readonly location?: {
        readonly kind: 'turn' | 'step' | 'session' | 'unresolved';
        readonly turn?: number;
    };
}
export interface DriverSnapshot {
    readonly openState: 'cold' | 'loading' | 'open' | 'error';
    readonly hasMore: boolean;
    readonly loadingOlder: boolean;
    /** Turn boundary timestamps (Unix epoch ms); a missing start/end means the boundary is outside the window. */
    readonly turns: ReadonlyMap<number, {
        readonly startTime?: number;
        readonly endTime?: number;
    }>;
    readonly order: readonly string[];
    readonly nodes: {
        get(key: string): DriverNode | undefined;
    };
}
/** The minimal session face the driver needs. */
export interface FoldSessionHandle {
    readonly sessionId: string;
    snapshot(): DriverSnapshot | null;
    loadOlder(): Promise<unknown>;
}
/** Change source: notifies when the current session or its snapshot changes. */
export interface FoldSessionSource {
    current(): FoldSessionHandle | null;
    subscribe(fn: () => void): () => void;
}
export interface FoldDriverOptions {
    /** Live list of `[data-chat-flow]` containers to fold. */
    containers(): readonly HTMLElement[];
    copy: FoldCopy;
    /** Cap on consecutive automatic completion loads (safety valve). */
    maxAutoPages?: number;
}
export interface FoldDriver {
    /** Re-plan and apply now (idempotent). */
    run(): void;
    /** Flip the expanded state of one fold and re-apply. */
    toggle(turn: number): void;
    /** Subscribe to source changes; returns the disposer. */
    start(): () => void;
}
/** Project a DriverSnapshot into the planner's window, or null while not open. */
export declare function windowFromSnapshot(snapshot: DriverSnapshot): FoldWindow | null;
/** Create a fold driver over one session source. */
export declare function createFoldDriver(source: FoldSessionSource, options: FoldDriverOptions): FoldDriver;
/**
 * Scroll the scroller back so the header returns to its captured viewport top
 * (undoing any at-bottom follow shift). Returns whether it scrolled.
 */
export declare function restoreHeaderPosition(header: HTMLElement, capturedTop: number): boolean;
//# sourceMappingURL=fold-driver.d.ts.map