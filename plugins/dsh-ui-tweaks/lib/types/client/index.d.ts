import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type UiTweaksKey } from './locales';
import './composer-toolbar.css';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** dsh-ui-tweaks mobile drawer copy. */
        'ui-tweaks': UiTweaksKey;
    }
}
/** Services required by this plugin. */
export declare const inject: string[];
/**
 * Mount the mobile tweaks. Each effect owns its whole lifecycle and is torn
 * down on fiber disposal (HMR-safe).
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map