/**
 * DOM application of the fold plan over the chat flow column
 * (`[data-chat-flow]`, see ChatView's column). The driver computes the plan
 * from the session snapshot elsewhere; this module only translates a plan
 * into row markers,「已处理」headers and their expanded state.
 *
 * Everything is idempotent and self-healing: running the same plan twice
 * yields one header, a vanished fold removes its header and markers, and the
 * header is repositioned when React reorders rows around it. The header is a
 * plain <button> we insert as a sibling of the flow rows — React's keyed
 * reconciliation leaves foreign siblings alone, and the driver re-applies on
 * every DOM/snapshot change regardless.
 */
import type { FoldPlan } from './fold-plan';
/** Translated copy the header renders (header is lazy so locale switches apply live). */
export interface FoldCopy {
    /** e.g. () => '已处理' / 'Done'. */
    readonly header: () => string;
    /** e.g. (7) => '7 条' — the hidden-row count badge (incl. tool rows). */
    readonly count: (n: number) => string;
    /** e.g. (196_000) => '3m16s' — the turn's wall-clock duration. */
    readonly duration: (ms: number) => string;
}
/** Compact wall-clock duration: 3m16s / 45s / 1h02m (locale-neutral). */
export declare function formatDuration(ms: number): string;
/** CSS class / attribute vocabulary (plain CSS lives in fold.css, injected by the client entry). */
export declare const FOLD_HEADER_MARKER = "data-dsh-fold-header";
export declare const FOLD_TURN_ATTR = "data-dsh-fold-turn";
export declare const FOLD_ROW_ATTR = "data-dsh-fold-row";
export declare const FOLD_EXPANDED_ATTR = "data-dsh-fold-expanded";
/** Marker on the fold's visible last reply (its think block hides while folded). */
export declare const FOLD_LAST_ATTR = "data-dsh-fold-last";
export declare const FOLD_LAST_EXPANDED_ATTR = "data-dsh-fold-last-expanded";
/**
 * Apply one fold plan to a flow container. Pure DOM — no event wiring (the
 * driver owns the delegated click), no session reads.
 * @param container - the `[data-chat-flow]` column element.
 * @param plan - the current fold plan for the session.
 * @param expanded - turns currently expanded (user state, kept by the driver).
 * @param copy - translated header copy.
 */
export declare function applyFoldPlan(container: HTMLElement, plan: FoldPlan, expanded: ReadonlySet<number>, copy: FoldCopy): void;
//# sourceMappingURL=fold-dom.d.ts.map