/**
 * dsh-model-sync host half. On startup — and again at short bounded retries,
 * then every `intervalMs` — each configured mirror is synced: the latest pi-ai
 * catalog for the source route is fetched (disk-cached by version), new models
 * are appended to the mirror route's `models:` list in the `llm-pi-ai:`
 * settings section, and llm-pi-ai's reactive section re-materializes the route
 * so the GUI model picker updates without a restart. Failures are logged and
 * never touch live routes.
 *
 * The scheduler deliberately does NOT rely on the host's `ctx.setInterval`:
 * that member is a mixin of the `timer` service and is only present on
 * contexts that resolved it, which is not guaranteed for profile plugins at
 * apply time. A plain `setTimeout` chain with a dispose guard is robust
 * everywhere. Early bounded retries cover boot-order races: `ctx.inject`
 * resolves the `settings`/`llm` services the moment they exist, which can
 * precede the `llm-pi-ai` plugin's own apply — at that point its settings
 * section and routes are not registered yet and a first sync would skip.
 *
 * Every log line the sync emits is also appended to a ring buffer written to
 * `<cacheDir>/status.json`, so the plugin's behavior is observable without the
 * host console.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import { Config, resolveModelSyncConfig, type MirrorSpec, type ModelSyncConfig } from './config.ts'
import { NpmRegistryClient } from './registry.ts'
import { probeLiveModels, resolveEnvKey } from './live.ts'
import { syncMirror, type SyncDeps } from './sync.ts'

// `baseDir` (the hosting app's data directory) is a host-runtime Context
// member not declared by any SDK package; this augmentation makes the host
// half self-contained. (`setInterval` is deliberately not declared or used —
// see the module doc.)
declare module '@deepseek-ai/cordis' {
  interface Context {
    baseDir: string
  }
}

/** Stable cordis plugin name. */
export const name = 'model-sync'

export { Config, resolveModelSyncConfig, type ModelSyncConfig, type MirrorSpec }

/** Early bounded retries that cover llm-pi-ai not being applied yet. */
const EARLY_RETRY_DELAYS_MS: readonly number[] = [3_000, 15_000, 60_000]

/** Ring-buffer size of the status.json log. */
const STATUS_LINES_LIMIT = 100

export function apply(ctx: Context, config?: ModelSyncConfig): void {
  const resolved = resolveModelSyncConfig(config)
  ctx.inject(['settings', 'llm'], (sctx) => {
    const settings = sctx.get('settings')
    if (settings === undefined) {
      sctx.logger.error('[model-sync] settings service is absent; mirror sync disabled')
      return
    }
    const llm = sctx.llm
    const dataRoot = sctx.baseDir ?? sctx.baseUrl ?? join(homedir(), '.dsh')
    const cacheDir = join(dataRoot, 'storages', 'dsh-model-sync')
    const statusPath = join(cacheDir, 'status.json')

    const statusLines: string[] = []
    let disposed = false
    const timerIds = new Set<ReturnType<typeof setTimeout>>()
    const statusWriteQueued = { current: Promise.resolve() as Promise<void> }

    /**
     * Append one line to the status ring buffer and persist it. Best-effort:
     * a failing status file never breaks the sync itself. Writes are queued so
     * bursts of log lines cannot interleave mid-file.
     */
    const record = (line: string): void => {
      const stamp = new Date().toISOString()
      statusLines.push(`[${stamp}] ${line}`)
      if (statusLines.length > STATUS_LINES_LIMIT) {
        statusLines.splice(0, statusLines.length - STATUS_LINES_LIMIT)
      }
      const body = `${statusLines.join('\n')}\n`
      statusWriteQueued.current = statusWriteQueued.current
        .catch(() => undefined)
        .then(async () => {
          await mkdir(cacheDir, { recursive: true })
          await writeFile(statusPath, body, 'utf8')
        })
        .catch(() => undefined)
    }

    const sctxDispose = (): void => {
      disposed = true
      for (const timerId of timerIds) clearTimeout(timerId)
    }
    // `dispose` is a host-runtime Context event the SDK event types omit;
    // the subscription keeps HMR-reload fibers from firing stale timers.
    (sctx as unknown as { on(name: string, listener: () => void): void }).on('dispose', sctxDispose)

    /** Run one bound timer; no-ops after dispose. */
    const later = (callback: () => void, delayMs: number): void => {
      if (disposed) return
      const timerId = setTimeout(() => {
        timerIds.delete(timerId)
        if (disposed) return
        callback()
      }, delayMs)
      timerIds.add(timerId)
    }

    const catalog = new NpmRegistryClient({
      cacheDir,
      timeoutMs: resolved.timeoutMs,
    })
    const deps: SyncDeps = {
      settings,
      llm,
      catalog,
      log: (message) => {
        record(message)
        sctx.logger.info(`[model-sync] ${message}`)
      },
      probe: resolved.fetchLive
        ? async (spec: MirrorSpec, apiKeyEnv?: string) => {
            if (spec.baseURL === undefined) return undefined
            return probeLiveModels({
              baseURL: spec.baseURL,
              apiKey: resolveEnvKey(apiKeyEnv),
              timeoutMs: resolved.timeoutMs,
            })
          }
        : undefined,
    }
    const run = (): void => {
      for (const spec of resolved.mirrors) {
        record(`syncing mirror "${spec.id}" from "${spec.source}"`)
        void syncMirror(deps, spec, { fetchLive: resolved.fetchLive })
      }
    }
    // The hourly loop re-arms itself after each run, so a run that outlives
    // its window is never skipped; the early retries cover late registration.
    const scheduleLoop = (): void => {
      later(() => {
        run()
        scheduleLoop()
      }, resolved.intervalMs)
    }
    record(`plugin started; mirrors: ${resolved.mirrors.map(m => `${m.id} <- ${m.source}`).join(', ')}`)
    run()
    for (const delayMs of EARLY_RETRY_DELAYS_MS) {
      later(run, delayMs)
    }
    scheduleLoop()
  })
}