/**
 * `ui-tweaks` namespace dictionaries: the fold header copy.
 * Simplified Chinese is the key-set source of truth; English mirrors it.
 */
/** Simplified Chinese dictionary. */
export declare const zh: {
    readonly 'fold.header': "已处理";
    readonly 'fold.count': "{n} 条";
    readonly 'mobile.openSidebar': "打开侧边栏";
};
/** English dictionary (full mirror of the zh key set). */
export declare const en: Record<keyof typeof zh, string>;
/** Dictionary key union (drives the typed `t` seat). */
export type UiTweaksKey = keyof typeof zh;
//# sourceMappingURL=locales.d.ts.map