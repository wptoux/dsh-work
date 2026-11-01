# dsh-mini-superagent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `plugins/dsh-mini-superagent`, a first-party experimental DSH plugin that turns a natural-language request into a durable ticket, runs it in an isolated worker session, survives a process restart, and shows tickets in a SuperAgent sidebar panel.

**Architecture:** A host plugin owns SQLite (`node:sqlite`) as the single source of truth and exposes four agent tools; one of them creates a ticket row, a dispatcher claims the oldest queued ticket and launches a sibling DSH session (`sessionController.create`, not a subagent child) whose only inbound message is a mandate; the worker reports back through a scoped `report` tool that updates the ticket and wakes the hub session with a one-line notice. A small client plugin registers a sidebar entry and a ticket panel that opens the hub session in the native chat UI.

**Tech Stack:** TypeScript (strict, ES2024), cordis v4, schemastery config, `node:sqlite` (`DatabaseSync`), zod tool schemas, `proper-lockfile`, React 18 client bundle built by tsdown, vitest (node + jsdom).

**Spec:** `docs/superpowers/specs/2026-11-01-dsh-mini-superagent-design.md` (v2, commit `c963387`). The plan argues from the spec; executors read both.

## Global Constraints

- Do NOT modify the dsh kernel (`/usr/local/lib/node_modules/@deepseek-ai/dsh`), `~/deepseek-harness`, or any `@deepseek-ai/*` package; do not fetch/push upstream.
- Do NOT restart, kill, or replace the running `dsh web`. The finished plugin takes effect only after the user restarts DSH; say so in the report.
- All commits at `/root/dsh-work`, Conventional Commits, no emoji; `git status --short` shows only intended files before each commit.
- `node_modules/` and `*.tsbuildinfo` never committed. `lib/` is committed only after a real `pnpm build` (release step); during M1–M3 development do not commit `lib/`.
- Runtime dependency changes need `pnpm install` inside `plugins/dsh-mini-superagent`.
- Every session the plugin creates uses `danger-full-access`; the workspace directory is a convention, not a sandbox. Do not claim otherwise in README.
- Tool schemas are zod v4; register with `parameters: z.toJSONSchema(schema)` and a permissive object `output` schema.
- Session ids: hub = `mini-hub-<8 hex>`, worker = `worker-<ticket id>`. All sessions share the workspace `<stateDir>/superagent`.
- Never store secrets or absolute user paths in the DB beyond `work_dir` (which is relative to the workspace).

---

### Task 1: Scaffold the package, config, and shared types

**Files:**
- Create: `plugins/dsh-mini-superagent/package.json`
- Create: `plugins/dsh-mini-superagent/tsconfig.json`
- Create: `plugins/dsh-mini-superagent/tsdown.config.ts`
- Create: `plugins/dsh-mini-superagent/vitest.config.ts`
- Create: `plugins/dsh-mini-superagent/cordis.patch.yml`
- Create: `plugins/dsh-mini-superagent/src/config.ts`
- Create: `plugins/dsh-mini-superagent/src/types.ts`
- Create: `plugins/dsh-mini-superagent/src/index.ts` (stub exporting `name`/`inject`/`apply`)
- Test: `plugins/dsh-mini-superagent/tests/config.spec.ts`

**Interfaces:**
- Produces: package `dsh-mini-superagent` (`main: lib/index.js`, `exports ./client`), cordis plugin `name = 'mini-superagent'`, `inject = ['agents','sessionController','workspaceRegistry','tools','webServer']`, config schema `{ stateDir, maxWorkers, workerPreset }`, and the domain types `Ticket`, `Assignment`, `ReportState`, `MiniError`.

- [ ] **Step 1: Write the package and build files**

`package.json`:

```json
{
  "name": "dsh-mini-superagent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Minimal durable superagent kernel for DSH: tickets, isolated worker sessions, restart recovery, and a SuperAgent sidebar entry.",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "README.md"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-ui-sidebar",
        "@deepseek-ai/dsh-client-ui-workspace"
      ]
    },
    "manifestVersion": 1
  },
  "scripts": {
    "build": "tsdown",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "engines": { "node": "^22.19.0 || >=24.0.0", "dsh": "^0.2.1-alpha.2" },
  "dependencies": { "proper-lockfile": "4.1.2", "zod": "4.4.3" },
  "peerDependencies": {
    "@deepseek-ai/cordis": "4.0.5-alpha.1",
    "@deepseek-ai/dsh-agent": "^0.2.1-alpha.2",
    "@deepseek-ai/dsh-api-session-controller": "^0.2.1-alpha.2",
    "@deepseek-ai/dsh-host-webserver": "^0.2.1-alpha.2",
    "@deepseek-ai/dsh-tools": "^0.2.1-alpha.2",
    "@deepseek-ai/dsh-workspace": "^0.2.1-alpha.2",
    "@deepseek-ai/schemastery": "3.18.5-alpha.1"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "4.0.5-alpha.1",
    "@deepseek-ai/dsh-agent": "0.2.1-alpha.2",
    "@deepseek-ai/dsh-api-session-controller": "0.2.1-alpha.2",
    "@deepseek-ai/dsh-host-webserver": "0.2.1-alpha.2",
    "@deepseek-ai/dsh-tools": "0.2.1-alpha.2",
    "@deepseek-ai/dsh-workspace": "0.2.1-alpha.2",
    "@deepseek-ai/schemastery": "3.18.5-alpha.1",
    "@types/node": "22.20.0",
    "@types/proper-lockfile": "4.1.4",
    "@types/react": "18.3.28",
    "@types/react-dom": "18.3.7",
    "jsdom": "29.1.1",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "tsdown": "0.22.14",
    "typescript": "6.0.3",
    "vitest": "4.1.8"
  }
}
```

