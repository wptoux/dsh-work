import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine } from '../src/engine.ts'
import { Store } from '../src/store.ts'
import { hubTools, workerTools, type Tool } from '../src/tools.ts'

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mini-tools-'))
  const store = new Store(join(dir, 'state.sqlite'))
  const engine = new Engine(store)
  const sent: string[] = []
  const terminal: { ticket: string; line: string }[] = []
  const deps = {
    engine,
    sessions: { send: async (_id: string, text: string) => { sent.push(text) } },
    hubSessionId: () => 'mini-hub-1',
    onTerminal: async (t: { id: string }, line: string) => { terminal.push({ ticket: t.id, line }) },
  }
  return { dir, store, engine, deps, sent, terminal, done: () => { store.close(); rmSync(dir, { recursive: true, force: true }) } }
}

const toolNamed = (tools: Tool[], name: string): Tool => tools.find(t => t.name === name)!

const run = async (tool: Tool, args: unknown): Promise<unknown> =>
  tool.execute(args, new AbortController().signal)

describe('hub tools', () => {
  it('creates a ticket from request_work and reports its work dir', async () => {
    const s = setup()
    const tool = toolNamed(hubTools(s.deps), 'request_work')
    const result = await run(tool, { title: 'fix', request: 'do it', __session: 'mini-hub-1' }) as { ticket: string; work_dir: string }
    expect(result.ticket).toMatch(/^t-/)
    expect(result.work_dir).toBe(`work/${result.ticket}`)
    s.done()
  })

  it('refuses calls from a worker session', async () => {
    const s = setup()
    const tool = toolNamed(hubTools({ ...s.deps, hubSessionId: () => 'mini-hub-1' }), 'request_work')
    await expect(run(tool, { title: 'x', request: 'y', __session: 'worker-t-1' })).rejects.toThrow(/hub/i)
    s.done()
  })

  it('refuses every hub tool when the caller has no hub identity', async () => {
    const s = setup()
    for (const tool of hubTools(s.deps)) {
      await expect(run(tool, { __session: 'some-session' })).rejects.toThrow(/hub/i)
      await expect(run(tool, {})).rejects.toThrow(/session identity/)
    }
    expect(s.engine.listTickets()).toEqual([])
    s.done()
  })

  it('lists tickets with the requested limit', async () => {
    const s = setup()
    s.engine.createTicket({ title: 'a', request: 'b', originSessionId: 'mini-hub-1' })
    const tool = toolNamed(hubTools(s.deps), 'list_tickets')
    const result = await run(tool, { limit: 5, __session: 'mini-hub-1' }) as { tickets: { ticket: string; state: string }[] }
    expect(result.tickets).toHaveLength(1)
    expect(result.tickets[0]!.state).toBe('queued')
    s.done()
  })

  it('retries a blocked ticket through ticket_control', async () => {
    const s = setup()
    const ticket = s.engine.createTicket({ title: 'a', request: 'b', originSessionId: 'mini-hub-1' })
    const claim = s.engine.dispatchNext()!
    s.engine.report(claim.assignment.sessionId, 'blocked', 'need a decision')
    const tool = toolNamed(hubTools(s.deps), 'ticket_control')
    const result = await run(tool, { action: 'retry', ticket_id: ticket.id, __session: 'mini-hub-1' }) as { ticket: string; state: string }
    expect(result.state).toBe('queued')
    s.done()
  })

  it('stops a ticket and pushes a terminal line naming its session', async () => {
    const s = setup()
    const ticket = s.engine.createTicket({ title: 'a', request: 'b', originSessionId: 'mini-hub-1' })
    const claim = s.engine.dispatchNext()!
    const tool = toolNamed(hubTools(s.deps), 'ticket_control')
    const result = await run(tool, { action: 'stop', ticket_id: ticket.id, __session: 'mini-hub-1' }) as { state: string }
    expect(result.state).toBe('ended')
    expect(s.terminal).toHaveLength(1)
    expect(s.terminal[0]!.ticket).toBe(ticket.id)
    expect(s.terminal[0]!.line).toContain(claim.assignment.sessionId)
    s.done()
  })
})

describe('worker tools', () => {
  it('reports and pushes a terminal line through onTerminal', async () => {
    const s = setup()
    const t = s.engine.createTicket({ title: 'x', request: 'y', originSessionId: 'mini-hub-1' })
    const claim = s.engine.dispatchNext()!
    const tool = toolNamed(workerTools(s.deps), 'report')
    const result = await run(tool, { state: 'ended', summary: 'done', __session: claim.assignment.sessionId }) as { state: string }
    expect(result.state).toBe('ended')
    expect(s.terminal).toHaveLength(1)
    expect(s.terminal[0]!.ticket).toBe(t.id)
    expect(s.terminal[0]!.line).toContain('done')
    s.done()
  })

  it('does not notify on a progress report', async () => {
    const s = setup()
    s.engine.createTicket({ title: 'x', request: 'y', originSessionId: 'mini-hub-1' })
    const claim = s.engine.dispatchNext()!
    const tool = toolNamed(workerTools(s.deps), 'report')
    const result = await run(tool, { state: 'progress', summary: 'still working', __session: claim.assignment.sessionId }) as { terminal: boolean }
    expect(result.terminal).toBe(false)
    expect(s.sent).toEqual([])
    expect(s.terminal).toEqual([])
    s.done()
  })

  it('refuses callers without a session identity', async () => {
    const s = setup()
    const tool = toolNamed(workerTools(s.deps), 'report')
    await expect(run(tool, { state: 'ended', summary: 'done' })).rejects.toThrow(/session identity/)
    s.done()
  })
})
