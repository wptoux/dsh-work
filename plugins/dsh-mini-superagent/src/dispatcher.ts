import type { Engine } from './engine.ts'
import type { Sessions } from './sessions.ts'

export interface DispatcherDeps {
  engine: Engine
  sessions: Pick<Sessions, 'launch'>
  logger: { info(message: string): void; warn(message: string): void }
  maxWorkers: number
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

/**
 * Bounded pull-dispatch loop: every tick claims queued tickets until
 * `maxWorkers` workers are running, then launches each claim exactly once.
 * One failed launch ends the tick instead of cascading into the next ticket,
 * so a broken host cannot fail every queued ticket in a single pass.
 */
export class Dispatcher {
  private inflight = false
  private stopped = false
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly deps: DispatcherDeps) {}

  async tick(): Promise<void> {
    if (this.inflight || this.stopped) return
    this.inflight = true
    try {
      let running = this.deps.engine.runningCount()
      while (!this.stopped && running < this.deps.maxWorkers) {
        const claim = this.deps.engine.dispatchNext()
        if (claim === undefined) break
        running += 1
        try {
          await this.deps.sessions.launch(claim.ticket, claim.assignment)
        } catch (error) {
          const message = messageOf(error)
          try { this.deps.engine.failDispatch(claim.ticket.id, message) }
          catch (failure) { this.deps.logger.warn(`could not fail ticket ${claim.ticket.id}: ${messageOf(failure)}`) }
          this.deps.logger.warn(`dispatch failed for ${claim.ticket.id}: ${message}`)
          break
        }
      }
    } finally { this.inflight = false }
  }

  start(intervalMs = 1000): void {
    this.stop()
    this.stopped = false
    this.timer = setInterval(() => {
      void this.tick().catch(error => { this.deps.logger.warn(`dispatch tick failed: ${messageOf(error)}`) })
    }, intervalMs)
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined }
  }
}
