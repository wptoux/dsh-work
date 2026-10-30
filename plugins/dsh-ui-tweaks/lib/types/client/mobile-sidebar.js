import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Narrow-screen sidebar drawer: on phone viewports the host's left sidebar
 * — including its collapsed 56px icon rail — is hidden entirely, and a
 * floating DeepSeek whale-logo trigger takes over the top-left corner.
 * Tapping it expands the sidebar through the layout service's official
 * toggle (`ctx.layout.toggleSidebar`), which flips the layout store's
 * `narrowExpanded` flag below the host's 1024px auto-collapse breakpoint;
 * CSS then turns the sidebar column into a fixed overlay drawer over the
 * conversation, backed by a full-screen scrim.
 *
 * Pure DOM + CSS against host facts — no harness changes:
 * - the AppFrame is stamped with plugin-owned data attributes once it
 *   appears. DSH 0.2.x marks the frame with `data-sidebar-collapsed` /
 *   `data-rightbar-collapsed` (0.1.x called the details column
 *   `data-details-collapsed`), and always renders the three columns in DOM
 *   order: sidebar, center, rightbar. The rightbar column carries the stable
 *   `data-rightbar-col` marker, so stamping anchors on it instead of
 *   assuming the sidebar is `children[0]`,
 * - every visual rule lives in `mobile-sidebar.css`, scoped to the stamped
 *   attributes + the frame's own `data-sidebar-collapsed` state and gated
 *   by a `max-width: 767px` media query (the same breakpoint
 *   dsh-better-sidebar uses; at ≥768px the host's native rail keeps its
 *   behavior and the trigger is hidden),
 * - React state only MIRRORS the frame's collapsed attribute (an attribute
 *   observer on the frame), so an expand triggered from anywhere stays in
 *   sync: open + scrim visibility follow the live host state.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { FishLogo } from '@deepseek-ai/dsh-client-ui-primitives';
import './mobile-sidebar.css';
/** Marker stamped onto the host layout frame once (idempotent). */
export const MOBILE_FRAME_ATTR = 'data-dsh-mobile-frame';
/** Marker stamped onto the frame's sidebar column. */
export const MOBILE_SIDEBAR_COL_ATTR = 'data-dsh-mobile-sidebar-col';
/** Marker stamped onto the center (conversation) column. */
export const MOBILE_CENTER_COL_ATTR = 'data-dsh-mobile-center-col';
/** Marker stamped onto the rightbar (0.1.x: details) column. */
export const MOBILE_DETAILS_COL_ATTR = 'data-dsh-mobile-details-col';
/** The trigger/scrim host appended to <body>. */
export const MOBILE_ROOT_ATTR = 'data-dsh-mobile-sidebar-root';
/** Width breakpoint above which the trigger and drawer rules never apply. */
export const NARROW_MAX_WIDTH = 767;
/** Selectors identifying the live AppFrame element by its own attributes. */
const FRAME_ATTRIBUTE_SELECTORS = [
    '[data-sidebar-collapsed]',
    '[data-rightbar-collapsed]',
    '[data-details-collapsed]',
    '[data-dragging]',
];
/**
 * The AppFrame is the only element with an inline three-track grid matching
 * `<px> minmax(0, 1fr) ...`. DSH 0.2.x writes `minmax(0px, 1fr)`, 0.1.x
 * wrote `minmax(0, 1fr)`; accept both (fallback when no collapse attribute
 * is set — e.g. rightbar open on the desktop, never on a phone width).
 */
export function isFrameGrid(style) {
    return /\d+px\s+minmax\(0(?:px)?,\s*1fr\)/.test(style.gridTemplateColumns);
}
/** Find the live AppFrame element (the layout div, not #root). */
export function findMobileFrame() {
    if (typeof document === 'undefined')
        return undefined;
    for (const selector of FRAME_ATTRIBUTE_SELECTORS) {
        const element = document.querySelector(selector);
        if (element instanceof HTMLElement && element.firstElementChild !== null)
            return element;
    }
    const root = document.getElementById('root');
    if (root === null)
        return undefined;
    for (const element of root.querySelectorAll('div')) {
        if (isFrameGrid(element.style))
            return element;
    }
    return undefined;
}
/**
 * Stamp the frame and its three grid columns with plugin-owned markers.
 * The column marks are what let the stylesheet pin each column to a fixed
 * grid line: the sidebar column is hidden (collapsed) or turned into a
 * fixed drawer (expanded), and either state would otherwise pull the
 * remaining columns out of their tracks (CSS auto-placement skips items
 * that leave the flow), collapsing the conversation to zero width.
 * @returns true once the frame is stamped (either now or already).
 */
