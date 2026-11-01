import type { Assignment, Ticket } from '../src/types.ts'

export const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 't-1a2b3c4d', title: 'demo', request: 'do the thing', state: 'queued',
  workDir: 'work/t-1a2b3c4d', originSessionId: 'mini-hub-00000000', revision: 0,
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', ...over,
})

export const assignment = (over: Partial<Assignment> = {}): Assignment => ({
  id: 'a-00000001', ticketId: 't-1a2b3c4d', attempt: 1, state: 'running',
  sessionId: 'worker-t-1a2b3c4d-a1', startedAt: '2026-11-01T00:00:01.000Z', ...over,
})