`tsconfig.json` — copy `plugins/dsh-model-sync/tsconfig.json` and add `"jsx": "react-jsx"`, `"lib": ["ES2024","DOM"]`, and include `src/**/*.tsx`.

`tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib', format: 'esm', platform: 'node', target: 'es2024', dts: true, clean: true,
    deps: { neverBundle: [/^@deepseek-ai\//, 'zod', 'proper-lockfile'] },
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib', format: 'cjs', platform: 'browser', dts: false, clean: false,
    deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom'] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-mini-superagent", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'], environment: 'node' } })
```

`cordis.patch.yml`:

```yaml
# dsh-mini-superagent bundle layer: inserts the plugin; the profile supplies stateDir.
- insert:
    - id: mini-superagent
      name: dsh-mini-superagent
```

- [ ] **Step 2: Write config and types**

`src/config.ts`:

```ts
import s from '@deepseek-ai/schemastery'

export const Config = s.object({
  stateDir: s.string().pattern(/^\//).required().description('Absolute directory for the database, workspace and ticket folders.'),
  maxWorkers: s.number().min(1).max(4).step(1).default(1).description('Concurrent worker sessions.'),
  workerPreset: s.string().default('standard').description('DSH agent preset used by worker sessions.'),
})

export type MiniConfig = ReturnType<typeof Config>
```

`src/types.ts`:

```ts
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
```

`src/index.ts` (stub so the package builds):

```ts
import type { Context } from '@deepseek-ai/cordis'
import { Config, type MiniConfig } from './config.ts'

export const name = 'mini-superagent'
export const inject = ['agents', 'sessionController', 'workspaceRegistry', 'tools', 'webServer']
export { Config }

export function apply(_ctx: Context, _config: MiniConfig): void {
  // Tasks 2–6 fill this in.
}
```

- [ ] **Step 3: Write the failing config test**

`tests/config.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'

describe('config', () => {
  it('defaults maxWorkers to 1 and workerPreset to standard', () => {
    const value = Config({ stateDir: '/tmp/mini' })
    expect(value.maxWorkers).toBe(1)
    expect(value.workerPreset).toBe('standard')
  })

  it('rejects a relative stateDir', () => {
    expect(() => Config({ stateDir: 'relative/path' })).toThrow()
  })
})
```

- [ ] **Step 4: Install, run the test, then build**

Run:
```bash
cd plugins/dsh-mini-superagent && pnpm install && pnpm test && pnpm build
```
Expected: 2 tests pass; `lib/index.js` and `lib/client.js` exist (client stub comes in Task 7, so create `src/client/index.tsx` with `export function apply() {}` before building).

- [ ] **Step 5: Commit**

```bash
cd /root/dsh-work
git add plugins/dsh-mini-superagent
git commit -m "feat(mini-superagent): scaffold package, config and domain types"
```

---

### Task 2: SQLite store

**Files:**
- Create: `plugins/dsh-mini-superagent/src/store.ts`
- Create: `plugins/dsh-mini-superagent/tests/fixtures.ts`
- Test: `plugins/dsh-mini-superagent/tests/store.spec.ts`

**Interfaces:**
- Produces: `class Store` with `constructor(path: string)`, `close()`, `tx<T>(fn: () => T): T`, `insertTicket(t: Ticket)`, `ticket(id): Ticket | undefined`, `updateTicket(id, patch: Partial<Ticket>)`, `oldestQueued()`, `openTickets()`, `recentEnded(limit)`, `insertAssignment(a: Assignment)`, `runningAssignment(ticketId)`, `assignmentBySession(sessionId)`, `latestAssignment(ticketId)`, `endAssignment(id, state: 'ended' | 'interrupted')`, `runningAssignments()`, `meta(key)`, `setMeta(key, value)`, `schemaVersion` getter.
- Field mapping: DB snake_case columns ↔ camelCase `Ticket`/`Assignment`.

- [ ] **Step 1: Write the failing store test**

`tests/fixtures.ts`:

```ts
import type { Assignment, Ticket } from '../src/types.ts'

export const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 't-1a2b3c4d', title: 'demo', request: 'do the thing', state: 'queued',
  workDir: 'work/t-1a2b3c4d', originSessionId: 'mini-hub-00000000', revision: 0,
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', ...over,
})

export const assignment = (over: Partial<Assignment> = {}): Assignment => ({
  id: 'a-00000001', ticketId: 't-1a2b3c4d', attempt: 1, state: 'running',
  sessionId: 'worker-t-1a2b3c4d', startedAt: '2026-11-01T00:00:01.000Z', ...over,
})
```

`tests/store.spec.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Store } from '../src/store.ts'
import { assignment, ticket } from './fixtures.ts'

let dir: string
let store: Store

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mini-store-')); store = new Store(join(dir, 'state.sqlite')) })
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

describe('Store', () => {
  it('round-trips a ticket with optional fields omitted', () => {
    store.insertTicket(ticket())
    expect(store.ticket('t-1a2b3c4d')).toEqual(ticket())
    expect(store.ticket('missing')).toBeUndefined()
  })

  it('round-trips an assignment and finds it by session', () => {
    store.insertTicket(ticket())
    store.insertAssignment(assignment())
    expect(store.assignmentBySession('worker-t-1a2b3c4d')?.id).toBe('a-00000001')
    expect(store.runningAssignment('t-1a2b3c4d')?.attempt).toBe(1)
  })

  it('rolls a transaction back when the callback throws', () => {
    expect(() => store.tx(() => { store.insertTicket(ticket()); throw new Error('boom') })).toThrow('boom')
    expect(store.ticket('t-1a2b3c4d')).toBeUndefined()
  })

  it('keeps meta values', () => {
    store.setMeta('hub_session', 'mini-hub-1')
    expect(store.meta('hub_session')).toBe('mini-hub-1')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd plugins/dsh-mini-superagent && pnpm vitest run tests/store.spec.ts`
Expected: FAIL — `Cannot find module '../src/store.ts'`.

