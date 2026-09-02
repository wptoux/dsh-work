/**
 * dsh-model-sync host half. On startup — and again at short bounded retries,
 * then every `intervalMs` — each configured mirror is synced: the latest pi-ai
 * catalog for the source route is fetched (disk-cached by version), new models
 * are appended to the mirror route's `models:` list in the `llm-pi-ai:`
 * settings section, and llm-pi-ai's reactive section re-materializes the route
 * so the GUI model picker updates without a restart. Failures are logged and
 * never touch live routes.
 *
 * Dependency declaration uses the loader-level `inject` list (the same
 * mechanism `dsh-better-sidebar` and `dsh-llm-pi-ai` use), so the loader
 * delays `apply` until the `settings` and `llm` services are resolvable, and
 * `apply` receives a context where both are guaranteed present.
 *
 * The scheduler deliberately does NOT rely on the host's `ctx.setInterval`:
 * that member is a mixin of the `timer` service and is only present on
 * contexts that resolved it, which is not guaranteed for profile plugins at
 * apply time. A plain `setTimeout` chain with a dispose guard is robust
 * everywhere. Early bounded retries cover boot-order races: the `settings`
 * and `llm` services can be resolvable before the `llm-pi-ai` plugin's own
 * apply registers its settings section and routes, so a first sync may skip
 * "source route not configured" — the retries run again moments later.
 *
 * Every log line the sync emits is also appended to a ring buffer written to
 * `<root>/storages/dsh-model-sync/status.json` (`<root>` follows the
 * `dsh-usage-stats` convention: `DSH_HOME ?? ~/.dsh`), so the plugin's
 * behavior is observable without the host console.
 *
 * Diagnostics: a `boot-probe.log` next to `status.json` records module
 * import / apply / inject-satisfied entry points (synchronous file writes),
 * so a silent failure is attributable to the exact stage.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import { Config, resolveModelSyncConfig, type MirrorSpec, type ModelSyncConfig } from './config.ts'
import { NpmRegistryClient } from './registry.ts'
import { probeLiveModels, resolveEnvKey } from './live.ts'
import { syncMirror, type SyncDeps } from './sync.ts'

/** Stable cordis plugin name. */
export const name = 'model-sync'

/** Loader-level service dependencies (see module doc). */
export const inject = ['settings', 'llm']

export { Config, resolveModelSyncConfig, type ModelSyncConfig, type MirrorSpec }

/** Cache/status root, following the dsh-usage-stats convention. */
function dataRoot(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

const PROBE_PATH = join(dataRoot(), 'storages', 'dsh-model-sync', 'boot-probe.log')

/** Append one line to the boot probe; best-effort, synchronous. */
function bootProbe(stage: string): void {
  try {
    mkdirSync(join(dataRoot(), 'storages', 'dsh-model-sync'), { recursive: true })
    appendFileSync(PROBE_PATH, `[${new Date().toISOString()}] ${stage}\n`, 'utf8')
  } catch {
    // best-effort diagnostics
  }
}

bootProbe('module-import')

/** Early bounded retries that cover llm-pi-ai not being applied yet. */
const EARLY_RETRY_DELAYS_MS: readonly number[] = [3_000, 15_000, 60_000]

/** Ring-buffer size of the status.json log. */
const STATUS_LINES_LIMIT = 100

export function apply(ctx: Context, config?: ModelSyncConfig): void {
  bootProbe('apply-called')
  const resolved = resolveModelSyncConfig(config)
  const settings = ctx.get('settings')
  if (settings === undefined) {
    ctx.logger.error('[model-sync] settings service is absent; mirror sync disabled')
    return
  }
  bootProbe('inject-satisfied')
  const llm = ctx.llm
  const cacheDir = join(dataRoot(), 'storages', 'dsh-model-sync')
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
        mkdirSync(cacheDir, { recursive: true })
        const { writeFile } = await import('node:fs/promises')
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
  (ctx as unknown as { on(name: string, listener: () => void): void }).on('dispose', sctxDispose)

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
      ctx.logger.info(`[model-sync] ${message}`)
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
}