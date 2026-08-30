/**
 * One model entry as pi-ai's generated data files describe it (per-api group,
 * keyed by model id). Field names match the pi-ai JSON; the plugin reads only
 * the fields it mirrors into llm-pi-ai model entries.
 * @module dsh-model-sync/catalog-json
 */

export interface PiAiModelJson {
  id: string
  name?: string
  api?: string
  baseUrl?: string
  reasoning?: boolean
  input?: readonly string[]
  contextWindow?: number
  maxTokens?: number
  thinkingLevelMap?: Record<string, string | null> | null
  compat?: Record<string, unknown>
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Flatten a pi-ai data file (`{ [api: string]: { [id: string]: entry } }`)
 * into an id-keyed map. The model id is taken from the group key; a
 * conflicting `entry.id` is normalized to the key. Non-object entries are
 * skipped (the upstream files occasionally carry stray values); a non-object
 * root or group is refused because it means the data file changed shape.
 * @param raw - parsed JSON of `<provider>.json`.
 * @returns catalog models by id.
 * @throws TypeError when the root or a group is not a plain object.
 */
export function parsePiAiCatalog(raw: unknown): Map<string, PiAiModelJson> {
  if (!isRecord(raw)) throw new TypeError('pi-ai catalog root must be an object')
  const models = new Map<string, PiAiModelJson>()
  for (const [api, group] of Object.entries(raw)) {
    if (!isRecord(group)) throw new TypeError(`pi-ai catalog group "${api}" must be an object`)
    for (const [id, entry] of Object.entries(group)) {
      if (!isRecord(entry)) continue
      models.set(id, { ...entry, id } as unknown as PiAiModelJson)
    }
  }
  return models
}