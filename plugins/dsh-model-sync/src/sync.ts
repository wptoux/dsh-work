/**
 * Sync orchestration for one mirror route. Reads the current settings
 * section, fetches the latest source-route catalog, merges new models into
 * the mirror's models list and writes it back through the settings seam —
 * llm-pi-ai's reactive section then re-materializes the route and the GUI
 * refreshes on `settings/document-updated`. Never throws: every failure is
 * logged and the previous state (and every live route) stays untouched.
 * @module dsh-model-sync/sync
 */

import { SettingsConflictError, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { PiAiModelJson } from './catalog-json.ts'
import { buildMirrorModels, type ModelEntry } from './merge.ts'
import type { MirrorSpec } from './config.ts'

/** The settings namespace llm-pi-ai owns. */
export const SETTINGS_NS = settingsNamespace('llm-pi-ai')

/** Minimal settings-seam surface the sync needs. */
export interface SettingsLike {
  get(ns: unknown): unknown
  describe(): ReadonlyArray<{ ns: unknown; revision: number }>
  mutate(ns: unknown, ops: ReadonlyArray<{ op: 'set' | 'unset'; path: readonly string[]; value?: unknown }>, expectedRevision?: number): Promise<void>
}

/** Minimal llm-registry surface the sync needs. */
export interface LlmLike {
  listProviders(): ReadonlyArray<{ id: string }>
  listModels(provider: string): Promise<readonly { id: string }[]>
}

/** Minimal catalog-source surface the sync needs. */
export interface CatalogLike {
  fetchCatalog(route: string): Promise<{ version: string; models: Map<string, PiAiModelJson> } | undefined>
}

export interface SyncDeps {
  settings: SettingsLike
  llm: LlmLike
  catalog: CatalogLike
  log: (message: string) => void
  /** Optional live probe; result is logged only. */
  probe?: (spec: MirrorSpec, apiKeyEnv?: string) => Promise<unknown>
}

interface Op { op: 'set' | 'unset'; path: readonly string[]; value?: unknown }

interface MirrorProfile {
  apiKeyEnv?: string
  api?: string
  baseURL?: string
  models?: readonly ModelEntry[]
  [key: string]: unknown
}

/** Read the current revision of the llm-pi-ai section, for conflict detection. */
function currentRevision(settings: SettingsLike): number {
  for (const entry of settings.describe()) {
    if (entry.ns === SETTINGS_NS) return entry.revision
  }
  return 0
}

/**
 * Match a settings-conflict error no matter which copy of dsh-settings threw
 * it. The built artifact inlines its own copy of the library (tsdown pulls in
 * the devDependency), so at runtime the host throws ITS SettingsConflictError
 * instance and `instanceof` here is false. Both copies set the same stable
 * machine code, which is what the host class carries too.
 */
function isSettingsConflict(error: unknown): boolean {
  if (error instanceof SettingsConflictError) return true
  if (typeof error === 'object' && error !== null) {
    return (error as { code?: unknown }).code === 'SETTINGS_CONFLICT'
  }
  return false
}

/** Write ops with one conflict retry. */
async function writeOps(settings: SettingsLike, ops: Op[]): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await settings.mutate(SETTINGS_NS, ops, currentRevision(settings))
      return true
    } catch (error) {
      if (isSettingsConflict(error)) continue
      throw error
    }
  }
  return false
}

