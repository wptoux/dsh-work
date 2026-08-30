/**
 * Translation between pi-ai's catalog metadata and llm-pi-ai model-entry
 * fields. llm-pi-ai's `PiAiModelProfile` accepts id/name/contextWindow/
 * maxTokens/input/reasoningEfforts/compat; pi-ai's data files spell reasoning
 * as `thinkingLevelMap` and compat with optional vendor fields, so both need
 * a narrowing translation. Everything here is a pure function.
 * @module dsh-model-sync/translate
 */

/**
 * Every llm-pi-ai `PiAiCompatProfile` field the config surface offers
 * (catalog.ts `COMPLETIONS_COMPAT_GATE` / `RESPONSES_COMPAT_GATE` /
 * `ANTHROPIC_COMPAT_GATE` / `BEDROCK_COMPAT_GATE` dispositions of "offer").
 * pi-ai's data compat entries that fall outside this list would be refused by
 * llm-pi-ai's `assertOfferedCompatFields`, so mirroring filters them out.
 */
export const COMPAT_OFFERED_FIELDS: readonly string[] = [
  'supportsStore',
  'supportsDeveloperRole',
  'supportsReasoningEffort',
  'supportsUsageInStreaming',
  'maxTokensField',
  'requiresToolResultName',
  'requiresAssistantAfterToolResult',
  'requiresThinkingAsText',
  'requiresReasoningContentOnAssistantMessages',
  'thinkingFormat',
  'chatTemplateKwargs',
  'supportsStrictMode',
  'cacheControlFormat',
  'supportsLongCacheRetention',
  'supportsEagerToolInputStreaming',
  'supportsCacheControlOnTools',
  'supportsTemperature',
  'forceAdaptiveThinking',
  'allowEmptySignature',
  'supportsStrictTools',
]

/**
 * Translate a pi-ai `thinkingLevelMap` into llm-pi-ai `reasoningEfforts`.
 * llm-pi-ai's map semantics: each key is a selectable level and its value the
 * wire spelling; only `off` may be empty. pi-ai pins unsupported levels to
 * `null`, so those are dropped; `off` is dropped (models with a map always
 * reason). Nothing left means the model declares no reasoning levels.
 */
export function translateThinkingLevelMap(
  map: Record<string, string | null> | null | undefined,
): Record<string, string> | undefined {
  if (map === undefined || map === null) return undefined
  const out: Record<string, string> = {}
  for (const [level, wire] of Object.entries(map)) {
    if (level === 'off') continue
    if (wire !== null && wire !== undefined) out[level] = wire
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Request modalities llm-pi-ai accepts. */
const KNOWN_MODALITIES = new Set(['text', 'image'])

/** Translate a pi-ai `input` modality list; unknown modalities are dropped. */
export function translateInput(input: readonly string[] | undefined): ('text' | 'image')[] | undefined {
  if (input === undefined || input.length === 0) return undefined
  const out = input.filter((value): value is 'text' | 'image' => KNOWN_MODALITIES.has(value))
  return out.length > 0 ? out : undefined
}

/** Narrow a pi-ai compat block to the fields llm-pi-ai's schema offers. */
export function filterCompat(compat: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (compat === undefined) return undefined
  const out: Record<string, unknown> = {}
  for (const field of COMPAT_OFFERED_FIELDS) {
    if (field in compat) out[field] = compat[field]
  }
  return Object.keys(out).length > 0 ? out : undefined
}