/**
 * Fetch the latest pi-ai catalog for one route from the npm registry, with a
 * disk cache keyed by version. A fresh cache (< maxAgeMs) skips the network
 * entirely; a still-current version skips the tarball download; otherwise the
 * tarball is fetched and the one `<route>.json` data file extracted.
 * @module dsh-model-sync/registry
 */
import { type PiAiModelJson } from './catalog-json.ts';
export interface LatestCatalog {
    version: string;
    route: string;
    models: Map<string, PiAiModelJson>;
}
/**
 * Extract exactly one entry from a gzipped tarball into a string, without
 * touching anything else. Returns undefined when the entry is absent or the
 * archive is unreadable.
 */
export declare function extractTarballEntry(bytes: Uint8Array, entryPath: string): Promise<string | undefined>;
export interface NpmRegistryClientOptions {
    /** Directory holding the per-route cache files (created on demand). */
    cacheDir: string;
    /** npm package whose catalog is fetched. */
    pkg?: string;
    /** Registry base URL. */
    registry?: string;
    /** Timeout applied to every fetch. */
    timeoutMs?: number;
    /** Cache freshness window; a fresh cache skips the network entirely. */
    maxAgeMs?: number;
    /** Clock injection for tests. */
    now?: () => number;
    /** Fetch injection for tests. */
    fetchImpl?: typeof fetch;
}
/** Catalog source backed by the npm registry. */
export declare class NpmRegistryClient {
    private readonly cacheDirRoot;
    private readonly pkg;
    private readonly registry;
    private readonly timeoutMs;
    private readonly maxAgeMs;
    private readonly now;
    private readonly fetchImpl;
    constructor(opts: NpmRegistryClientOptions);
    /**
     * Latest catalog for one route, or undefined when the network fetch or the
     * extraction failed (the caller keeps its last-good state).
     */
    fetchCatalog(route: string): Promise<LatestCatalog | undefined>;
    private readMeta;
    private readCached;
    private writeCache;
    private fetchLatestMetadata;
    private fetchBytes;
}
