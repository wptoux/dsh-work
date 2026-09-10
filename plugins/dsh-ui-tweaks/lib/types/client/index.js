import { createFoldChrome } from './fold-chrome';
import { createFoldDriver } from './fold-driver';
import { formatDuration } from './fold-dom';
import { createSessionSource } from './session-source';
import { mountMobileSidebar } from "./mobile-sidebar.js";
import { en, zh } from './locales';
import './fold.css';
import './composer-toolbar.css';
/** Dictionary namespace owned by this plugin. */
const NS = 'ui-tweaks';
/** Services required by this plugin. */
export const inject = ['sessions', 'locale'];
/**
 * Mount the folding. The effect owns the whole lifecycle: creating the
 * chrome (DOM observation + click delegation) and the driver (session
 * snapshot → plan → DOM), wired together through a rAF-coalesced re-run, and
 * torn down on fiber disposal (HMR-safe).
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
    ctx.effect(() => {
        const t = ctx.locale.bind(NS);
        const copy = {
            header: () => t('fold.header'),
            count: (n) => t('fold.count', { n }),
            duration: formatDuration,
        };
        const raf = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : ((fn) => setTimeout(() => fn(performance.now()), 16));
        let scheduled = false;
        let driver;
        const schedule = () => {
            if (scheduled)
                return;
            scheduled = true;
            raf(() => {
                scheduled = false;
                driver.run();
            });
        };
        const chrome = createFoldChrome(schedule, turn => driver.toggle(turn));
        driver = createFoldDriver(createSessionSource(ctx), {
            containers: () => chrome.containers(),
            copy,
        });
        const offChrome = chrome.start();
        const offDriver = driver.start();
        return () => {
            offDriver();
            offChrome();
        };
    }, 'dsh-ui-tweaks: fold driver');
}
