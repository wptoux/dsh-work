/**
 * `ui-tweaks` namespace dictionaries: the mobile drawer trigger copy.
 * Simplified Chinese is the key-set source of truth; English mirrors it.
 */

/** Simplified Chinese dictionary. */
export const zh = {
  'mobile.openSidebar': '打开侧边栏',
} as const

/** English dictionary (full mirror of the zh key set). */
export const en: Record<keyof typeof zh, string> = {
  'mobile.openSidebar': 'Open sidebar',
}

/** Dictionary key union (drives the typed `t` seat). */
export type UiTweaksKey = keyof typeof zh