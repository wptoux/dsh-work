/**
 * Browser half: the SuperAgent list in the sidebar, the ticket panel it opens
 * in the main column, and the one-line jump into the hub session.
 *
 * The panel never renders chat: it polls `GET /mini-superagent/api/hub` every
 * 3 s while mounted, shows the ticket table, and hands the hub session id to
 * the workspace service so DSH's own conversation view takes over.
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

/** Read-only HTTP surface served by the host half (`src/server.ts`). */
export const HUB_PATH = '/mini-superagent/api/hub'
/** Poll cadence while the panel is mounted; leaving the panel stops it. */
export const HUB_REFRESH_MS = 3000
/** Identity shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'dsh-mini-superagent'

/**
 * One row as the panel renders it. The host serves durable `Ticket` rows
 * (their identifier is the wire field `id`); `fetchHub` projects them onto
 * this view so the presentation layer keys on `ticket`.
 */
export interface TicketView {
  /** Ticket id, e.g. `t-1a2b3c4d`. */
  ticket: string
  title: string
  state: string
  summary?: string | null
  /** Last transition time; rendered as local time, empty when absent. */
  updatedAt?: string | null
}

/** Wire row accepted from `GET /mini-superagent/api/hub`. */
export interface HubTicketRow {
  id?: string
  ticket?: string
  title?: string
  state?: string
  summary?: string | null
  updatedAt?: string | null
}