- [ ] **Step 3: Implement `src/store.ts`**

```ts
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
    else if (Number(row.value) !== SCHEMA_VERSION) throw new Error(`dsh-mini-superagent: unsupported schema ${row.value}, expected ${SCHEMA_VERSION}`)
  }

  get schemaVersion(): number { return Number(this.meta('schema_version') ?? SCHEMA_VERSION) }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const value = fn(); this.db.exec('COMMIT'); return value }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
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
    return (this.db.prepare("SELECT * FROM tickets WHERE state <> 'ended' ORDER BY created_at DESC").all() as TicketRow[]).map(toTicket)
  }

  recentEnded(limit: number): Ticket[] {
    return (this.db.prepare("SELECT * FROM tickets WHERE state = 'ended' ORDER BY updated_at DESC LIMIT ?").all(limit) as TicketRow[]).map(toTicket)
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
    return (this.db.prepare("SELECT * FROM assignments WHERE state = 'running'").all() as AssignmentRow[]).map(toAssignment)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd plugins/dsh-mini-superagent && pnpm vitest run tests/store.spec.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add plugins/dsh-mini-superagent/src/store.ts plugins/dsh-mini-superagent/tests
git commit -m "feat(mini-superagent): add sqlite store for tickets and assignments"
```

---

### Task 3: Engine state machine

**Files:**
- Create: `plugins/dsh-mini-superagent/src/engine.ts`
- Test: `plugins/dsh-mini-superagent/tests/engine.spec.ts`

**Interfaces:**
- Consumes: `Store` (Task 2), `Ticket`/`Assignment`/`MiniError`/`now` (Task 1).
- Produces: `class Engine` with `createTicket({title, request, originSessionId}): Ticket`, `dispatchNext(): { ticket: Ticket; assignment: Assignment } | undefined`, `report(sessionId, state, summary): { ticket: Ticket; notify: boolean }`, `retry(id)`, `stop(id): { ticket: Ticket; sessionId?: string }`, `failDispatch(id, message)`, `recover(): number`, `interruptAll(): number`, `listTickets(limit?): Ticket[]`.

- [ ] **Step 1: Write the failing engine test**

`tests/engine.spec.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Engine } from '../src/engine.ts'
import { Store } from '../src/store.ts'

let dir: string
let store: Store
let engine: Engine

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mini-engine-'))
  store = new Store(join(dir, 'state.sqlite'))
  engine = new Engine(store)
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

const create = () => engine.createTicket({ title: 'fix readme', request: 'update commands', originSessionId: 'mini-hub-1' })

describe('Engine', () => {
  it('creates a queued ticket with a work dir under the workspace', () => {
    const t = create()
    expect(t.state).toBe('queued')
    expect(t.workDir).toBe(`work/${t.id}`)
    expect(t.revision).toBe(0)
  })

  it('dispatches the oldest queued ticket once', () => {
    const first = create()
    create()
    const claim = engine.dispatchNext()
    expect(claim?.ticket.id).toBe(first.id)
    expect(claim?.assignment.attempt).toBe(1)
    expect(store.ticket(first.id)?.state).toBe('working')
    expect(engine.dispatchNext()).toBeUndefined()
  })

  it('moves a ticket through report states and notifies only on terminal states', () => {
    const t = create()
    const claim = engine.dispatchNext()!
    expect(engine.report(claim.assignment.sessionId, 'progress', 'halfway')).toEqual({ ticket: expect.objectContaining({ state: 'working', summary: 'halfway' }), notify: false })
    const done = engine.report(claim.assignment.sessionId, 'ended', 'shipped')
    expect(done.ticket.state).toBe('ended')
    expect(done.ticket.outcome).toBe('completed')
    expect(done.notify).toBe(true)
    expect(() => engine.report(claim.assignment.sessionId, 'ended', 'again')).toThrowError(/terminal-twice/)
  })

  it('recovers a running assignment into a queued ticket with a recovery note', () => {
    const t = create()
    engine.dispatchNext()
    expect(engine.recover()).toBe(1)
    expect(store.ticket(t.id)?.state).toBe('queued')
    const claim = engine.dispatchNext()!
    expect(claim.assignment.attempt).toBe(2)
    expect(claim.assignment.recoveryNote).toContain('中断')
  })

  it('rejects retry from a non-retryable state and allows it from blocked', () => {
    const t = create()
    const claim = engine.dispatchNext()!
    engine.report(claim.assignment.sessionId, 'blocked', 'need a decision')
    expect(store.ticket(t.id)?.state).toBe('blocked')
    expect(engine.retry(t.id).state).toBe('queued')
    expect(() => engine.retry(t.id)).toThrowError(/not-retryable/)
  })

  it('stops a working ticket and returns its session id', () => {
    const t = create()
    engine.dispatchNext()
    const stopped = engine.stop(t.id)
    expect(stopped.ticket.state).toBe('ended')
    expect(stopped.ticket.outcome).toBe('stopped')
    expect(stopped.sessionId).toBe(`worker-${t.id}`)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/engine.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/engine.ts`**

```ts
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
      const assignment: Assignment = {
        id: id('a'), ticketId: next.id, attempt: (previous?.attempt ?? 0) + 1, state: 'running',
        sessionId: `worker-${next.id}`, startedAt: now(), ...(recoveryNote === undefined ? {} : { recoveryNote }),
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

  listTickets(limit = 50): Ticket[] {
    return [...this.store.openTickets(), ...this.store.recentEnded(Math.min(10, limit))]
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/engine.spec.ts`
Expected: 6 passed. (`toEqual({ ticket: expect.objectContaining(...) })` may need `expect.objectContaining` at top level; if it fails, assert fields separately — fix the test, not the engine.)

- [ ] **Step 5: Commit**

