/**
 * Fold chrome: the DOM observation + click delegation the driver needs.
 *
 * Watches <body> for `[data-chat-flow]` columns (added/removed at any depth),
 * attaches a childList observer to each live column so structural changes
 * (new rows, prepended history, remounts) re-trigger the fold pass, and
 * delegates clicks on「已处理」headers into the driver's toggle. All wiring is
 * tracked per container and torn down by the returned disposer (HMR-safe).
 */
export interface FoldChrome {
    /** Live set of observed flow containers. */
    containers(): readonly HTMLElement[];
    /** Attach the body observer; returns the disposer. */
    start(): () => void;
}
export declare function createFoldChrome(onChange: () => void, onHeaderClick: (turn: number) => void): FoldChrome;
//# sourceMappingURL=fold-chrome.d.ts.map