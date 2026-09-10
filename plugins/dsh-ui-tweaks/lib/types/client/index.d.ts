import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type UiTweaksKey } from './locales';
import './fold.css';
import './composer-toolbar.css';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** dsh-ui-tweaks fold copy. */
        'ui-tweaks': UiTweaksKey;
    }
}
/** Services required by this plugin. */
export declare const inject: string[];
/**
 * Mount the folding. The effect owns the whole lifecycle: creating the
 * chrome (DOM observation + click delegation) and the driver (session
 * snapshot → plan → DOM), wired together through a rAF-coalesced re-run, and
 * torn down on fiber disposal (HMR-safe).
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map