```bash
git add plugins/dsh-mini-superagent/src/engine.ts plugins/dsh-mini-superagent/tests/engine.spec.ts
git commit -m "feat(mini-superagent): add durable ticket state machine"
```

---

### Task 4: Sessions adapter (workspace, hub, workers, mandate)

**Files:**
- Create: `plugins/dsh-mini-superagent/src/sessions.ts`
- Test: `plugins/dsh-mini-superagent/tests/sessions.spec.ts`

**Interfaces:**
- Consumes: `Store`, `Ticket`, `Assignment`, `now`.
- Produces: `type Role = 'hub' | 'worker' | 'other'`; `roleOf(sessionId, hubSessionId)`, `mandateFor(ticket, workspaceDir, recoveryNote?)`, and `class Sessions` with `constructor(host)`, `ensureWorkspace(): Promise<string>`, `ensureHub(): Promise<string>`, `launch(ticket, assignment): Promise<void>`, `send(sessionId, text, mode?): Promise<void>`.
- Host contract: `{ stateDir, workerPreset, store, session: { create, rename, resolve, prompt }, workspace: { create }, decorated(id, timeoutMs): Promise<void> }`.

- [ ] **Step 1: Write the failing sessions test**

`tests/sessions.spec.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mandateFor, roleOf, Sessions } from '../src/sessions.ts'
import { Store } from '../src/store.ts'
import { assignment, ticket } from './fixtures.ts'

let dir: string
let store: Store

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mini-sessions-')); store = new Store(join(dir, 'state.sqlite')) })
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

const fakeHost = () => {
  const created: string[] = []
  const prompted: { sessionId: string; text: string }[] = []
  return {
    created, prompted,
    host: {
      stateDir: dir, workerPreset: 'standard', store,
      session: {
        create: async ({ sessionId }: { sessionId: string }) => { created.push(sessionId) },
        rename: async () => {},
        resolve: async (sessionId: string) => created.includes(sessionId),
        prompt: async ({ sessionId, content }: { sessionId: string; content: { text: string }[] }) => { prompted.push({ sessionId, text: content[0]!.text }) },
      },
      workspace: { create: async () => ({ id: 'ws-1' }) },
      decorated: async () => {},
    },
  }
}

describe('roles', () => {
  it('classifies hub, worker and other sessions', () => {
    expect(roleOf('mini-hub-abcd', 'mini-hub-abcd')).toBe('hub')
    expect(roleOf('worker-t-1', 'mini-hub-abcd')).toBe('worker')
    expect(roleOf('some-session', 'mini-hub-abcd')).toBe('other')
  })

  it('renders the mandate with the workspace-relative ticket folder', () => {
    const text = mandateFor(ticket(), '/tmp/mini/superagent')
    expect(text).toContain('work/t-1a2b3c4d')
    expect(text).toContain('report({ state: "ended"')
  })
})

describe('Sessions', () => {
  it('creates the hub once and reuses the stored id', async () => {
    const f = fakeHost()
    const sessions = new Sessions(f.host)
    const first = await sessions.ensureHub()
    const second = await sessions.ensureHub()
    expect(first).toBe(second)
    expect(f.created.filter(id => id.startsWith('mini-hub-'))).toHaveLength(1)
    expect(store.meta('hub_session')).toBe(first)
  })

  it('launches a worker session and prompts the mandate', async () => {
    const f = fakeHost()
    const sessions = new Sessions(f.host)
    await sessions.launch(ticket(), assignment())
    expect(f.created).toContain('worker-t-1a2b3c4d')
    expect(f.prompted[0]?.text).toContain('票据 t-1a2b3c4d')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/sessions.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/sessions.ts`**

```ts
import { randomBytes, randomUUID } from 'node:crypto'
import type { Store } from './store.ts'
import type { Assignment, Ticket } from './types.ts'

export type Role = 'hub' | 'worker' | 'other'

export const roleOf = (sessionId: string, hubSessionId: string | undefined): Role =>
  sessionId === hubSessionId ? 'hub' : sessionId.startsWith('worker-') ? 'worker' : 'other'

export function mandateFor(ticket: Ticket, workspaceDir: string, recoveryNote?: string): string {
  return [
    `你是 mini-superagent 的 worker，只负责票据 ${ticket.id}。`,
    '', '请求：', ticket.request, '',
    `工作目录：${ticket.workDir}（相对 ${workspaceDir}，先 cd 进去或用该前缀）`, '',
    '规则：',
    '- 只在该子目录内改动；不要创建或管理工作项。',
    '- 有结论时调用 report({ state: "ended", summary: "做了什么、验证了什么" })。',
    '- 需要人拍板时调用 report({ state: "blocked", summary: "卡在哪、需要什么" })。',
    '- 失败时调用 report({ state: "failed", summary: "错误与已尝试的动作" })。',
    '- 这一轮先收工时调用 report({ state: "waiting", summary: "下一步" })。',
    '- 不要向用户提问（没有问答通道），把问题写进 blocked 的 summary。',
    '- 终态 report 之后不要再调用 report。',
    ...(recoveryNote === undefined ? [] : ['', recoveryNote]),
  ].join('\n')
}

export interface SessionsHost {
  stateDir: string
  workerPreset: string
  store: Store
  session: {
    create(request: { sessionId: string; workspaceId: string; agentPreset?: string }): Promise<void>
    rename(request: { sessionId: string; title: string }): Promise<void>
    resolve(sessionId: string): Promise<boolean>
    prompt(request: { requestId: string; sessionId: string; mode: 'queue' | 'steer'; content: { type: 'text'; text: string }[] }): Promise<void>
  }
  workspace: { create(cwd: string): Promise<{ id: string }> }
  decorated(sessionId: string, timeoutMs: number): Promise<void>
}

export class Sessions {
  constructor(private readonly host: SessionsHost) {}

  get workspaceDir(): string { return `${this.host.stateDir}/superagent` }

  async ensureWorkspace(): Promise<string> {
    const known = this.host.store.meta('workspace')
    if (known !== undefined) return known
    const workspace = await this.host.workspace.create(this.workspaceDir)
    this.host.store.setMeta('workspace', workspace.id)
    return workspace.id
  }

  async ensureHub(): Promise<string> {
    const known = this.host.store.meta('hub_session')
    if (known !== undefined && await this.host.session.resolve(known)) return known
    const workspaceId = await this.ensureWorkspace()
    const sessionId = `mini-hub-${randomBytes(4).toString('hex')}`
    await this.host.session.create({ sessionId, workspaceId, agentPreset: this.host.workerPreset })
    await this.host.session.rename({ sessionId, title: 'SuperAgent' })
    this.host.store.setMeta('hub_session', sessionId)
    return sessionId
  }

  async launch(ticket: Ticket, assignment: Assignment): Promise<void> {
    const workspaceId = await this.ensureWorkspace()
    await this.host.session.create({ sessionId: assignment.sessionId, workspaceId, agentPreset: this.host.workerPreset })
    await this.host.session.rename({ sessionId: assignment.sessionId, title: `worker ${ticket.id}` })
    await this.host.decorated(assignment.sessionId, 5000)
    await this.send(assignment.sessionId, mandateFor(ticket, this.workspaceDir, assignment.recoveryNote), 'queue')
  }

  async send(sessionId: string, text: string, mode: 'queue' | 'steer' = 'queue'): Promise<void> {
    await this.host.session.prompt({ requestId: `mini-${randomUUID()}`, sessionId, mode, content: [{ type: 'text', text }] })
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/sessions.spec.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add plugins/dsh-mini-superagent/src/sessions.ts plugins/dsh-mini-superagent/tests/sessions.spec.ts
git commit -m "feat(mini-superagent): add hub/worker session adapter and mandate"
```

