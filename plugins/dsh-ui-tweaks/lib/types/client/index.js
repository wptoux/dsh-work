import { mountMobileSidebar } from "./mobile-sidebar.js";
import { en, zh } from './locales';
import './composer-toolbar.css';
/** Dictionary namespace owned by this plugin. */
const NS = 'ui-tweaks';
/** Services required by this plugin. */
export const inject = ['locale'];
/**
 * Mount the mobile tweaks. Each effect owns its whole lifecycle and is torn
 * down on fiber disposal (HMR-safe).
 */
export function apply(ctx) {
    ctx.effect(() => {
        try {
            return ctx.locale.register(NS, { zh, en });
        }
        catch {
            return () => { };
        }
    }, 'dsh-ui-tweaks: dictionaries');
    ctx.effect(() => {
        const t = ctx.locale.bind(NS);
        // Narrow-screen drawer: phones run the full desktop GUI, so the sidebar
        // is hidden behind a top-left whale-logo trigger that expands it as an
        // overlay drawer. The toggle goes through the layout service's official
        // action; the drawer's visual state mirrors the host frame (see the
        // module doc) and the trigger/scrim stay hidden at ≥768px via CSS.
        const disposeMobile = mountMobileSidebar({
            label: t('mobile.openSidebar'),
            toggleSidebar: () => {
                const layout = ctx.get('layout');
                layout?.toggleSidebar();
            },
        });
        return () => { disposeMobile.dispose(); };
    }, 'dsh-ui-tweaks: mobile sidebar drawer');
}
