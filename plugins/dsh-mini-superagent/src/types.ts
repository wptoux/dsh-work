export type TicketState = 'queued' | 'working' | 'waiting' | 'blocked' | 'failed' | 'ended'
export type ReportState = 'progress' | 'waiting' | 'blocked' | 'failed' | 'ended'
export type Outcome = 'completed' | 'stopped' | 'failed'
export type AssignmentState = 'running' | 'ended' | 'interrupted'

export interface Ticket {
  id: string
  title: string
  request: string
  state: TicketState
  outcome?: Outcome
  summary?: string
  /** Ticket directory, relative to the workspace root, e.g. `work/t-1a2b3c4d`. */
  workDir: string
  originSessionId: string
  revision: number
  createdAt: string
  updatedAt: string
  endedAt?: string
}

export interface Assignment {
  id: string
  ticketId: string
  attempt: number
  state: AssignmentState
  sessionId: string
  recoveryNote?: string
  startedAt: string
  endedAt?: string
}

/** Typed failure carrying a stable machine code (see the spec's error table). */
export class MiniError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'MiniError'
  }
}

export const now = (): string => new Date().toISOString()
