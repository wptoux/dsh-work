/**
 * Pull-to-load-older gesture for the chat history scroller.
 *
 * The mobile page fills exactly one viewport and each view owns an inner
 * scroll region, so a downward overscroll would otherwise fall through to
 * the browser's native pull-to-refresh and reload the whole /m page
 * (losing the chat position). This hook intercepts that gesture: a
 * downward drag that starts while the scroller is at the very top arms a
 * "release to load older messages" state past a small threshold, and
 * releasing it loads the previous history page. The gesture is inert
 * when there is no older page (`hasOlder: false`) or a load is already
 * in flight, and the browser never sees the overscroll either way.
 *
 * Listeners attach natively with `passive: false`, because React's
 * delegated touchmove is passive and cannot prevent the browser's
 * pull-to-refresh.
 */
/** Pull feedback states: idle → pulling (below the release threshold). */
export type PullHint = 'idle' | 'pulling' | 'ready';
export interface PullToOlderOptions {
    /** Whether an older page exists; the gesture is inert when false. */
    hasOlder: boolean;
    /** True while an older page load is in flight; the gesture is inert. */
    loading: boolean;
    /** Load the previous history page. */
    onLoad(): void;
}
/** Drag distance (after resistance) that arms the ready state. */
export declare const PULL_READY_DISTANCE = 64;
/** Resistance factor applied to the raw drag distance (rubber-band feel). */
export declare const PULL_RESISTANCE = 0.5;
/**
 * Attach the pull-to-load-older gesture to a scrollable element.
 * @param elementRef - the scrollable history element (nullable current).
 * @param options - hasOlder/loading flags and the load action.
 * @returns the current pull hint, for the surface's feedback row.
 */
export declare function usePullToOlder(elementRef: {
    readonly current: HTMLElement | null | undefined;
}, options: PullToOlderOptions): PullHint;
//# sourceMappingURL=pull-to-older.d.ts.map