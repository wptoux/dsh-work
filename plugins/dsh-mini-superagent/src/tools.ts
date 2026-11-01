import { z } from 'zod'
import type { Engine } from './engine.ts'
import type { Sessions } from './sessions.ts'
import type { ReportState, Ticket } from './types.ts'

export interface Tool {
  name: string
  description: string
  schema: z.ZodType
  execute(args: unknown, signal: AbortSignal): Promise<unknown>
}

export interface ToolDeps {
  engine: Engine
  sessions: Pick<Sessions, 'send'>
  hubSessionId(): string | undefined
  onTerminal(ticket: Ticket, line: string): Promise<void>
}

/** Reads the session identity injected by the registration layer (never model-visible). */
const caller = (args: unknown): string => {
  const session = (args as { __session?: string }).__session
  if (session === undefined) throw new Error('tool called without a session identity')
  return session
}

const view = (t: Ticket) => ({
  ticket: t.id, title: t.title, state: t.state, summary: t.summary ?? null,
  work_dir: t.workDir, outcome: t.outcome ?? null, updated_at: t.updatedAt,
})

export function hubTools(deps: ToolDeps): Tool[] {
  const assertHub = (args: unknown): string => {
    const session = caller(args)
    if (session !== deps.hubSessionId()) throw new Error('these tools only exist in the SuperAgent hub session')
    return session
  }
  return [
    {
      name: 'request_work',
      description: 'Create a durable ticket and dispatch it to an isolated worker session. Use for any task that should run on its own.',
      schema: z.object({ title: z.string().min(1).max(120), request: z.string().min(1).max(8000) }),
      async execute(args, _signal) {
        const session = assertHub(args)
        const input = args as { title: string; request: string }
        const ticket = deps.engine.createTicket({ ...input, originSessionId: session })
        return { ticket: ticket.id, work_dir: ticket.workDir, state: ticket.state }
      },
    },
    {
      name: 'list_tickets',
      description: 'List open tickets and the most recent finished ones.',
      schema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
      async execute(args) {
        assertHub(args)
        const limit = (args as { limit?: number }).limit ?? 20
        return { tickets: deps.engine.listTickets(limit).map(view) }
      },
    },
    {
      name: 'ticket_control',
      description: 'Retry a waiting/blocked/failed ticket, or stop one. Stopping only marks it ended; to halt work immediately open its session and press stop.',
      schema: z.object({ action: z.enum(['retry', 'stop']), ticket_id: z.string().min(1) }),
      async execute(args) {
        assertHub(args)
        const input = args as { action: 'retry' | 'stop'; ticket_id: string }
        if (input.action === 'retry') return view(deps.engine.retry(input.ticket_id))
        const stopped = deps.engine.stop(input.ticket_id)
        await deps.onTerminal(stopped.ticket, `已停止（用户）${stopped.sessionId === undefined ? '' : `；如需立刻停手，去会话 ${stopped.sessionId} 按停止`}`)
        return view(stopped.ticket)
      },
    },
  ]
}

const TERMINAL: ReadonlySet<ReportState> = new Set(['waiting', 'blocked', 'failed', 'ended'])

const LABEL: Record<ReportState, string> = {
  progress: '进展', waiting: '挂起', blocked: '卡住', failed: '失败', ended: '完成',
}

export function workerTools(deps: ToolDeps): Tool[] {
  return [
    {
      name: 'report',
      description: 'Report this ticket\'s outcome. Terminal states end this attempt; do not call report again afterwards.',
      schema: z.object({
        state: z.enum(['progress', 'waiting', 'blocked', 'failed', 'ended']),
        summary: z.string().min(1).max(4000),
      }),
      async execute(args) {
        const session = caller(args)
        const input = args as { state: ReportState; summary: string }
        const { ticket, notify } = deps.engine.report(session, input.state, input.summary)
        if (notify && TERMINAL.has(input.state)) {
          await deps.onTerminal(ticket, `${LABEL[input.state]}：${input.summary}`)
        }
        return { state: ticket.state, terminal: TERMINAL.has(input.state) }
      },
    },
  ]
}
