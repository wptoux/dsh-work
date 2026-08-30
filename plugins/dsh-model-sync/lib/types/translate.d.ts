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
export declare const COMPAT_OFFERED_FIELDS: readonly string[];
/**
 * Translate a pi-ai `thinkingLevelMap` into llm-pi-ai `reasoningEfforts`.
 * llm-pi-ai's map semantics: each key is a selectable level and its value the
 * wire spelling; only `off` may be empty. pi-ai pins unsupported levels to
 * `null`, so those are dropped; `off` is dropped (models with a map always
 * reason). Nothing left means the model declares no reasoning levels.
 */
export declare function translateThinkingLevelMap(map: Record<string, string | null> | null | undefined): Record<string, string> | undefined;
/** Translate a pi-ai `input` modality list; unknown modalities are dropped. */
export declare function translateInput(input: readonly string[] | undefined): ('text' | 'image')[] | undefined;
/** Narrow a pi-ai compat block to the fields llm-pi-ai's schema offers. */
export declare function filterCompat(compat: Record<string, unknown> | undefined): Record<string, unknown> | undefined;