export function stampMobileFrame() {
    const frame = findMobileFrame();
    if (frame === undefined)
        return false;
    frame.setAttribute(MOBILE_FRAME_ATTR, '');
    // The frame's grid children in DOM order are sidebar, center, rightbar
    // (React fragments add no wrapper; the bottom row, overlay layer and drag
    // handles that follow are absolute / outside the column tracks). Anchor on
    // the rightbar's stable marker and walk back so an extra leading node
    // (e.g. a rendered DocumentTitle portal) cannot shift the stamp targets.
    const children = [...frame.children].filter((node) => node instanceof HTMLElement);
    const rightbar = children.find(node => node.hasAttribute('data-rightbar-col')) ?? children[2];
    const center = rightbar?.previousElementSibling ?? children[1];
    const sidebar = center?.previousElementSibling ?? children[0];
    const columns = [
        [MOBILE_SIDEBAR_COL_ATTR, sidebar ?? undefined],
        [MOBILE_CENTER_COL_ATTR, center ?? undefined],
        [MOBILE_DETAILS_COL_ATTR, rightbar ?? undefined],
    ];
    for (const [attribute, node] of columns) {
        if (node instanceof HTMLElement)
            node.setAttribute(attribute, '');
    }
    return true;
}
/** The floating whale-logo trigger + the full-screen scrim. */
function MobileSidebarShell({ open, label, onToggle }) {
    return (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", "data-dsh-mobile-trigger": "", "aria-label": label, title: label, "aria-expanded": open, onClick: onToggle, children: _jsx(FishLogo, { size: 24 }) }), _jsx("button", { type: "button", "data-dsh-mobile-scrim": "", "aria-hidden": "true", tabIndex: -1, onClick: onToggle }), _jsx("div", { "data-dsh-mobile-top-fade": "", "aria-hidden": "true" })] }));
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
export function mountMobileSidebar(options) {
    const container = document.createElement('div');
    container.setAttribute(MOBILE_ROOT_ATTR, '');
    document.body.appendChild(container);
    const root = createRoot(container);
    const isOpen = () => {
        const frame = findMobileFrame();
        return frame !== undefined && frame.getAttribute('data-sidebar-collapsed') === null;
    };
    let open = isOpen();
    const render = () => {
        // The scrim's visibility keys off this attribute (see the stylesheet);
        // React state stays a mirror of the live frame state.
        if (open)
            container.setAttribute('data-dsh-mobile-open', 'true');
        else
            container.removeAttribute('data-dsh-mobile-open');
        root.render(createElement(MobileSidebarShell, {
            open,
            label: options.label,
            onToggle: () => { options.toggleSidebar(); },
        }));
    };
    // Until the frame appears, watch the body for it; afterwards only observe
    // the frame's collapse attribute (the drawer state mirror).
    let observer;
    const frameChange = () => {
        const next = isOpen();
        if (next !== open) {
            open = next;
            render();
        }
    };
    const watchFrame = (frame) => {
        observer?.disconnect();
        observer = new MutationObserver(frameChange);
        observer.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] });
    };
    const bodyChange = () => {
        if (!stampMobileFrame())
            return;
        observer?.disconnect();
        const frame = findMobileFrame();
        if (frame !== undefined)
            watchFrame(frame);
        frameChange();
    };
    try {
        observer = new MutationObserver(bodyChange);
        observer.observe(document.body, { childList: true, subtree: true });
    }
    catch {
        observer = undefined;
    }
    if (stampMobileFrame()) {
        const frame = findMobileFrame();
        if (frame !== undefined)
            watchFrame(frame);
    }
    render();
    return {
        dispose() {
            observer?.disconnect();
            root.unmount();
            container.remove();
        },
    };
}
