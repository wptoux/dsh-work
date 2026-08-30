/**
 * Plugin configuration and defaults. The loader validates the schemastery
 * `Config` schema from cordis.patch.yml; {@link resolveModelSyncConfig}
 * applies the same defaults for direct callers.
 * @module dsh-model-sync/config
 */

import z from 'schemastery'

/** One mirror: a hand-declared route whose models list stays synced to a source catalog route. */
export interface MirrorSpec {
  /** Source route id known to llm-pi-ai (its pi-ai data file is the model source). */
  source: string
  /** The mirror route id written into the llm-pi-ai settings section. */
  id: string
  /** Wire protocol for the mirror route, required when the source route is mixed-protocol. */
  api?: string
  /** Endpoint for the mirror route; falls back to the source route's baseURL. */
  baseURL?: string
}

/** Plugin configuration. */
export interface ModelSyncConfig {
  /** Mirrors to maintain, in order. */
  mirrors: MirrorSpec[]
  /** Interval between background syncs. */
  intervalMs: number
  /** Probe the provider's live /models endpoint for signal logging. */
  fetchLive: boolean
  /** Per-network-operation timeout. */
  timeoutMs: number
}

const DEFAULT_MIRROR = {
  source: 'opencode-go',
  id: 'opencode-go-live',
  api: 'openai-completions',
  baseURL: 'https://opencode.ai/zen/go/v1',
} satisfies MirrorSpec

/** Loader-validated configuration schema (defaults filled by the loader). */
export const Config: z<ModelSyncConfig> = z.object({
  mirrors: z.array(z.object({
    source: z.string(),
    id: z.string(),
    api: z.string(),
    baseURL: z.string(),
  })).default([DEFAULT_MIRROR]),
  intervalMs: z.number().min(60_000).default(3_600_000),
  fetchLive: z.boolean().default(true),
  timeoutMs: z.number().min(1_000).default(15_000),
})

/** Configuration defaults, applied per-field when the caller omitted a value. */
export const DEFAULT_CONFIG: ModelSyncConfig = {
  mirrors: [DEFAULT_MIRROR],
  intervalMs: 3_600_000,
  fetchLive: true,
  timeoutMs: 15_000,
}

/** Fill defaults for a possibly-partial configuration object. */
export function resolveModelSyncConfig(config?: Partial<ModelSyncConfig>): ModelSyncConfig {
  return {
    mirrors: config?.mirrors ?? [...DEFAULT_CONFIG.mirrors],
    intervalMs: config?.intervalMs ?? DEFAULT_CONFIG.intervalMs,
    fetchLive: config?.fetchLive ?? DEFAULT_CONFIG.fetchLive,
    timeoutMs: config?.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
  }
}