---

### Task 5: Agent tools (hub + worker scopes)

**Files:**
- Create: `plugins/dsh-mini-superagent/src/tools.ts`
- Test: `plugins/dsh-mini-superagent/tests/tools.spec.ts`

**Interfaces:**
- Consumes: `Engine`, `Sessions`, `roleOf`, `Store`.
- Produces: `interface Tool { name; description; schema: z.ZodType; execute(args, signal) }`, `hubTools(deps): Tool[]` (`request_work`, `list_tickets`, `ticket_control`), `workerTools(deps): Tool[]` (`report`), and `interface ToolDeps { engine; sessions; hubSessionId(): string | undefined; onTerminal(ticket, line): Promise<void> }`.

- [ ] **Step 1: Write the failing tools test**

`tests/tools.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine } from '../src/engine.ts'
import { Store } from '../src/store.ts'
import { hubTools, workerTools } from '../src/tools.ts'

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mini-tools-'))
  const store = new Store(join(dir, 'state.sqlite'))
  const engine = new Engine(store)
  const sent: string[] = []
  const deps = {
    engine,
    sessions: { send: async (_id: string, text: string) => { sent.push(text) } },
    hubSessionId: () => 'mini-hub-1',
    onTerminal: async (_t: unknown, line: string) => { sent.push(line) },
  }
  return { dir, store, engine, deps, sent, done: () => { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

const run = async (tool: { execute: (a: unknown, s: AbortSignal) => Promise<unknown> }, args: unknown) =>
  tool.execute(args, new AbortController().signal)

describe('hub tools', () => {
  it('creates a ticket from request_work and reports its work dir', async () => {
    const s = setup()
    const tool = hubTools(s.deps).find(t => t.name === 'request_work')!
    const result = await run(tool, { title: 'fix', request: 'do it' }) as { ticket: string; work_dir: string }
    expect(result.ticket).toMatch(/^t-/)
    expect(result.work_dir).toBe(`work/${result.ticket}`)
    s.done()
  })

  it('refuses calls from a worker session', async () => {
    const s = setup()
    const tool = hubTools({ ...s.deps, hubSessionId: () => 'mini-hub-1' }).find(t => t.name === 'request_work')!
    await expect(run(tool, { title: 'x', request: 'y', __session: 'worker-t-1' })).rejects.toThrow(/hub/i)
    s.done()
  })
})

describe('worker tools', () => {
  it('reports and pushes a terminal line through onTerminal', async () => {
    const s = setup()
    const t = s.engine.createTicket({ title: 'x', request: 'y', originSessionId: 'mini-hub-1' })
    const claim = s.engine.dispatchNext()!
    const tool = workerTools(s.deps).find(t2 => t2.name === 'report')!
    const result = await run(tool, { state: 'ended', summary: 'done', __session: claim.assignment.sessionId }) as { state: string }
    expect(result.state).toBe('ended')
    expect(s.sent.some(line => line.includes(t.id))).toBe(true)
    s.done()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/tools.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tools.ts`**

```ts
import { z } from 'zod'
import type { Engine } from './engine.ts'
import type { Sessions } from './sessions.ts'
import type { Ticket } from './types.ts'

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
        await deps.onTerminal(stopped.ticket, `已停止（用户）${stopped.sessionId ? `；如需立刻停手，去会话 ${stopped.sessionId} 按停止` : ''}`)
        return view(stopped.ticket)
      },
    },
  ]
}

const TERMINAL: ReadonlySet<string> = new Set(['waiting', 'blocked', 'failed', 'ended'])

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
        const input = args as { state: 'progress' | 'waiting' | 'blocked' | 'failed' | 'ended'; summary: string }
        const { ticket, notify } = deps.engine.report(session, input.state, input.summary)
        if (notify && TERMINAL.has(input.state)) {
          await deps.onTerminal(ticket, `${label(input.state)}：${input.summary}`)
        }
        return { state: ticket.state, terminal: TERMINAL.has(input.state) }
      },
    },
  ]
}

const label = (state: string): string => ({ waiting: '挂起', blocked: '卡住', failed: '失败', ended: '完成' })[state] ?? state
```

