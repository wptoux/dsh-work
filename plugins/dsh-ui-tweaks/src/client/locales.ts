/**
 * `ui-tweaks` namespace dictionaries: the fold header copy.
 * Simplified Chinese is the key-set source of truth; English mirrors it.
 */

/** Simplified Chinese dictionary. */
export const zh = {
  'fold.header': '已处理',
  'fold.count': '{n} 条',
} as const

/** English dictionary (full mirror of the zh key set). */
export const en: Record<keyof typeof zh, string> = {
  'fold.header': 'Processed',
  'fold.count': '{n} items',
}

/** Dictionary key union (drives the typed `t` seat). */
export type UiTweaksKey = keyof typeof zh