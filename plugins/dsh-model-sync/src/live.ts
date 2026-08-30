/**
 * Optional live `/models` probe. Deliberately signal-only: the reply is
 * logged, never fed into the mirror list (the npm catalog carries capacities
 * and reasoning metadata the listing endpoint does not disclose). Never
 * throws — failures are reported to the caller for logging.
 * @module dsh-model-sync/live
 */

/** Resolve a llm-pi-ai `apiKeyEnv` credential reference in the environment. */
export function resolveEnvKey(apiKeyEnv: string | undefined): string | undefined {
  if (apiKeyEnv === undefined || apiKeyEnv.length === 0) return undefined
  return process.env[apiKeyEnv]
}

/** Join an endpoint base with the OpenAI-compatible listing path. */
export function buildLiveUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/models`
}

/** Parse an OpenAI-compatible `/models` listing body into model ids. */
export function parseLiveListing(raw: unknown): string[] | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const data = (raw as { data?: unknown }).data
  if (!Array.isArray(data)) return undefined
  const ids: string[] = []
  for (const entry of data) {
    if (typeof entry === 'object' && entry !== null && typeof (entry as { id?: unknown }).id === 'string') {
      ids.push((entry as { id: string }).id)
    }
  }
  return ids
}

export type LiveProbeResult = { ok: true; ids: string[] } | { ok: false; reason: string }

export interface LiveProbeOptions {
  baseURL: string
  apiKey?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

/** Probe one provider's live listing; never throws. */
export async function probeLiveModels(opts: LiveProbeOptions): Promise<LiveProbeResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000
  const fetchImpl = opts.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(buildLiveUrl(opts.baseURL), {
      headers: opts.apiKey === undefined ? {} : { Authorization: `Bearer ${opts.apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` }
    const ids = parseLiveListing(await response.json())
    if (ids === undefined) return { ok: false, reason: 'unparseable listing' }
    return { ok: true, ids }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}