/** Sync one mirror route (see module doc). */
export async function syncMirror(deps: SyncDeps, spec: MirrorSpec, opts: { fetchLive: boolean }): Promise<void> {
  const log = deps.log
  try {
    const section = deps.settings.get(SETTINGS_NS) as { providers?: Record<string, MirrorProfile> } | undefined
    const source = section?.providers?.[spec.source]
    // A self-mirror (`source === id`) replaces the route it feeds from: there
    // is no separate source profile, and the route may not exist yet on first
    // boot — the sync bootstraps it. The source-existence and serving gates
    // only apply to the legacy dual-route mode, where the mirror feeds off a
    // distinct configured route.
    const selfMirror = spec.source === spec.id
    if (!selfMirror && source === undefined) {
      log(`source route "${spec.source}" is not configured in llm-pi-ai; skipping`)
      return
    }
    if (!selfMirror) {
      const serving = new Set(deps.llm.listProviders().map(provider => provider.id))
      if (!serving.has(spec.source)) {
        log(`source route "${spec.source}" is not serving; skipping`)
        return
      }
    }
    let served: string[] = []
    try {
      served = (await deps.llm.listModels(spec.id)).map(model => model.id)
    } catch {
      served = []
    }
    const latest = await deps.catalog.fetchCatalog(spec.source)
    if (latest === undefined) {
      log(`catalog fetch for "${spec.source}" failed; keeping last-good state`)
      return
    }
    const mirror = section?.providers?.[spec.id]
    if (mirror === undefined && spec.api === undefined && spec.baseURL === undefined && spec.apiKeyEnv === undefined) {
      log(`mirror "${spec.id}" cannot be bootstrapped: no api/baseURL/apiKeyEnv in config; skipping`)
      return
    }
    const previous: readonly ModelEntry[] = mirror?.models ?? []
    const result = buildMirrorModels({ previous, latest: latest.models, served })

    const needsBootstrap = mirror === undefined || mirror.api === undefined || mirror.baseURL === undefined
    if (!result.changed && !needsBootstrap) {
      log(`mirror "${spec.id}" is current (${served.length} models, ${latest.version})`)
      await maybeProbe(deps, spec, source, opts)
      return
    }
    // Credential for the mirror: its own stored ref first; a self-mirror falls
    // back to its config ref; a dual-route mirror copies the source's.
    const mirrorKey = mirror?.apiKeyEnv ?? (selfMirror ? spec.apiKeyEnv : source?.apiKeyEnv)
    const ops: Op[] = []
    // Set API facts only once, like apiKeyEnv: an endpoint override the user
    // edits on the live mirror must not be reverted on the next sync. Both
    // are still pushed on bootstrap because the mirror profile is missing.
    if (mirror?.api === undefined && spec.api !== undefined) ops.push({ op: 'set', path: ['providers', spec.id, 'api'], value: spec.api })
    if (mirror?.baseURL === undefined && spec.baseURL !== undefined) ops.push({ op: 'set', path: ['providers', spec.id, 'baseURL'], value: spec.baseURL })
    if (mirror?.apiKeyEnv === undefined && mirrorKey !== undefined) {
      ops.push({ op: 'set', path: ['providers', spec.id, 'apiKeyEnv'], value: mirrorKey })
    }
    ops.push({ op: 'set', path: ['providers', spec.id, 'models'], value: result.models })
    const written = await writeOps(deps.settings, ops)
    if (!written) {
      log(`settings write for "${spec.id}" conflicted twice; keeping last-good state`)
      return
    }
    log(`mirror "${spec.id}" updated: ${result.added.length > 0 ? `+${result.added.join(', ')}` : 'no new models'} (catalog ${latest.version})`)
    await maybeProbe(deps, spec, source, opts)
  } catch (error) {
    log(`sync failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function maybeProbe(
  deps: SyncDeps,
  spec: MirrorSpec,
  source: MirrorProfile | undefined,
  opts: { fetchLive: boolean },
): Promise<void> {
  if (!opts.fetchLive || deps.probe === undefined) return
  if (spec.baseURL === undefined) return
  // Credential for the probe mirrors the write path: a self-mirror falls back
  // to its config ref, a dual-route mirror to the source's.
  const probeKey = spec.source === spec.id ? spec.apiKeyEnv : source?.apiKeyEnv
  const result = await deps.probe(spec, probeKey)
  if (result !== undefined && result !== null && typeof result === 'object' && 'ok' in result) {
    const probe = result as { ok: boolean; ids?: string[]; reason?: string }
    deps.log(probe.ok
      ? `live /models probe: ${probe.ids?.length ?? 0} models advertised`
      : `live /models probe failed: ${probe.reason ?? 'unknown'}`)
  }
}

// Re-export the conflict type so callers and tests share the same class.
export { SettingsConflictError }