Note: `__session` is injected by the registration layer in Task 6; the model never sees it because `parameters` are generated from `schema` — the registration layer must merge the session id **after** parsing, not expose it. Adjust: registration passes `{ ...schema.parse(args), __session: agent.id }`. The schemas above therefore do not declare `__session`; `z.object` by default strips unknown keys, so parse first, then add. Tests call with `__session` directly for brevity — that works because `execute` reads it from the raw args. To keep tests and production consistent, the registration layer must call `tool.execute({ ...parsed, __session: agent.id }, signal)`.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/tools.spec.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add plugins/dsh-mini-superagent/src/tools.ts plugins/dsh-mini-superagent/tests/tools.spec.ts
git commit -m "feat(mini-superagent): add hub and worker tools"
```

---

### Task 6: Dispatcher, runtime wiring, HTTP and notices

**Files:**
- Create: `plugins/dsh-mini-superagent/src/dispatcher.ts`
- Create: `plugins/dsh-mini-superagent/src/server.ts`
- Modify: `plugins/dsh-mini-superagent/src/index.ts` (full runtime)
- Test: `plugins/dsh-mini-superagent/tests/dispatcher.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `class Dispatcher` (`constructor({engine, sessions, logger, maxWorkers})`, `kick()`, `tick()`, `start(intervalMs?)`, `stop()`), `registerRoutes(ctx, {sessions, engine, stateDir})`, and the real plugin `apply(ctx, config)` with lock, recover, tool registration on `agent/created`, and terminal notices to the hub.

- [ ] **Step 1: Write the failing dispatcher test**

`tests/dispatcher.spec.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Dispatcher } from '../src/dispatcher.ts'
import { Engine } from '../src/engine.ts'
import { Store } from '../src/store.ts'

let dir: string
let store: Store
let engine: Engine

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mini-dispatch-'))
  store = new Store(join(dir, 'state.sqlite'))
  engine = new Engine(store)
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

describe('Dispatcher', () => {
  it('claims at most maxWorkers tickets and launches each once', async () => {
    const launched: string[] = []
    const dispatcher = new Dispatcher({
      engine, maxWorkers: 1, logger: { warn() {}, info() {} },
      sessions: { launch: async (ticket: { id: string }) => { launched.push(ticket.id) } } as never,
    })
    engine.createTicket({ title: 'a', request: 'a', originSessionId: 'mini-hub-1' })
    engine.createTicket({ title: 'b', request: 'b', originSessionId: 'mini-hub-1' })
    await dispatcher.tick()
    expect(launched).toHaveLength(1)
    expect(store.openTickets().filter(t => t.state === 'working')).toHaveLength(1)
  })

  it('fails the ticket when launch throws', async () => {
    const dispatcher = new Dispatcher({
      engine, maxWorkers: 1, logger: { warn() {}, info() {} },
      sessions: { launch: async () => { throw new Error('no session') } } as never,
    })
    const t = engine.createTicket({ title: 'a', request: 'a', originSessionId: 'mini-hub-1' })
    await dispatcher.tick()
    expect(store.ticket(t.id)?.state).toBe('failed')
    expect(store.ticket(t.id)?.summary).toContain('no session')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/dispatcher.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/dispatcher.ts`**

```ts
import type { Engine } from './engine.ts'
import type { Sessions } from './sessions.ts'

export interface DispatcherDeps {
  engine: Engine
  sessions: Pick<Sessions, 'launch'>
  logger: { info(message: string): void; warn(message: string): void }
  maxWorkers: number
}

export class Dispatcher {
  private inflight = false
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly deps: DispatcherDeps) {}

  kick(): void { queueMicrotask(() => { void this.tick() }) }

  async tick(): Promise<void> {
    if (this.inflight) return
    this.inflight = true
    try {
      let running = this.deps.engine.listTickets(200).filter(t => t.state === 'working').length
      while (running < this.deps.maxWorkers) {
        const claim = this.deps.engine.dispatchNext()
        if (claim === undefined) break
        running += 1
        try { await this.deps.sessions.launch(claim.ticket, claim.assignment) }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this.deps.engine.failDispatch(claim.ticket.id, message)
          this.deps.logger.warn(`dispatch failed for ${claim.ticket.id}: ${message}`)
        }
      }
    } finally { this.inflight = false }
  }

  start(intervalMs = 1000): void {
    this.stop()
    this.timer = setInterval(() => { void this.tick() }, intervalMs)
  }

  stop(): void {
    if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined }
  }
}
```

Note: `running` via `listTickets(200)` includes ended tickets; filter is on `working`, which is exact. If more than 200 open tickets exist, the count under-reads — acceptable for M1 (documented in README).

- [ ] **Step 4: Run the dispatcher tests**

Run: `pnpm vitest run tests/dispatcher.spec.ts`
Expected: 2 passed.

- [ ] **Step 5: Implement `src/server.ts` (HTTP) and wire `src/index.ts`**

`src/server.ts`:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { Engine } from './engine.ts'
import type { Sessions } from './sessions.ts'

