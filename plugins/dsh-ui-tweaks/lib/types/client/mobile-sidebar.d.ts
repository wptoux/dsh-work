import './mobile-sidebar.css';
/** Marker stamped onto the host layout frame once (idempotent). */
export declare const MOBILE_FRAME_ATTR = "data-dsh-mobile-frame";
/** Marker stamped onto the frame's first child, the sidebar column. */
export declare const MOBILE_SIDEBAR_COL_ATTR = "data-dsh-mobile-sidebar-col";
/** Marker stamped onto the center (conversation) column. */
export declare const MOBILE_CENTER_COL_ATTR = "data-dsh-mobile-center-col";
/** Marker stamped onto the details column. */
export declare const MOBILE_DETAILS_COL_ATTR = "data-dsh-mobile-details-col";
/** The trigger/scrim host appended to <body>. */
export declare const MOBILE_ROOT_ATTR = "data-dsh-mobile-sidebar-root";
/** The layout service face this module consumes (structural, no import). */
export interface MobileLayoutFace {
    /** Toggle the sidebar (closed ⟷ contract default width / narrowExpanded). */
    toggleSidebar(): void;
}
/** Width breakpoint above which the trigger and drawer rules never apply. */
export declare const NARROW_MAX_WIDTH = 767;
/**
 * The AppFrame is the only element with an inline three-track grid matching
 * `<px> minmax(0, 1fr) <px>` (fallback when no collapse attribute is set —
 * e.g. details open on the desktop, which never happens on a phone width).
 */
export declare function isFrameGrid(style: CSSStyleDeclaration): boolean;
/** Find the live AppFrame element (the layout div, not #root). */
export declare function findMobileFrame(): HTMLElement | undefined;
/**
 * Stamp the frame and its three grid columns with plugin-owned markers.
 * The column marks are what let the stylesheet pin each column to a fixed
 * grid line: the sidebar column is hidden (collapsed) or turned into a
 * fixed drawer (expanded), and either state would otherwise pull the
 * remaining columns out of their tracks (CSS auto-placement skips items
 * that leave the flow), collapsing the conversation to zero width.
 * @returns true once the frame is stamped (either now or already).
 */
export declare function stampMobileFrame(): boolean;
/** Mount options (the caller supplies the layout face via ctx.get('layout')). */
export interface MobileSidebarMountOptions {
    /** Toggle the sidebar (the layout service's official action). */
    toggleSidebar(): void;
    /** Accessible label for the trigger (i18n). */
    label: string;
}
/** Disposer for a mounted drawer. */
export interface MobileSidebarHandle {
    dispose(): void;
}
/**
 * Mount the drawer into <body>. The trigger and scrim are fixed elements
 * hidden entirely at ≥768px by CSS; at phone widths the frame is stamped and
 * its collapsed attribute is mirrored onto the shell so the scrim shows only
 * while the drawer is open. The layout service is read per click so a late
 * service arrival still works.
 * @param options - toggle action + i18n label.
 * @returns a disposer (HMR-safe).
 */
export declare function mountMobileSidebar(options: MobileSidebarMountOptions): MobileSidebarHandle;
//# sourceMappingURL=mobile-sidebar.d.ts.map