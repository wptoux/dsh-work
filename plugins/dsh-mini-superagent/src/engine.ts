import { randomBytes } from 'node:crypto'
import type { Store } from './store.ts'
import { MiniError, now, type Assignment, type ReportState, type Ticket } from './types.ts'

const id = (prefix: string): string => `${prefix}-${randomBytes(4).toString('hex')}`

export interface CreateTicketInput { title: string; request: string; originSessionId: string }

export class Engine {
  constructor(private readonly store: Store) {}

  createTicket(input: CreateTicketInput): Ticket {
    return this.store.tx(() => {
      const ticketId = id('t')
      const at = now()
      const ticket: Ticket = {
        id: ticketId, title: input.title, request: input.request, state: 'queued',
        workDir: `work/${ticketId}`, originSessionId: input.originSessionId, revision: 0, createdAt: at, updatedAt: at,
      }
      this.store.insertTicket(ticket)
      return ticket
    })
  }

  dispatchNext(): { ticket: Ticket; assignment: Assignment } | undefined {
    return this.store.tx(() => {
      const next = this.store.oldestQueued()
      if (next === undefined) return undefined
      const previous = this.store.latestAssignment(next.id)
      const recoveryNote = previous?.state === 'interrupted'
        ? `上一次尝试（attempt ${previous.attempt}）在进程重启或停止时被中断；先检查工作目录里已有的改动。`
        : undefined
      const attempt = (previous?.attempt ?? 0) + 1
      const assignment: Assignment = {
        id: id('a'), ticketId: next.id, attempt, state: 'running',
        // A fresh session per attempt: reusing one id would resume the old worker
        // history when the kernel mints a new id for a non-blank session.
        sessionId: `worker-${next.id}-a${attempt}`, startedAt: now(), ...(recoveryNote === undefined ? {} : { recoveryNote }),
      }
      this.store.insertAssignment(assignment)
      this.store.updateTicket(next.id, { state: 'working', revision: next.revision + 1, updatedAt: now() })
      return { ticket: this.store.ticket(next.id)!, assignment }
    })
  }

  report(sessionId: string, state: ReportState, summary: string): { ticket: Ticket; notify: boolean } {
    return this.store.tx(() => {
      const assignment = this.store.assignmentBySession(sessionId)
      if (assignment === undefined) throw new MiniError('assignment/not-running', `no assignment for session ${sessionId}`)
      if (assignment.state !== 'running') throw new MiniError('report/terminal-twice', `assignment ${assignment.id} already ${assignment.state}`)
      const ticket = this.store.ticket(assignment.ticketId)
      if (ticket === undefined) throw new MiniError('ticket/not-found', assignment.ticketId)
      const at = now()
      if (state === 'progress') {
        this.store.updateTicket(ticket.id, { summary, revision: ticket.revision + 1, updatedAt: at })
        return { ticket: this.store.ticket(ticket.id)!, notify: false }
      }
      this.store.endAssignment(assignment.id, 'ended')
      const ended = state === 'ended'
      this.store.updateTicket(ticket.id, {
        state: ended ? 'ended' : state,
        ...(ended ? { outcome: 'completed' as const, endedAt: at } : {}),
        summary, revision: ticket.revision + 1, updatedAt: at,
      })
      return { ticket: this.store.ticket(ticket.id)!, notify: true }
    })
  }

  retry(ticketId: string): Ticket {
    return this.store.tx(() => {
      const ticket = this.store.ticket(ticketId)
      if (ticket === undefined) throw new MiniError('ticket/not-found', ticketId)
      if (!['waiting', 'blocked', 'failed'].includes(ticket.state)) throw new MiniError('ticket/not-retryable', `ticket ${ticketId} is ${ticket.state}`)
      this.store.updateTicket(ticketId, { state: 'queued', summary: undefined, revision: ticket.revision + 1, updatedAt: now() })
      return this.store.ticket(ticketId)!
    })
  }

  stop(ticketId: string): { ticket: Ticket; sessionId?: string } {
    return this.store.tx(() => {
      const ticket = this.store.ticket(ticketId)
      if (ticket === undefined) throw new MiniError('ticket/not-found', ticketId)
      if (ticket.state === 'ended') throw new MiniError('ticket/not-open', ticketId)
      const running = this.store.runningAssignment(ticketId)
      if (running !== undefined) this.store.endAssignment(running.id, 'interrupted')
      this.store.updateTicket(ticketId, { state: 'ended', outcome: 'stopped', endedAt: now(), revision: ticket.revision + 1, updatedAt: now() })
      return { ticket: this.store.ticket(ticketId)!, ...(running === undefined ? {} : { sessionId: running.sessionId }) }
    })
  }

  failDispatch(ticketId: string, message: string): Ticket {
    return this.store.tx(() => {
      const ticket = this.store.ticket(ticketId)
      if (ticket === undefined) throw new MiniError('ticket/not-found', ticketId)
      if (ticket.state === 'ended') throw new MiniError('ticket/not-open', ticketId)
      const running = this.store.runningAssignment(ticketId)
      if (running !== undefined) this.store.endAssignment(running.id, 'interrupted')
      this.store.updateTicket(ticketId, { state: 'failed', summary: `派发失败：${message}`, revision: ticket.revision + 1, updatedAt: now() })
      return this.store.ticket(ticketId)!
    })
  }

  recover(): number {
    return this.store.tx(() => {
      const running = this.store.runningAssignments()
      for (const assignment of running) {
        this.store.endAssignment(assignment.id, 'interrupted')
        const ticket = this.store.ticket(assignment.ticketId)
        if (ticket !== undefined && ticket.state === 'working') {
          this.store.updateTicket(ticket.id, { state: 'queued', revision: ticket.revision + 1, updatedAt: now() })
        }
      }
      return running.length
    })
  }

  interruptAll(): number { return this.recover() }

  get schemaVersion(): number { return this.store.schemaVersion }

  runningCount(): number { return this.store.runningAssignments().length }

  queuedCount(): number { return this.store.openTickets().filter(ticket => ticket.state === 'queued').length }

  /** Open tickets first, then recent ended ones, never exceeding `limit` in total. */
  listTickets(limit = 50): Ticket[] {
    const open = this.store.openTickets()
    if (open.length >= limit) return open.slice(0, limit)
    return [...open, ...this.store.recentEnded(Math.min(10, limit - open.length))]
  }
}
