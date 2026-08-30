/**
 * Plugin configuration and defaults. The loader validates the schemastery
 * `Config` schema from cordis.patch.yml; {@link resolveModelSyncConfig}
 * applies the same defaults for direct callers.
 * @module dsh-model-sync/config
 */
import z from 'schemastery';
/** One mirror: a hand-declared route whose models list stays synced to a source catalog route. */
export interface MirrorSpec {
    /** Source route id known to llm-pi-ai (its pi-ai data file is the model source). */
    source: string;
    /** The mirror route id written into the llm-pi-ai settings section. */
    id: string;
    /** Wire protocol for the mirror route, required when the source route is mixed-protocol. */
    api?: string;
    /** Endpoint for the mirror route; falls back to the source route's baseURL. */
    baseURL?: string;
}
/** Plugin configuration. */
export interface ModelSyncConfig {
    /** Mirrors to maintain, in order. */
    mirrors: MirrorSpec[];
    /** Interval between background syncs. */
    intervalMs: number;
    /** Probe the provider's live /models endpoint for signal logging. */
    fetchLive: boolean;
    /** Per-network-operation timeout. */
    timeoutMs: number;
}
/** Loader-validated configuration schema (defaults filled by the loader). */
export declare const Config: z<ModelSyncConfig>;
/** Configuration defaults, applied per-field when the caller omitted a value. */
export declare const DEFAULT_CONFIG: ModelSyncConfig;
/** Fill defaults for a possibly-partial configuration object. */
export declare function resolveModelSyncConfig(config?: Partial<ModelSyncConfig>): ModelSyncConfig;
