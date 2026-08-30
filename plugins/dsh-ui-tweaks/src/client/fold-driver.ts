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
 * - anchoring the reader's viewport around fold layout changes (manual
 *   toggles pin the clicked「已处理」header; auto re-applies — completed
 *   turns folding in late, re-applies after slow `loadOlder()` pages — pin
 *   the nearest visible row, except while the reader is pinned to the
 *   bottom where the host's follow already keeps the view there), so slow
 *   arrivals (weak networks) never slide the content under the reader,
 * - anchoring the reader across fold-driven `loadOlder()` cycles: the host
 *   only armors its own prepend anchor when the load-older BUTTON is used,
 *   so pages this driver pulls in land un-stabilized — the driver captures
 *   a visible row + the column's first-row fingerprint when it starts a
 *   load and restores the row once the prepend appears (dropping the
 *   anchor if the reader scrolls meanwhile, delegating to their intent),
 * - auto-loading older history — once, capped — when a closed turn's head
 *   sits outside the window (page-split turns must complete before folding),
 * - the per-session expanded set (reset on session switch).
 */
import { planFolds, type FoldNode, type FoldTurn, type FoldWindow } from './fold-plan'
import { applyFoldPlan, type FoldCopy } from './fold-dom'

/** Narrowed snapshot shape the driver consumes (projected by the client entry from the real ConversationSnapshot). */
export interface DriverNode {
  readonly kind: string
  readonly anchorSeq: number
  readonly location?: { readonly kind: 'turn' | 'step' | 'session' | 'unresolved'; readonly turn?: number }
}

export interface DriverSnapshot {
  readonly openState: 'cold' | 'loading' | 'open' | 'error'
  readonly hasMore: boolean
  readonly loadingOlder: boolean
  /** Turn boundary timestamps (Unix epoch ms); a missing start/end means the boundary is outside the window. */
  readonly turns: ReadonlyMap<number, { readonly startTime?: number; readonly endTime?: number }>
  readonly order: readonly string[]
  readonly nodes: { get(key: string): DriverNode | undefined }
}

/** The minimal session face the driver needs. */
export interface FoldSessionHandle {
  readonly sessionId: string
  snapshot(): DriverSnapshot | null
  loadOlder(): Promise<unknown>
}

/** Change source: notifies when the current session or its snapshot changes. */
export interface FoldSessionSource {
  current(): FoldSessionHandle | null
  subscribe(fn: () => void): () => void
}

export interface FoldDriverOptions {
  /** Live list of `[data-chat-flow]` containers to fold. */
  containers(): readonly HTMLElement[]
  copy: FoldCopy
  /** Cap on consecutive automatic completion loads (safety valve). */
  maxAutoPages?: number
}

export interface FoldDriver {
  /** Re-plan and apply now (idempotent). */
  run(): void
  /** Flip the expanded state of one fold and re-apply. */
  toggle(turn: number): void
  /** Subscribe to source changes; returns the disposer. */
  start(): () => void
}

/** Matches the host ChatView's bottom-follow threshold (px). */
const BOTTOM_FOLLOW_THRESHOLD = 24

/** A captured viewport anchor: restore this element to its pre-change screen top. */
interface AnchorCapture {
  readonly el: HTMLElement
  readonly top: number
}

/**
 * A prepend anchor armed while a fold-driven `loadOlder()` is in flight:
 * the row the reader was on plus the column's first flow-row key, so the
 * driver can tell when the fetched page actually landed in the DOM.
 */
interface PendingLoadAnchor {
  readonly el: HTMLElement
  readonly top: number
  readonly firstKey: string | null
}

/** Project a DriverSnapshot into the planner's window, or null while not open. */
export function windowFromSnapshot(snapshot: DriverSnapshot): FoldWindow | null {
  if (snapshot.openState !== 'open') return null
  const turns = new Map<number, FoldTurn>()
  for (const [number, t] of snapshot.turns) {
    const startLoaded = t.startTime !== undefined
    const endLoaded = t.endTime !== undefined
    turns.set(number, {
      turn: number,
      startLoaded,
      endLoaded,
      ...startLoaded && endLoaded ? { durationMs: Math.max(0, (t.endTime as number) - (t.startTime as number)) } : {},
    })
  }
  const nodes: FoldNode[] = []
  for (const key of snapshot.order) {
    const node = snapshot.nodes.get(key)
    if (node === undefined) continue
    nodes.push({ key, kind: node.kind, anchorSeq: node.anchorSeq, turn: node.location?.turn })
  }
  return { turns, nodes, hasMore: snapshot.hasMore, loadingOlder: snapshot.loadingOlder }
}

