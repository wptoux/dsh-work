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
    `工作目录：${ticket.workDir}（相对 ${workspaceDir}，每条命令都带上该前缀）`, '',
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
  private workspacePromise: Promise<string> | undefined
  private hubPromise: Promise<string> | undefined

  constructor(private readonly host: SessionsHost) {}

  get workspaceDir(): string { return `${this.host.stateDir}/superagent` }

  async ensureWorkspace(): Promise<string> {
    const known = this.host.store.meta('workspace')
    if (known !== undefined) return known
    if (this.workspacePromise === undefined) {
      this.workspacePromise = this.createWorkspace().finally(() => { this.workspacePromise = undefined })
    }
    return this.workspacePromise
  }

  private async createWorkspace(): Promise<string> {
    const workspace = await this.host.workspace.create(this.workspaceDir)
    this.host.store.setMeta('workspace', workspace.id)
    return workspace.id
  }

  async ensureHub(): Promise<string> {
    const known = this.host.store.meta('hub_session')
    if (known !== undefined && await this.host.session.resolve(known)) return known
    if (this.hubPromise === undefined) {
      this.hubPromise = this.createHub().finally(() => { this.hubPromise = undefined })
    }
    return this.hubPromise
  }

  private async createHub(): Promise<string> {
    const workspaceId = await this.ensureWorkspace()
    const sessionId = `mini-hub-${randomBytes(4).toString('hex')}`
    // Record the id BEFORE creating: `session.create` publishes the live agent (and
    // fires `agent/created`) before it resolves, so the role lookup must already see it.
    this.host.store.setMeta('hub_session', sessionId)
    await this.host.session.create({ sessionId, workspaceId, agentPreset: this.host.workerPreset })
    await this.host.session.rename({ sessionId, title: 'SuperAgent' })
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
