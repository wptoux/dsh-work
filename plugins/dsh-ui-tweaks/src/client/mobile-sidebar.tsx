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
 *   appears (the frame carries `data-sidebar-collapsed` /
 *   `data-details-collapsed` or an inline three-track
 *   `gridTemplateColumns`; its grid children in DOM order are the sidebar,
 *   center, and details columns — verified against the served shell markup),
 * - every visual rule lives in `mobile-sidebar.css`, scoped to the stamped
 *   attributes + the frame's own `data-sidebar-collapsed` state and gated
 *   by a `max-width: 767px` media query (the same breakpoint
 *   dsh-better-sidebar uses; at ≥768px the host's native rail keeps its
 *   behavior and the trigger is hidden),
 * - React state only MIRRORS the frame's collapsed attribute (an attribute
 *   observer on the frame), so an expand triggered from anywhere stays in
 *   sync: open + scrim visibility follow the live host state.
 */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import './mobile-sidebar.css'

/** Marker stamped onto the host layout frame once (idempotent). */
export const MOBILE_FRAME_ATTR = 'data-dsh-mobile-frame'
/** Marker stamped onto the frame's first child, the sidebar column. */
export const MOBILE_SIDEBAR_COL_ATTR = 'data-dsh-mobile-sidebar-col'
/** Marker stamped onto the center (conversation) column. */
export const MOBILE_CENTER_COL_ATTR = 'data-dsh-mobile-center-col'
/** Marker stamped onto the details column. */
export const MOBILE_DETAILS_COL_ATTR = 'data-dsh-mobile-details-col'
/** The trigger/scrim host appended to <body>. */
export const MOBILE_ROOT_ATTR = 'data-dsh-mobile-sidebar-root'

/** The layout service face this module consumes (structural, no import). */
export interface MobileLayoutFace {
  /** Toggle the sidebar (closed ⟷ contract default width / narrowExpanded). */
  toggleSidebar(): void
}

/** Width breakpoint above which the trigger and drawer rules never apply. */
export const NARROW_MAX_WIDTH = 767

/** Selectors identifying the live AppFrame element by its own attributes. */
const FRAME_ATTRIBUTE_SELECTORS = [
  '[data-sidebar-collapsed]',
  '[data-details-collapsed]',
  '[data-dragging]',
] as const

/**
 * The AppFrame is the only element with an inline three-track grid matching
 * `<px> minmax(0, 1fr) <px>` (fallback when no collapse attribute is set —
 * e.g. details open on the desktop, which never happens on a phone width).
 */
export function isFrameGrid(style: CSSStyleDeclaration): boolean {
  return /px\s+minmax\(0,\s*1fr\)/.test(style.gridTemplateColumns)
}

/** Find the live AppFrame element (the layout div, not #root). */
export function findMobileFrame(): HTMLElement | undefined {
  if (typeof document === 'undefined') return undefined
  for (const selector of FRAME_ATTRIBUTE_SELECTORS) {
    const element = document.querySelector(selector)
    if (element instanceof HTMLElement && element.firstElementChild !== null) return element
  }
  const root = document.getElementById('root')
  if (root === null) return undefined
  for (const element of root.querySelectorAll('div')) {
    if (isFrameGrid(element.style)) return element
  }
  return undefined
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
export function stampMobileFrame(): boolean {
  const frame = findMobileFrame()
  if (frame === undefined) return false
  frame.setAttribute(MOBILE_FRAME_ATTR, '')
  const columns = [MOBILE_SIDEBAR_COL_ATTR, MOBILE_CENTER_COL_ATTR, MOBILE_DETAILS_COL_ATTR]
  // DOM order of the frame's grid children (verified against the served
  // shell): sidebar column, center column, details column — React fragments
  // add no wrapper node; the overlay layer and drag handles that follow are
  // absolute and stay out of the grid flow.
  for (let index = 0; index < columns.length; index += 1) {
    const node = frame.children[index]
    if (node instanceof HTMLElement) node.setAttribute(columns[index], '')
  }
  return true
}

/** Mount options (the caller supplies the layout face via ctx.get('layout')). */
export interface MobileSidebarMountOptions {
  /** Toggle the sidebar (the layout service's official action). */
  toggleSidebar(): void
  /** Accessible label for the trigger (i18n). */
  label: string
}

/** Disposer for a mounted drawer. */
export interface MobileSidebarHandle {
  dispose(): void
}

/** The floating whale-logo trigger + the full-screen scrim. */
function MobileSidebarShell({ open, label, onToggle }: {
  open: boolean
  label: string
  onToggle(): void
}) {
  return (
    <>
      <button
        type="button"
        data-dsh-mobile-trigger=""
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={onToggle}
      >
        <FishLogo size={24} />
      </button>
      <button
        type="button"
        data-dsh-mobile-scrim=""
        aria-hidden="true"
        tabIndex={-1}
        onClick={onToggle}
      />
      <div data-dsh-mobile-top-fade="" aria-hidden="true" />
    </>
  )
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
export function mountMobileSidebar(options: MobileSidebarMountOptions): MobileSidebarHandle {
  const container = document.createElement('div')
  container.setAttribute(MOBILE_ROOT_ATTR, '')
  document.body.appendChild(container)
  const root = createRoot(container)

  const isOpen = (): boolean => {
    const frame = findMobileFrame()
    return frame !== undefined && frame.getAttribute('data-sidebar-collapsed') === null
  }

  let open = isOpen()
  const render = (): void => {
    // The scrim's visibility keys off this attribute (see the stylesheet);
    // React state stays a mirror of the live frame state.
    if (open) container.setAttribute('data-dsh-mobile-open', 'true')
    else container.removeAttribute('data-dsh-mobile-open')
    root.render(createElement(MobileSidebarShell, {
      open,
      label: options.label,
      onToggle: () => { options.toggleSidebar() },
    }))
  }

  // Until the frame appears, watch the body for it; afterwards only observe
  // the frame's collapse attribute (the drawer state mirror).
  let observer: MutationObserver | undefined
  const frameChange = (): void => {
    const next = isOpen()
    if (next !== open) {
      open = next
      render()
    }
  }
  const watchFrame = (frame: HTMLElement): void => {
    observer?.disconnect()
    observer = new MutationObserver(frameChange)
    observer.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
  }
  const bodyChange = (): void => {
    if (!stampMobileFrame()) return
    observer?.disconnect()
    const frame = findMobileFrame()
    if (frame !== undefined) watchFrame(frame)
    frameChange()
  }
  try {
    observer = new MutationObserver(bodyChange)
    observer.observe(document.body, { childList: true, subtree: true })
  } catch {
    observer = undefined
  }
  if (stampMobileFrame()) {
    const frame = findMobileFrame()
    if (frame !== undefined) watchFrame(frame)
  }
  render()

  return {
    dispose(): void {
      observer?.disconnect()
      root.unmount()
      container.remove()
    },
  }
}