const EMPTY_PLAN = { folds: [], completionRequest: null } as const

/** Create a fold driver over one session source. */
export function createFoldDriver(source: FoldSessionSource, options: FoldDriverOptions): FoldDriver {
  const maxAutoPages = options.maxAutoPages ?? 5
  let expanded = new Set<number>()
  let currentSessionId: string | null = null
  let olderInFlight = false
  let autoPages = 0
  /** Armed per container while a fold-driven loadOlder page is in flight. */
  const pendingLoad = new Map<HTMLElement, PendingLoadAnchor>()
  const pendingScrollOff = new Map<HTMLElement, () => void>()

  const clearPendingLoad = (container: HTMLElement): void => {
    pendingLoad.delete(container)
    pendingScrollOff.get(container)?.()
    pendingScrollOff.delete(container)
  }

  const clearAllPendingLoads = (): void => {
    for (const container of [...pendingLoad.keys()]) clearPendingLoad(container)
  }

  const clean = (): void => {
    for (const container of options.containers()) {
      applyFoldPlan(container, EMPTY_PLAN, expanded, options.copy)
    }
  }

  /**
   * Re-plan and apply. `toggleTurn` marks a manual toggle: its header is
   * anchored (restored to its pre-toggle viewport top) so the click target
   * never slides, explicitly overriding the at-bottom follow. Auto re-applies
   * (no `toggleTurn`) anchor a visible row and only compensate while the
   * reader is not pinned to the bottom — the host follow already keeps the
   * view there. Compensation runs only when the apply actually changed layout.
   */
  const run = (toggleTurn?: number): void => {
    const handle = source.current()
    if (handle === null) {
      currentSessionId = null
      expanded = new Set()
      clearAllPendingLoads()
      clean()
      return
    }
    if (handle.sessionId !== currentSessionId) {
      currentSessionId = handle.sessionId
      expanded = new Set()
      clearAllPendingLoads()
    }
    const snapshot = handle.snapshot()
    if (snapshot === null) {
      clearAllPendingLoads()
      clean()
      return
    }
    const window = windowFromSnapshot(snapshot)
    const plan = window === null ? EMPTY_PLAN : planFolds(window)
    if (plan.completionRequest === null) autoPages = 0
    // Row keys the plan will hide (collapsed folds only): an anchor must
    // never be picked from a row that is about to leave the layout.
    const toHide = new Set<string>()
    for (const fold of plan.folds) {
      if (expanded.has(fold.turn)) continue
      for (const key of fold.hiddenKeys) toHide.add(key)
    }
    for (const container of options.containers()) {
      const scroller = scrollerOf(container)
      const manual = toggleTurn !== undefined
      const anchor = manual
        ? foldHeaderAnchor(container, toggleTurn as number) ?? visibleRowAnchor(container, scroller, toHide)
        : scroller !== null && pinnedAtBottom(scroller)
          ? null
          : visibleRowAnchor(container, scroller, toHide)
      const captured = anchor === null ? null : { el: anchor, top: anchor.getBoundingClientRect().top }
      const changed = applyFoldPlan(container, plan, expanded, options.copy).changed
      if (changed && captured !== null) scheduleRestore(captured)
      // A fold-driven loadOlder page just landed in the DOM (its first flow
      // row differs from when the load started): restore the reader's row.
      // Restoring measures the CURRENT shift after any fold compensation
      // above already ran, so the two never double-adjust.
      const pending = pendingLoad.get(container)
      if (pending !== undefined && firstFlowRowKey(container) !== pending.firstKey) {
        clearPendingLoad(container)
        if (pending.el.isConnected) scheduleRestore(pending)
      }
    }
    if (plan.completionRequest !== null && !olderInFlight && autoPages < maxAutoPages) {
      autoPages += 1
      olderInFlight = true
      // Arm a prepend anchor for every container while this page is in
      // flight, so its arrival does not slide the reader (unless they are
      // pinned to the bottom — the host follow owns that view — or they
      // scroll away, which drops the anchor and defers to their intent).
      for (const container of options.containers()) {
        if (pendingLoad.has(container)) continue
        const scroller = scrollerOf(container)
        if (scroller === null || pinnedAtBottom(scroller)) continue
        const anchor = visibleRowAnchor(container, scroller, toHide)
        if (anchor === null) continue
        pendingLoad.set(container, {
          el: anchor,
          top: anchor.getBoundingClientRect().top,
          firstKey: firstFlowRowKey(container),
        })
        const onScroll = (): void => { clearPendingLoad(container) }
        scroller.addEventListener('scroll', onScroll, { passive: true })
        pendingScrollOff.set(container, () => scroller.removeEventListener('scroll', onScroll))
      }
      void handle.loadOlder().finally(() => {
        olderInFlight = false
        run()
      })
    }
  }

  /**
   * Restore a captured anchor after the layout change and the host's
   * ResizeObserver follow have both settled: rAF2 runs after the observer
   * callbacks — a single rAF is undone by them (the CSS toggle is
   * synchronous, so the height delta is already measurable by then). An
   * anchor that stopped being rendered (folded away by a concurrent plan
   * change) is skipped rather than restored from a zeroed rect.
   */
  const scheduleRestore = (captured: AnchorCapture): void => {
    if (typeof requestAnimationFrame !== 'function') return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (captured.el.isConnected && captured.el.getBoundingClientRect().height > 0) {
          restoreElementPosition(captured.el, captured.top)
        }
      })
    })
  }

  const toggle = (turn: number): void => {
    const next = new Set(expanded)
    if (next.has(turn)) next.delete(turn)
    else next.add(turn)
    expanded = next
    run(turn)
  }

  const start = (): (() => void) => {
    run()
    const off = source.subscribe(run)
    return () => {
      clearAllPendingLoads()
      off()
    }
  }

  return { run, toggle, start }
}

