import type { Context } from '@deepseek-ai/cordis';
import { type RemoteKey } from './locales.ts';
export type { RemoteEntryProps } from './RemoteEntry.tsx';
export type { PanelState, RemotePanelProps } from './RemotePanel.tsx';
export type { PairFailedNoticeProps } from './PairFailedNotice.tsx';
export type { RemoteKey } from './locales.ts';
export type { RemoteSettingsCardFace, RemoteSettingsCardState } from './RemoteSettingsCard.tsx';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Mobile remote-control surface copy. */
        remote: RemoteKey;
    }
}
/**
 * Structural client slots-service face. DSH 0.1.5's UI packages do not
 * declare `ctx.slots` on the cordis Context (better-sidebar vendors the same
 * structural mirror); the runtime service is provided by the renderer and
 * registered through the SlotMap-typed `register` overloads — here restated
 * as the narrow subset this plugin uses.
 */
interface SlotsRegisterOptions {
    /** Slot key (a declared `SlotMap` member at runtime). */
    name: string;
    /** Keyed-slot dispatch key. */
    key?: string;
    /** List-slot entry id (also the tab/action identity). */
    id?: string;
    /** List-slot ordering position. */
    order?: number;
    /** List-slot display label; a thunk re-evaluates it per read (locale-following). */
    label?: string | (() => string);
    /** Locale namespace the entry's component copy binds. */
    locale?: string;
    /** Business face the renderer injects into the component props. */
    inject?: () => object;
}
interface SlotsService {
    /** Run a callback for each declaration lifetime of a slot; no-op while undeclared. */
    inject(name: string, factory?: () => () => void): () => void;
    /** Register one entry; returns the disposer. */
    register(options: SlotsRegisterOptions, component: unknown): () => void;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        slots: SlotsService;
    }
}
/** Services required by this plugin. */
export declare const inject: string[];
/**
 * Register the remote-control surface.
 * @param ctx - client root context.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map