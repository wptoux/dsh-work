import type { Context } from '../context-types.ts';
import { type SessionScope } from './api.ts';
import { type SidebarStore, type SidebarTab } from './state.ts';
export declare function EditorHost(props: {
    ctx: Context;
    store: SidebarStore;
    scope: SessionScope;
    tab: SidebarTab;
    expanded: string[];
    onToggleDir: (path: string) => void;
    onReferenceFile: (path: string) => void;
    /** Whether the tab is actually visible (panel open + active): the
     *  staleness poll pauses on hidden tabs. Absent (older host renders)
     *  counts as visible. */
    visible?: boolean;
}): import("react").JSX.Element;
