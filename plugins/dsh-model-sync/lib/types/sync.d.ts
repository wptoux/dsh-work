/**
 * Sync orchestration for one mirror route. Reads the current settings
 * section, fetches the latest source-route catalog, merges new models into
 * the mirror's models list and writes it back through the settings seam —
 * llm-pi-ai's reactive section then re-materializes the route and the GUI
 * refreshes on `settings/document-updated`. Never throws: every failure is
 * logged and the previous state (and every live route) stays untouched.
 * @module dsh-model-sync/sync
 */
import { SettingsConflictError } from '@deepseek-ai/dsh-settings';
import type { PiAiModelJson } from './catalog-json.ts';
import type { MirrorSpec } from './config.ts';
/** The settings namespace llm-pi-ai owns. */
export declare const SETTINGS_NS: import("@deepseek-ai/dsh-settings").SettingsNamespace;
/** Minimal settings-seam surface the sync needs. */
export interface SettingsLike {
    get(ns: unknown): unknown;
    describe(): ReadonlyArray<{
        ns: unknown;
        revision: number;
    }>;
    mutate(ns: unknown, ops: ReadonlyArray<{
        op: 'set' | 'unset';
        path: readonly string[];
        value?: unknown;
    }>, expectedRevision?: number): Promise<void>;
}
/** Minimal llm-registry surface the sync needs. */
export interface LlmLike {
    listProviders(): ReadonlyArray<{
        id: string;
    }>;
    listModels(provider: string): Promise<readonly {
        id: string;
    }[]>;
}
/** Minimal catalog-source surface the sync needs. */
export interface CatalogLike {
    fetchCatalog(route: string): Promise<{
        version: string;
        models: Map<string, PiAiModelJson>;
    } | undefined>;
}
export interface SyncDeps {
    settings: SettingsLike;
    llm: LlmLike;
    catalog: CatalogLike;
    log: (message: string) => void;
    /** Optional live probe; result is logged only. */
    probe?: (spec: MirrorSpec, apiKeyEnv?: string) => Promise<unknown>;
}
/** Sync one mirror route (see module doc). */
export declare function syncMirror(deps: SyncDeps, spec: MirrorSpec, opts: {
    fetchLive: boolean;
}): Promise<void>;
export { SettingsConflictError };
