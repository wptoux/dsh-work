import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Assignment, AssignmentState, Outcome, Ticket, TicketState } from './types.ts'

export const SCHEMA_VERSION = 1

interface TicketRow {
  id: string; title: string; request: string; state: TicketState; outcome: Outcome | null; summary: string | null
  work_dir: string; origin_session_id: string; revision: number; created_at: string; updated_at: string; ended_at: string | null
}
interface AssignmentRow {
  id: string; ticket_id: string; attempt: number; state: AssignmentState; session_id: string
  recovery_note: string | null; started_at: string; ended_at: string | null
}

const toTicket = (r: TicketRow): Ticket => ({
  id: r.id, title: r.title, request: r.request, state: r.state,
  ...(r.outcome === null ? {} : { outcome: r.outcome }),
  ...(r.summary === null ? {} : { summary: r.summary }),
  workDir: r.work_dir, originSessionId: r.origin_session_id, revision: r.revision,
  createdAt: r.created_at, updatedAt: r.updated_at,
  ...(r.ended_at === null ? {} : { endedAt: r.ended_at }),
})
const toAssignment = (r: AssignmentRow): Assignment => ({
  id: r.id, ticketId: r.ticket_id, attempt: r.attempt, state: r.state, sessionId: r.session_id,
  ...(r.recovery_note === null ? {} : { recoveryNote: r.recovery_note }),
  startedAt: r.started_at,
  ...(r.ended_at === null ? {} : { endedAt: r.ended_at }),
})

export class Store {
  readonly db: DatabaseSync

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, request TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('queued','working','waiting','blocked','failed','ended')),
        outcome TEXT CHECK (outcome IN ('completed','stopped','failed')),
        summary TEXT, work_dir TEXT NOT NULL, origin_session_id TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ended_at TEXT
      );
      CREATE INDEX IF NOT EXISTS tickets_dispatch ON tickets(created_at) WHERE state = 'queued';
      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        attempt INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('running','ended','interrupted')),
        session_id TEXT NOT NULL, recovery_note TEXT, started_at TEXT NOT NULL, ended_at TEXT,
        UNIQUE (ticket_id, attempt)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS assignments_one_running ON assignments(ticket_id) WHERE state = 'running';
    `)
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined
    if (row === undefined) this.db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION))
    else if (Number(row.value) !== SCHEMA_VERSION) {
      this.db.close()
      throw new Error(`dsh-mini-superagent: unsupported schema ${row.value}, expected ${SCHEMA_VERSION}`)
    }
  }

  get schemaVersion(): number { return Number(this.meta('schema_version') ?? SCHEMA_VERSION) }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const value = fn(); this.db.exec('COMMIT'); return value }
    catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* already rolled back */ }
      throw error
    }
  }

  close(): void { this.db.close() }

  meta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  insertTicket(t: Ticket): void {
    this.db.prepare(`INSERT INTO tickets (id,title,request,state,outcome,summary,work_dir,origin_session_id,revision,created_at,updated_at,ended_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(t.id, t.title, t.request, t.state, t.outcome ?? null, t.summary ?? null,
      t.workDir, t.originSessionId, t.revision, t.createdAt, t.updatedAt, t.endedAt ?? null)
  }

  ticket(id: string): Ticket | undefined {
    const row = this.db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as TicketRow | undefined
    return row === undefined ? undefined : toTicket(row)
  }

  /**
   * Persists only `state`, `outcome`, `summary`, `revision`, `updatedAt` and
   * `endedAt`. Patches to `title`, `request`, `workDir`, `originSessionId` or
   * `createdAt` are ignored by design.
   */
  updateTicket(id: string, patch: Partial<Ticket>): void {
    const current = this.ticket(id)
    if (current === undefined) throw new Error(`ticket ${id} not found`)
    const next = { ...current, ...patch }
    this.db.prepare(`UPDATE tickets SET state=?, outcome=?, summary=?, revision=?, updated_at=?, ended_at=? WHERE id=?`)
      .run(next.state, next.outcome ?? null, next.summary ?? null, next.revision, next.updatedAt, next.endedAt ?? null, id)
  }

  oldestQueued(): Ticket | undefined {
    const row = this.db.prepare("SELECT * FROM tickets WHERE state = 'queued' ORDER BY created_at, id LIMIT 1").get() as TicketRow | undefined
    return row === undefined ? undefined : toTicket(row)
  }

  openTickets(): Ticket[] {
    return (this.db.prepare("SELECT * FROM tickets WHERE state <> 'ended' ORDER BY created_at DESC").all() as unknown as TicketRow[]).map(toTicket)
  }

  recentEnded(limit: number): Ticket[] {
    return (this.db.prepare("SELECT * FROM tickets WHERE state = 'ended' ORDER BY updated_at DESC LIMIT ?").all(limit) as unknown as TicketRow[]).map(toTicket)
  }

  insertAssignment(a: Assignment): void {
    this.db.prepare(`INSERT INTO assignments (id,ticket_id,attempt,state,session_id,recovery_note,started_at,ended_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(a.id, a.ticketId, a.attempt, a.state, a.sessionId, a.recoveryNote ?? null, a.startedAt, a.endedAt ?? null)
  }

  runningAssignment(ticketId: string): Assignment | undefined {
    const row = this.db.prepare("SELECT * FROM assignments WHERE ticket_id = ? AND state = 'running'").get(ticketId) as AssignmentRow | undefined
    return row === undefined ? undefined : toAssignment(row)
  }

  assignmentBySession(sessionId: string): Assignment | undefined {
    const row = this.db.prepare('SELECT * FROM assignments WHERE session_id = ? ORDER BY started_at DESC LIMIT 1').get(sessionId) as AssignmentRow | undefined
    return row === undefined ? undefined : toAssignment(row)
  }

  latestAssignment(ticketId: string): Assignment | undefined {
    const row = this.db.prepare('SELECT * FROM assignments WHERE ticket_id = ? ORDER BY attempt DESC LIMIT 1').get(ticketId) as AssignmentRow | undefined
    return row === undefined ? undefined : toAssignment(row)
  }

  endAssignment(id: string, state: 'ended' | 'interrupted'): void {
    this.db.prepare('UPDATE assignments SET state = ?, ended_at = ? WHERE id = ?').run(state, new Date().toISOString(), id)
  }

  runningAssignments(): Assignment[] {
    return (this.db.prepare("SELECT * FROM assignments WHERE state = 'running'").all() as unknown as AssignmentRow[]).map(toAssignment)
  }
}