/** Body of `GET /mini-superagent/api/hub`. */
export interface HubPayload {
  hubSessionId: string
  tickets: TicketView[]
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** Project one durable ticket row onto the panel's view (tolerant of either id spelling). */
export function toTicketView(row: HubTicketRow): TicketView {
  return {
    ticket: row.ticket ?? row.id ?? '',
    title: row.title ?? '',
    state: row.state ?? '',
    summary: row.summary ?? null,
    updatedAt: row.updatedAt ?? null,
  }
}

/**
 * Read the hub payload. Exported with the fetch implementation and signal
 * injected so the panel and the tests share one contract.
 * @param fetchImpl - fetch-compatible implementation (defaults to the global).
 * @param signal - cancellation for an unmounting panel.
 * @returns the hub session id and its tickets, in host order.
 * @throws when the request fails or the payload carries no hub session id.
 */
export async function fetchHub(fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<HubPayload> {
  const response = await fetchImpl(HUB_PATH, { signal, headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`hub request failed: ${response.status}`)
  const payload = await response.json() as { hubSessionId?: unknown; tickets?: unknown }
  if (typeof payload.hubSessionId !== 'string') throw new Error('hub payload is missing hubSessionId')
  const rows = Array.isArray(payload.tickets) ? payload.tickets as HubTicketRow[] : []
  return { hubSessionId: payload.hubSessionId, tickets: rows.map(toTicketView) }
}

/** `YYYY-MM-DD HH:MM` in the browser's zone; unparsable values pass through. */
export function formatTime(value?: string | null): string {
  if (value === undefined || value === null || value === '') return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Render the ticket table (or the empty hint).
 * @param props.tickets - rows in host order.
 */
export function TicketTable({ tickets }: { tickets: TicketView[] }): ReactElement {
  if (tickets.length === 0) return <p>还没有票据。打开主会话派第一个活。</p>
  return (
    <table>
      <thead>
        <tr><th>票据</th><th>标题</th><th>状态</th><th>摘要</th><th>更新时间</th></tr>
      </thead>
      <tbody>
        {tickets.map(row => (
          <tr key={row.ticket}>
            <td>{row.ticket}</td>
            <td>{row.title}</td>
            <td>{row.state}</td>
            <td>{row.summary ?? ''}</td>
            <td>{formatTime(row.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Start the panel's polling loop: one immediate load, then `load` every
 * `intervalMs`. Failures are the loader's business (the panel renders them);
 * they never break the timer.
 * @param load - one refresh attempt.
 * @param intervalMs - refresh cadence.
 * @returns idempotent stop function (clears the timer).
 */
export function pollHub(load: () => Promise<void>, intervalMs: number = HUB_REFRESH_MS): () => void {
  const tick = (): void => {
    try { void load().catch(() => {}) }
    catch { /* a synchronous throw must not kill the interval */ }
  }
  tick()
  const timer = setInterval(tick, intervalMs)
  return () => { clearInterval(timer) }
}

/** Owner props of the `sidebar.panellist` seat (the icon ignores them). */
export interface PanelIconProps {
  size?: number
  active?: boolean
}

interface PanelProps {
  openSession(sessionId: string): void
}

/**
 * The SuperAgent main panel: one button into the hub session plus the ticket
 * table. Polling is mounted-scoped, so the panel stops as soon as the user
 * opens another main panel.
 */
export function Panel({ openSession }: PanelProps): ReactElement {
  const [data, setData] = useState<HubPayload>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    const load = async (): Promise<void> => {
      try {
        const next = await fetchHub(fetch, controller.signal)
        if (controller.signal.aborted) return
        setData(next)
        setError(undefined)
      } catch (cause) {
        if (!controller.signal.aborted) setError(messageOf(cause))
      }
    }
    const stop = pollHub(load)
    return () => { controller.abort(); stop() }
  }, [])
  return (
    <div>
      <h2>SuperAgent</h2>
      <p>{data === undefined ? '加载票据…' : `主会话：${data.hubSessionId}`}</p>
      <button type="button" disabled={data === undefined} onClick={() => { if (data !== undefined) openSession(data.hubSessionId) }}>
        打开主会话
      </button>
      {error === undefined ? null : <p role="alert">{error}</p>}
      <TicketTable tickets={data?.tickets ?? []} />
    </div>
  )
}

/** Sidebar glyph; the shell supplies its square edge and active state. */
export function Icon(_props: PanelIconProps): ReactElement {
  return <span aria-hidden>SG</span>
}

/* ------------------------------------------------------------------------- *
 * Client plugin wiring
 *
 * The client packages (`@deepseek-ai/dsh-client-ui-layout|sidebar|workspace`)
 * are loader-provided, not dependencies of this package, so the face this
 * plugin consumes is declared locally and kept to the two services it uses.
 * The real signatures (ui-layout `main` keyed slot, ui-sidebar
 * `sidebar.panellist` list, ui-workspace `openSession(SessionTarget)`) match
 * these shapes; `SessionTarget` is a branded string at runtime.
 * ------------------------------------------------------------------------- */

/** Services this browser plugin requires from the client runtime. */
export const inject = ['slots', 'uiWorkspace']

interface ListEntryOptions {
  name: 'sidebar.panellist'
  id: string
  order?: number
  label?: string | (() => string)
}

interface KeyedEntryOptions {
  name: 'main'
  key: string
}

/** The `ctx.slots` face: declaration-aware registration used by the client runtime. */
interface SlotsFace {
  inject(key: string, setup: () => () => void): () => void
  register(options: ListEntryOptions | KeyedEntryOptions, component: (props: never) => ReactElement): () => void
}

/** The `ctx.uiWorkspace` face: select a session and open its conversation. */
interface UiWorkspaceFace {
  openSession(sessionId: string): void
}

/** Client context shape this plugin needs; the loader supplies the rest. */
export interface MiniClientContext {
  slots: SlotsFace
  uiWorkspace: UiWorkspaceFace
}

/**
 * Register the SuperAgent sidebar entry and its main panel. Both registrations
 * wait for their slot declaration, so the plugin does not depend on client
 * package apply order.
 * @param ctx - client plugin context.
 */
export function apply(ctx: MiniClientContext): void {
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => 'SuperAgent' },
    Icon,
  ))
  ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: PANEL_ID },
    () => <Panel openSession={sessionId => ctx.uiWorkspace.openSession(sessionId)} />,
  ))
}