export function registerRoutes(ctx: Context, deps: { sessions: Sessions; engine: Engine }): (() => void)[] {
  const json = (res: ServerResponse, status: number, value: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  }
  const hub = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const hubSessionId = await deps.sessions.ensureHub()
      json(res, 200, { hubSessionId, tickets: deps.engine.listTickets(50) })
    } catch (error) { json(res, 500, { error: error instanceof Error ? error.message : String(error) }) }
  }
  const health = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const tickets = deps.engine.listTickets(200)
    json(res, 200, { ok: true, running: tickets.filter(t => t.state === 'working').length, queued: tickets.filter(t => t.state === 'queued').length })
  }
  return [
    ctx.webServer.register({ kind: 'exact', path: '/mini-superagent/api/hub', handler: hub }),
    ctx.webServer.register({ kind: 'exact', path: '/mini-superagent/api/health', handler: health }),
  ]
}
```

`src/index.ts`:

```ts
import { mkdirSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { lockSync } from 'proper-lockfile'
import { z } from 'zod'
import { Config, type MiniConfig } from './config.ts'
import { Dispatcher } from './dispatcher.ts'
import { Engine } from './engine.ts'
import { registerRoutes } from './server.ts'
import { roleOf, Sessions } from './sessions.ts'
import { Store } from './store.ts'
import { hubTools, workerTools, type Tool } from './tools.ts'
import type { Ticket } from './types.ts'

export const name = 'mini-superagent'
export const inject = ['agents', 'sessionController', 'workspaceRegistry', 'tools', 'webServer']
export { Config }

const TERMINAL_LINE: Record<string, string> = { ended: '完成', blocked: '卡住', failed: '失败', waiting: '挂起' }

export async function apply(ctx: Context, config: MiniConfig): Promise<void> {
  mkdirSync(config.stateDir, { recursive: true, mode: 0o700 })
  const store = new Store(`${config.stateDir}/state.sqlite`)
  const release = lockSync(config.stateDir, { stale: 30_000 })
  const engine = new Engine(store)
  const decorated = new Map<string, () => void>()
  const waiters = new Map<string, { resolve: () => void; timer: NodeJS.Timeout }>()

  const sessionHost = {
    create: async (request: { sessionId: string; workspaceId: string; agentPreset?: string }) => {
      await ctx.sessionController.create(request as never)
    },
    rename: async (request: { sessionId: string; title: string }) => { await ctx.sessionController.rename(request as never) },
    resolve: async (sessionId: string) => {
      const result = await ctx.sessionController.resolveAgent(sessionId as never)
      return !('error' in result)
    },
    prompt: async (request: unknown) => { await ctx.sessionController.prompt(request as never, AbortSignal.timeout(30_000)) },
  }
  const sessions = new Sessions({
    stateDir: config.stateDir, workerPreset: config.workerPreset, store,
    session: sessionHost, workspace: { create: async (cwd: string) => ctx.workspaceRegistry.create(cwd) },
    decorated: (sessionId: string, timeoutMs: number) => new Promise<void>((resolve, reject) => {
      if (decorated.has(sessionId)) { resolve(); return }
      const timer = setTimeout(() => { waiters.delete(sessionId); reject(new Error(`worker ${sessionId} was not decorated within ${timeoutMs}ms`)) }, timeoutMs)
      waiters.set(sessionId, { resolve: () => { clearTimeout(timer); waiters.delete(sessionId); resolve() }, timer })
    }),
  })

  const notify = async (ticket: Ticket, text: string): Promise<void> => {
    try { await sessions.send(ticket.originSessionId, `[minisuperagent] ${ticket.id} ${text}`, 'queue') }
    catch (error) { ctx.logger.warn(`mini-superagent notice failed for ${ticket.id}: ${String(error)}`) }
  }

  const deps = { engine, sessions, hubSessionId: () => store.meta('hub_session'), onTerminal: notify }

  const HUB_PROMPT = [
    '你是 SuperAgent 的调度员。用户会把活交给你；判断清楚后调用 request_work 派给一个隔离的 worker 会话。',
    '派发后只回一句“已派发 <ticket id>”，不要复述任务细节。',
    '收到以 [minisuperagent] 开头的消息时，只做一行转述（完成了什么 / 卡在哪），不要展开分析。',
    '用户问进度时调用 list_tickets；要重试或停止时调用 ticket_control。',
  ].join('\n')

  const register = (agent: Agent, tools: Tool[], hub = false): void => {
    const disposers: (() => void)[] = []
    if (hub) disposers.push(agent.ctx.systemPrompt.section({ name: 'mini-superagent-hub', order: 100, text: HUB_PROMPT }))
    disposers.push(...tools.map(tool => agent.ctx.tools.register({
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.schema),
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: (args, execution) => tool.execute({ ...tool.schema.parse(args), __session: agent.id }, execution.signal),
    })))
    decorated.set(agent.id, () => { for (const dispose of disposers) dispose() })
    waiters.get(agent.id)?.resolve()
  }

  ctx.on('agent/created', ({ agent }) => {
    const role = roleOf(agent.id, store.meta('hub_session'))
    if (role === 'hub') register(agent, hubTools(deps), true)
    else if (role === 'worker') register(agent, workerTools(deps))
    return undefined
  })

  const dispatcher = new Dispatcher({ engine, sessions, logger: ctx.logger, maxWorkers: config.maxWorkers })
  const recovered = engine.recover()
  if (recovered > 0) ctx.logger.info(`mini-superagent recovered ${recovered} interrupted assignment(s)`)
  const routes = registerRoutes(ctx, { sessions, engine })
  dispatcher.tick(); dispatcher.start(1000)

  ctx.effect(() => async () => {
    dispatcher.stop()
    engine.interruptAll()
    for (const dispose of routes) dispose()
    store.close()
    await release()
  })
}
```

M1 不对"插件挂载前已加载的 agent"做补注册：插件在 boot 时挂载，所有会话都在其后创建，`agent/created` 足够；HMR 重载场景留到 M4（届时用注册表遍历补一次）。

Note: `ctx.effect` disposer shape and `ctx.logger` are used exactly as in `dsh-superagent`'s `src/index.ts`; `sessionController.create`/`rename`/`prompt` accept the request objects shown in the spec. Type-cast at this boundary and let `pnpm typecheck` refine the exact generics.

- [ ] **Step 6: Build and typecheck**

Run:
```bash
cd plugins/dsh-mini-superagent && pnpm typecheck && pnpm build && node -e "import('./lib/index.js').then(m => console.log(m.name))"
```
Expected: `mini-superagent`.

- [ ] **Step 7: Commit**

```bash
git add plugins/dsh-mini-superagent/src
git commit -m "feat(mini-superagent): add dispatcher, http routes and runtime wiring"
```

---

### Task 7: Sidebar panel, profile wiring and manual verification

**Files:**
- Create: `plugins/dsh-mini-superagent/src/client/index.tsx`
- Create: `plugins/dsh-mini-superagent/README.md`
- Test: `plugins/dsh-mini-superagent/tests/panel.spec.tsx`

**Interfaces:**
- Consumes: HTTP `GET /mini-superagent/api/hub`; client services `slots`, `uiWorkspace` (`openSession(sessionId: string)`).
- Produces: client entry registering `sidebar.panellist` + `main` panel keyed `dsh-mini-superagent`, and `fetchHub(impl, signal)` used by both panel and tests.

- [ ] **Step 1: Write the failing panel test**

`tests/panel.spec.tsx`:

```tsx
// @vitest-environment jsdom
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { fetchHub, TicketTable } from '../src/client/index.tsx'

