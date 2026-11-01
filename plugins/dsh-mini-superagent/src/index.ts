import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Loads the host service types these files consume (cordis Context augmentations).
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import { lockSync } from 'proper-lockfile'
import { z } from 'zod'
import { Config, type MiniConfig } from './config.ts'
import { Dispatcher } from './dispatcher.ts'
import { Engine } from './engine.ts'
import { registerRoutes } from './server.ts'
import { roleOf, Sessions } from './sessions.ts'
import { Store } from './store.ts'
import { hubTools, workerTools, type Tool, type ToolDeps } from './tools.ts'
import type { Ticket } from './types.ts'

export const name = 'mini-superagent'
export const inject = ['agents', 'sessionController', 'workspaceRegistry', 'tools', 'webServer']
export { Config }

/** Request shapes re-used from the real services instead of restating their branded ids. */
type CreateRequest = Parameters<Context['sessionController']['create']>[0]
type PromptRequest = Parameters<Context['sessionController']['prompt']>[0]
type ResolveRequest = Parameters<Context['sessionController']['resolveAgent']>[0]
type SessionKey = NonNullable<CreateRequest['sessionId']>

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

const HUB_PROMPT = [
  '你是 SuperAgent 的调度员。用户会把活交给你；判断清楚后调用 request_work 派给一个隔离的 worker 会话。',
  '派发后只回一句“已派发 <ticket id>”，不要复述任务细节。',
  '收到以 [minisuperagent] 开头的消息时，只做一行转述（完成了什么 / 卡在哪），不要展开分析。',
  '用户问进度时调用 list_tickets；要重试或停止时调用 ticket_control。',
].join('\n')

/**
 * Plugin entry: owns the state directory lock, wires the session adapter to the
 * DSH services, registers hub/worker tools per agent, dispatches queued tickets,
 * and forwards terminal notices back to the hub session.
 */
export async function apply(ctx: Context, config: MiniConfig): Promise<void> {
  mkdirSync(config.stateDir, { recursive: true, mode: 0o700 })
  const release = lockSync(config.stateDir, { stale: 30_000 })
  let store: Store
  try { store = new Store(join(config.stateDir, 'state.sqlite')) }
  catch (error) { await release(); throw error }
  const engine = new Engine(store)

  const waiters = new Map<string, (error?: Error) => void>()
  const decoratedIds = new Set<string>()
  const routes: (() => void)[] = []
  let dispatcher: Dispatcher | undefined
  let disposed = false

  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    dispatcher?.stop()
    const closing = new Error('mini-superagent is shutting down')
    for (const settle of [...waiters.values()]) settle(closing)
    waiters.clear()
    try { engine.interruptAll() }
    catch (error) { ctx.logger.warn(`mini-superagent could not interrupt assignments: ${messageOf(error)}`) }
    for (const off of routes.splice(0)) off()
    store.close()
    await release()
  }

  try {
    ctx.effect(() => dispose)

    const decoratedSession = (sessionId: string, timeoutMs: number): Promise<void> => {
      if (decoratedIds.has(sessionId)) return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(sessionId)
          reject(new Error(`worker ${sessionId} was not decorated within ${timeoutMs}ms`))
        }, timeoutMs)
        waiters.set(sessionId, (error) => {
          clearTimeout(timer)
          waiters.delete(sessionId)
          if (error === undefined) resolve()
          else reject(error)
        })
      })
    }

    const sessions = new Sessions({
      stateDir: config.stateDir,
      workerPreset: config.workerPreset,
      store,
      session: {
        create: async (request) => {
          await ctx.sessionController.create({
            sessionId: request.sessionId as SessionKey,
            workspaceId: request.workspaceId as NonNullable<CreateRequest['workspaceId']>,
            ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
          })
        },
        rename: async (request) => {
          await ctx.sessionController.rename({ sessionId: request.sessionId as SessionKey, title: request.title })
        },
        resolve: async (sessionId) => !('error' in await ctx.sessionController.resolveAgent(sessionId as ResolveRequest)),
        prompt: async (request) => {
          await ctx.sessionController.prompt({
            requestId: request.requestId as PromptRequest['requestId'],
            sessionId: request.sessionId as SessionKey,
            mode: request.mode,
            content: request.content,
          }, AbortSignal.timeout(30_000))
        },
      },
      workspace: {
        create: async (cwd) => ({ id: (await ctx.workspaceRegistry.create(cwd)).id }),
      },
      decorated: decoratedSession,
    })

    const notify = async (ticket: Ticket, line: string): Promise<void> => {
      try { await sessions.send(ticket.originSessionId, `[minisuperagent] ${ticket.id} ${line}`) }
      catch (error) { ctx.logger.warn(`mini-superagent notice failed for ${ticket.id}: ${messageOf(error)}`) }
    }

    const toolDeps: ToolDeps = {
      engine,
      sessions,
      hubSessionId: () => store.meta('hub_session'),
      onTerminal: notify,
    }

    const register = (agent: Agent, tools: Tool[], hub = false): void => {
      if (hub) agent.ctx.systemPrompt.section({ name: 'mini-superagent-hub', order: 100, text: HUB_PROMPT })
      for (const tool of tools) {
        const definition: ToolDefinition = {
          name: tool.name,
          description: tool.description,
          parameters: z.toJSONSchema(tool.schema) as Record<string, unknown>,
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
          },
          execute: (args, execution) => {
            // The model schema must NOT see `__session`; inject it after parsing instead.
            const parsed = tool.schema.parse(args) as Record<string, unknown>
            return tool.execute({ ...parsed, __session: agent.id }, execution.signal)
          },
        }
        agent.ctx.tools.register(definition)
      }
      decoratedIds.add(agent.id)
      waiters.get(agent.id)?.()
    }

    ctx.on('agent/created', ({ agent }) => {
      const role = roleOf(agent.id, store.meta('hub_session'))
      if (role === 'hub') register(agent, hubTools(toolDeps), true)
      else if (role === 'worker') register(agent, workerTools(toolDeps))
      return undefined
    })
    ctx.on('agent/disposed', ({ agent }) => { decoratedIds.delete(agent.id) })

    dispatcher = new Dispatcher({ engine, sessions, logger: ctx.logger, maxWorkers: config.maxWorkers })
    const loop = dispatcher
    const recovered = engine.recover()
    ctx.logger.info(`mini-superagent recovered ${recovered} interrupted assignment(s)`)
    routes.push(...registerRoutes(ctx, { sessions, engine }))
    void loop.tick().catch(error => { ctx.logger.warn(`mini-superagent dispatch tick failed: ${messageOf(error)}`) })
    loop.start(1000)
  } catch (error) {
    await dispose()
    throw error
  }
}