/** The scroll container the flow moves in (the ChatView scroll column). */
function scrollerOf(container: HTMLElement): HTMLElement | null {
  return container.closest('[data-conversation-scroll]') ?? container.parentElement ?? null
}

/** True when the reader is scrolled to (or within ε of) the chat bottom. */
export function pinnedAtBottom(scroller: HTMLElement): boolean {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= BOTTOM_FOLLOW_THRESHOLD
}

/**
 * Scroll the scroller back so `el` returns to its captured viewport top
 * (undoing an at-bottom follow shift or the fold's own content shift).
 * Returns whether it scrolled.
 */
export function restoreElementPosition(el: HTMLElement, capturedTop: number): boolean {
  const container = el.parentElement
  if (container === null) return false
  const scroller = scrollerOf(container)
  if (scroller === null) return false
  const delta = el.getBoundingClientRect().top - capturedTop
  if (delta !== 0) {
    scroller.scrollTop += delta
    return true
  }
  return false
}

/**
 * Restore a toggled「已处理」header to its captured viewport top. Alias of
 * {@link restoreElementPosition}, kept for toggle-anchor call sites and tests.
 */
export function restoreHeaderPosition(header: HTMLElement, capturedTop: number): boolean {
  return restoreElementPosition(header, capturedTop)
}

/** The「已处理」header of one turn in a container, when connected (the manual-toggle anchor). */
function foldHeaderAnchor(container: HTMLElement, turn: number): HTMLElement | null {
  for (const child of container.children) {
    const el = child as HTMLElement
    if (el.hasAttribute('data-dsh-fold-header') && el.getAttribute('data-dsh-fold-turn') === String(turn)) {
      return el.isConnected ? el : null
    }
  }
  return null
}

/**
 * First rendered, viewport-visible anchor row (rows carry the host's
 * `data-chat-anchor-key`, same nodes as `data-chat-flow-key`) that the plan
 * will not hide — the reader's stable reference for auto re-applies.
 */
function visibleRowAnchor(
  container: HTMLElement,
  scroller: HTMLElement | null,
  toHide: ReadonlySet<string>,
): HTMLElement | null {
  if (scroller === null) return null
  const viewport = scroller.getBoundingClientRect()
  for (const child of container.children) {
    const el = child as HTMLElement
    if (el.getAttribute('data-chat-anchor-key') === null) continue
    const key = el.getAttribute('data-chat-flow-key')
    if (key !== null && toHide.has(key)) continue
    const rect = el.getBoundingClientRect()
    if (rect.height <= 0 || rect.width <= 0) continue // not rendered / inside a collapsed fold
    if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) continue
    return el
  }
  return null
}

/**
 * Flow key of the column's first rendered row (skipping non-row children
 * like the host's load-older button), used to detect a landed prepend.
 */
function firstFlowRowKey(container: HTMLElement): string | null {
  for (const child of container.children) {
    const key = child.getAttribute('data-chat-flow-key')
    if (key !== null) return key
  }
  return null
}