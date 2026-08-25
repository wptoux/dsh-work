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
  readonly turns: ReadonlyMap<number, { readonly start?: unknown; readonly end?: unknown }>
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

/** Project a DriverSnapshot into the planner's window, or null while not open. */
export function windowFromSnapshot(snapshot: DriverSnapshot): FoldWindow | null {
  if (snapshot.openState !== 'open') return null
  const turns = new Map<number, FoldTurn>()
  for (const [number, t] of snapshot.turns) {
    turns.set(number, { turn: number, startLoaded: t.start !== undefined, endLoaded: t.end !== undefined })
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

  const clean = (): void => {
    for (const container of options.containers()) {
      applyFoldPlan(container, EMPTY_PLAN, expanded, options.copy)
    }
  }

  const run = (): void => {
    const handle = source.current()
    if (handle === null) {
      currentSessionId = null
      expanded = new Set()
      clean()
      return
    }
    if (handle.sessionId !== currentSessionId) {
      currentSessionId = handle.sessionId
      expanded = new Set()
    }
    const snapshot = handle.snapshot()
    if (snapshot === null) {
      clean()
      return
    }
    const window = windowFromSnapshot(snapshot)
    const plan = window === null ? EMPTY_PLAN : planFolds(window)
    if (plan.completionRequest === null) autoPages = 0
    for (const container of options.containers()) {
      applyFoldPlan(container, plan, expanded, options.copy)
    }
    if (plan.completionRequest !== null && !olderInFlight && autoPages < maxAutoPages) {
      autoPages += 1
      olderInFlight = true
      void handle.loadOlder().finally(() => {
        olderInFlight = false
        run()
      })
    }
  }

  const toggle = (turn: number): void => {
    const next = new Set(expanded)
    if (next.has(turn)) next.delete(turn)
    else next.add(turn)
    expanded = next
    // Expanding inserts the hidden rows ABOVE the header, shoving it down out
    // of the viewport; anchor its position so the user can immediately click
    // again to collapse (the fold opens in place).
    const anchor = captureFoldHeaderAnchor(options.containers(), turn)
    run()
    restoreFoldHeaderAnchor(anchor)
  }

  const start = (): (() => void) => {
    run()
    return source.subscribe(run)
  }

  return { run, toggle, start }
}

/** Viewport anchor of one fold header, captured before a toggle re-applies. */
interface FoldHeaderAnchor {
  readonly header: HTMLElement
  readonly top: number
  readonly scroller: HTMLElement | null
}

/** The scroll container the header moves in (the ChatView scroll column). */
function scrollerOf(container: HTMLElement): HTMLElement | null {
  return container.closest('[data-conversation-scroll]') ?? container.parentElement ?? null
}

function captureFoldHeaderAnchor(
  containers: readonly HTMLElement[],
  turn: number,
): FoldHeaderAnchor | null {
  for (const container of containers) {
    for (const child of container.children) {
      const el = child as HTMLElement
      if (el.hasAttribute('data-dsh-fold-header') && el.getAttribute('data-dsh-fold-turn') === String(turn)) {
        return { header: el, top: el.getBoundingClientRect().top, scroller: scrollerOf(container) }
      }
    }
  }
  return null
}

/** Scroll the container back so the header returns to its captured viewport top. */
function restoreFoldHeaderAnchor(anchor: FoldHeaderAnchor | null): void {
  if (anchor === null || !anchor.header.isConnected || anchor.scroller === null) return
  const delta = anchor.header.getBoundingClientRect().top - anchor.top
  if (delta !== 0) anchor.scroller.scrollTop += delta
}