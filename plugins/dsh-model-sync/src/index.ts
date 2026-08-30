/**
 * dsh-model-sync host half. On startup and then every `intervalMs`, each
 * configured mirror is synced: the latest pi-ai catalog for the source route
 * is fetched (disk-cached by version), new models are appended to the mirror
 * route's `models:` list in the `llm-pi-ai:` settings section, and llm-pi-ai's
 * reactive section re-materializes the route so the GUI model picker updates
 * without a restart. Failures are logged and never touch live routes.
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import { Config, resolveModelSyncConfig, type MirrorSpec, type ModelSyncConfig } from './config.ts'
import { NpmRegistryClient } from './registry.ts'
import { probeLiveModels, resolveEnvKey } from './live.ts'
import { syncMirror, type SyncDeps } from './sync.ts'

// `baseDir` (the hosting app's data directory) and `setInterval` (the
// fiber-disposed timer) are host-runtime Context members not declared by any
// SDK package; this augmentation makes the host half self-contained.
declare module '@deepseek-ai/cordis' {
  interface Context {
    baseDir: string
    setInterval(callback: () => void, delay: number): () => void
  }
}

/** Stable cordis plugin name. */
export const name = 'model-sync'

export { Config, resolveModelSyncConfig, type ModelSyncConfig, type MirrorSpec }

export function apply(ctx: Context, config?: ModelSyncConfig): void {
  const resolved = resolveModelSyncConfig(config)
  ctx.inject(['settings', 'llm'], (sctx) => {
    const settings = sctx.get('settings')
    if (settings === undefined) {
      sctx.logger.error('[model-sync] settings service is absent; mirror sync disabled')
      return
    }
    const llm = sctx.llm
    const catalog = new NpmRegistryClient({
      cacheDir: join(sctx.baseDir, 'storages', 'dsh-model-sync'),
      timeoutMs: resolved.timeoutMs,
    })
    const deps: SyncDeps = {
      settings,
      llm,
      catalog,
      log: (message) => sctx.logger.info(`[model-sync] ${message}`),
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
        sctx.logger.info(`[model-sync] syncing mirror "${spec.id}" from "${spec.source}"`)
        void syncMirror(deps, spec, { fetchLive: resolved.fetchLive })
      }
    }
    void run()
    sctx.setInterval(run, resolved.intervalMs)
  })
}