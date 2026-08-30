/**
 * Build the mirror route's `models:` list. Add-only semantics: every existing
 * entry is kept verbatim (it may carry a user's manual correction or a prior
 * sync's fields — rewriting it would lose that intent), and only ids present
 * in the latest catalog but absent from both the previous list and the
 * currently served set are appended as generated full-field entries.
 * @module dsh-model-sync/merge
 */

import type { PiAiModelJson } from './catalog-json.ts'
import { filterCompat, translateInput, translateThinkingLevelMap } from './translate.ts'

/** One entry of a llm-pi-ai `models:` list (PiAiModelProfile-compatible). */
export interface ModelEntry {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: readonly string[]
  reasoningEfforts?: false | Record<string, string>
  compat?: Record<string, unknown>
  [key: string]: unknown
}

/** Spell out a full llm-pi-ai entry for one pi-ai catalog model. */
export function generateEntry(model: PiAiModelJson): ModelEntry {
  const entry: ModelEntry = { id: model.id }
  if (model.name !== undefined) entry.name = model.name
  if (model.contextWindow !== undefined) entry.contextWindow = model.contextWindow
  if (model.maxTokens !== undefined) entry.maxTokens = model.maxTokens
  const input = translateInput(model.input)
  if (input !== undefined) entry.input = input
  const efforts = translateThinkingLevelMap(model.thinkingLevelMap)
  entry.reasoningEfforts = efforts ?? (model.reasoning === true ? undefined : false)
  const compat = filterCompat(model.compat)
  if (compat !== undefined) entry.compat = compat
  return entry
}

export interface BuildMirrorModelsArgs {
  /** Current mirror models list from the settings document. */
  previous: readonly ModelEntry[]
  /** Latest catalog for the source route, by model id. */
  latest: Map<string, PiAiModelJson>
  /** Model ids the mirror route currently serves (ctx.llm.listModels). */
  served: readonly string[]
}

export interface BuildMirrorModelsResult {
  /** The next models list (previous order, then new ids in catalog order). */
  models: ModelEntry[]
  /** New model ids appended by this build. */
  added: string[]
  /** Whether the list differs from `previous`. */
  changed: boolean
}

/** Build the next mirror models list (see module doc for semantics). */
export function buildMirrorModels(args: BuildMirrorModelsArgs): BuildMirrorModelsResult {
  const { previous, latest, served } = args
  const previousIds = new Set(previous.map(entry => entry.id))
  const servedIds = new Set(served)
  const models: ModelEntry[] = [...previous]
  const added: string[] = []
  for (const [id, model] of latest) {
    if (previousIds.has(id) || servedIds.has(id)) continue
    models.push(generateEntry(model))
    added.push(id)
  }
  const changed = JSON.stringify(models) !== JSON.stringify(previous)
  return { models, added, changed }
}