/**
 * Fetch the latest pi-ai catalog for one route from the npm registry, with a
 * disk cache keyed by version. A fresh cache (< maxAgeMs) skips the network
 * entirely; a still-current version skips the tarball download; otherwise the
 * tarball is fetched and the one `<route>.json` data file extracted.
 * @module dsh-model-sync/registry
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tar from 'tar'
import { parsePiAiCatalog, type PiAiModelJson } from './catalog-json.ts'

export interface LatestCatalog {
  version: string
  route: string
  models: Map<string, PiAiModelJson>
}

const DEFAULT_PKG = '@earendil-works/pi-ai'
const TARBALL_ENTRY_PREFIX = 'package/dist/providers/data/'

/**
 * Extract exactly one entry from a gzipped tarball into a string, without
 * touching anything else. Returns undefined when the entry is absent or the
 * archive is unreadable.
 */
export async function extractTarballEntry(bytes: Uint8Array, entryPath: string): Promise<string | undefined> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-model-sync-'))
  try {
    await writeFile(join(dir, 'pkg.tgz'), bytes)
    await tar.x({ file: join(dir, 'pkg.tgz'), cwd: dir, filter: (path) => path === entryPath, strict: false })
    return await readFile(join(dir, entryPath), 'utf8')
  } catch {
    return undefined
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export interface NpmRegistryClientOptions {
  /** Directory holding the per-route cache files (created on demand). */
  cacheDir: string
  /** npm package whose catalog is fetched. */
  pkg?: string
  /** Registry base URL. */
  registry?: string
  /** Timeout applied to every fetch. */
  timeoutMs?: number
  /** Cache freshness window; a fresh cache skips the network entirely. */
  maxAgeMs?: number
  /** Clock injection for tests. */
  now?: () => number
  /** Fetch injection for tests. */
  fetchImpl?: typeof fetch
}

/** Catalog source backed by the npm registry. */
export class NpmRegistryClient {
  private readonly cacheDirRoot: string
  private readonly pkg: string
  private readonly registry: string
  private readonly timeoutMs: number
  private readonly maxAgeMs: number
  private readonly now: () => number
  private readonly fetchImpl: typeof fetch

  constructor(opts: NpmRegistryClientOptions) {
    this.pkg = opts.pkg ?? DEFAULT_PKG
    this.cacheDirRoot = opts.cacheDir
    this.registry = (opts.registry ?? 'https://registry.npmjs.org').replace(/\/+$/, '')
    this.timeoutMs = opts.timeoutMs ?? 15_000
    this.maxAgeMs = opts.maxAgeMs ?? 6 * 3_600_000
    this.now = opts.now ?? Date.now
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  /**
   * Latest catalog for one route, or undefined when the network fetch or the
   * extraction failed (the caller keeps its last-good state).
   */
  async fetchCatalog(route: string): Promise<LatestCatalog | undefined> {
    const metaPath = join(this.cacheDirRoot, `${route}.meta.json`)
    const dataPath = join(this.cacheDirRoot, `${route}.json`)
    const cache = await this.readMeta(metaPath)
    const now = this.now()
    if (cache !== undefined && now - cache.cachedAt < this.maxAgeMs) {
      return this.readCached(route, dataPath, cache.version)
    }
    const latest = await this.fetchLatestMetadata()
    if (latest === undefined) {
      if (cache !== undefined) return this.readCached(route, dataPath, cache.version)
      return undefined
    }
    if (cache !== undefined && cache.version === latest.version) {
      return this.readCached(route, dataPath, latest.version)
    }
    const tarball = await this.fetchBytes(latest.tarball)
    if (tarball === undefined) {
      if (cache !== undefined) return this.readCached(route, dataPath, cache.version)
      return undefined
    }
    const raw = await extractTarballEntry(tarball, `${TARBALL_ENTRY_PREFIX}${route}.json`)
    if (raw === undefined) return undefined
    // Parse BEFORE caching: a bundle that fails to parse must never land in
    // the cache (it would shadow a good cached version until maxAge).
    let models: Map<string, PiAiModelJson>
    try {
      models = parsePiAiCatalog(JSON.parse(raw) as unknown)
    } catch {
      return undefined
    }
    await this.writeCache(route, latest.version, raw)
    return { version: latest.version, route, models }
  }

  private async readMeta(path: string): Promise<{ version: string; cachedAt: number } | undefined> {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as { version?: unknown; cachedAt?: unknown }
      if (typeof parsed.version === 'string' && typeof parsed.cachedAt === 'number') {
        return { version: parsed.version, cachedAt: parsed.cachedAt }
      }
      return undefined
    } catch {
      return undefined
    }
  }

  private async readCached(route: string, dataPath: string, version: string): Promise<LatestCatalog | undefined> {
    try {
      const raw = await readFile(dataPath, 'utf8')
      return { version, route, models: parsePiAiCatalog(JSON.parse(raw) as unknown) }
    } catch {
      return undefined
    }
  }

  private async writeCache(route: string, version: string, raw: string): Promise<void> {
    const dir = this.cacheDirRoot
    await mkdir(dir, { recursive: true })
    const dataPath = join(dir, `${route}.json`)
    const metaPath = join(dir, `${route}.meta.json`)
    await writeFile(dataPath, raw)
    await writeFile(metaPath, JSON.stringify({ version, cachedAt: this.now() }))
  }

  private async fetchLatestMetadata(): Promise<{ version: string; tarball: string } | undefined> {
    try {
      const url = `${this.registry}/${encodeURIComponent(this.pkg)}/latest`
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) })
      if (!response.ok) return undefined
      const json = (await response.json()) as { version?: unknown; dist?: { tarball?: unknown } }
      if (typeof json.version !== 'string' || typeof json.dist?.tarball !== 'string') return undefined
      return { version: json.version, tarball: json.dist.tarball }
    } catch {
      return undefined
    }
  }

  private async fetchBytes(url: string): Promise<Uint8Array | undefined> {
    try {
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) })
      if (!response.ok) return undefined
      return new Uint8Array(await response.arrayBuffer())
    } catch {
      return undefined
    }
  }
}