describe('panel data', () => {
  it('fetches the hub payload', async () => {
    const fake = async () => new Response(JSON.stringify({ hubSessionId: 'mini-hub-1', tickets: [] }), { status: 200 })
    await expect(fetchHub(fake)).resolves.toEqual({ hubSessionId: 'mini-hub-1', tickets: [] })
  })

  it('renders ticket rows', () => {
    const html = renderToString(<TicketTable tickets={[{ ticket: 't-1', title: 'fix readme', state: 'working', summary: 'halfway' }]} />)
    expect(html).toContain('fix readme')
    expect(html).toContain('working')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/panel.spec.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/client/index.tsx`**

```tsx
import { useEffect, useState } from 'react'

export interface TicketView { ticket: string; title: string; state: string; summary?: string | null }

export async function fetchHub(fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<{ hubSessionId: string; tickets: TicketView[] }> {
  const response = await fetchImpl('/mini-superagent/api/hub', { signal, headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`hub request failed: ${response.status}`)
  return await response.json() as { hubSessionId: string; tickets: TicketView[] }
}

export function TicketTable({ tickets }: { tickets: TicketView[] }): React.ReactElement {
  if (tickets.length === 0) return <p>还没有票据。打开主会话派第一个活。</p>
  return (
    <table>
      <thead><tr><th>票据</th><th>标题</th><th>状态</th><th>摘要</th></tr></thead>
      <tbody>
        {tickets.map(row => (
          <tr key={row.ticket}>
            <td>{row.ticket}</td><td>{row.title}</td><td>{row.state}</td><td>{row.summary ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface PanelProps { openSession(sessionId: string): void }

export function Panel({ openSession }: PanelProps): React.ReactElement {
  const [data, setData] = useState<{ hubSessionId: string; tickets: TicketView[] }>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    const load = async () => { try { setData(await fetchHub(fetch, controller.signal)) } catch (e) { if (!controller.signal.aborted) setError(String(e)) } }
    void load()
    const timer = setInterval(() => { void load() }, 3000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [])
  return (
    <div>
      <h2>SuperAgent</h2>
      <button disabled={data === undefined} onClick={() => { if (data) openSession(data.hubSessionId) }}>打开主会话</button>
      {error === undefined ? null : <p role="alert">{error}</p>}
      <TicketTable tickets={data?.tickets ?? []} />
    </div>
  )
}

const Icon = (): React.ReactElement => <span aria-hidden>SG</span>

export const inject = ['slots', 'uiWorkspace']

export function apply(ctx: { slots: any; uiWorkspace: { openSession(id: string): void } }): void {
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: 'dsh-mini-superagent', order: 20, label: () => 'SuperAgent' }, Icon))
  ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: 'dsh-mini-superagent' }, () => <Panel openSession={id => ctx.uiWorkspace.openSession(id)} />))
}
```

- [ ] **Step 4: Run tests and build**

Run: `cd plugins/dsh-mini-superagent && pnpm test && pnpm typecheck && pnpm build`
Expected: all tests pass; `lib/client.js` exists and starts with `window.__ModuleLoader__.load`.

- [ ] **Step 5: Write README and wire the profile**

`README.md` must state: what it does, the three invariants, install (`pnpm install && pnpm build`, `dsh plugin --profile web add "link:$PWD"`), profile config (`stateDir`), that sessions live in `<stateDir>/superagent` and appear as one sidebar group, that worker sessions run with `danger-full-access`, and that it takes effect after a DSH restart.

Profile `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- id: mini-superagent
  config:
    stateDir: /root/.dsh/state/mini-superagent
```

Then, without restarting anything, verify the composition read-only:

```bash
dsh --profile web --dump-config | grep -n "mini-superagent"
```

Expected: the inserted entry appears once.

- [ ] **Step 6: Commit**

```bash
git add plugins/dsh-mini-superagent
git commit -m "feat(mini-superagent): add sidebar panel, docs and profile wiring"
```

- [ ] **Step 7: Hand over for user verification**

Report: build green, tests green, `--dump-config` shows the entry, and **需用户重启 DSH 服务后生效**. After restart the user verifies: sidebar SuperAgent entry → 打开主会话 → 派活 → worker 会话出现在 `superagent` 分组 → 回推一行 → kill -9 重启后票自动接上。

---

## Manual verification checklist (after the user restarts)

- [ ] Sidebar shows the SuperAgent entry; clicking it opens the ticket panel.
- [ ] The hub session exists and is the only session with `request_work`; a normal session does not expose it.
- [ ] Dispatching creates `worker-<ticket>` under the `superagent` group within ~1s.
- [ ] Worker context contains only the mandate (no hub history).
- [ ] Terminal report produces one `[minisuperagent]` line in the hub session.
- [ ] `kill -9` during a worker turn → after restart the ticket is `queued`, then attempt 2 with a recovery note.
- [ ] `git status --short` clean.
