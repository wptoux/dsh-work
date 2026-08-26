import { createFoldChrome } from './fold-chrome';
import { createFoldDriver } from './fold-driver';
import { formatDuration } from './fold-dom';
import { mountMobileSidebar } from "./mobile-sidebar.js";
import { en, zh } from './locales';
import './fold.css';
import './composer-toolbar.css';
/** Dictionary namespace owned by this plugin. */
const NS = 'ui-tweaks';
/** Services required by this plugin. */
export const inject = ['sessions', 'locale'];
/** Project the runtime snapshot onto the planner's minimal window shape. */
function projectSnapshot(snapshot) {
    const turns = new Map();
    for (const [number, location] of snapshot.chat.timeline.turns) {
        turns.set(number, { startTime: location.start?.time, endTime: location.end?.time });
    }
    return {
        openState: snapshot.openState,
        hasMore: snapshot.hasMore,
        loadingOlder: snapshot.loadingOlder,
        turns,
        order: snapshot.chat.order,
        nodes: {
            get(key) {
                const node = snapshot.chat.nodes.get(key);
                if (node === undefined)
                    return undefined;
                const location = node.location;
                const turn = location.kind === 'turn' || location.kind === 'step' ? location.turn.turn : undefined;
                return { kind: node.kind, anchorSeq: node.anchorSeq, location: { kind: location.kind, turn } };
            },
        },
    };
}
/**
 * The fold driver's session source over the client runtime: the current
 * selection's SessionFace (read + subscribe + loadOlder), re-subscribed when
 * the selection changes.
 */
function sessionSource(ctx) {
    const currentHandle = () => {
        const id = ctx.sessions.list.getSnapshot().current;
        if (id === undefined)
            return null;
        const session = ctx.sessions.binding(id)?.session;
        if (session === undefined)
            return null;
        return {
            sessionId: id,
            snapshot: () => projectSnapshot(session.getSnapshot()),
            loadOlder: () => session.loadOlder().catch(() => { }),
        };
    };
    return {
        current: currentHandle,
        subscribe(fn) {
            let snapshotUnsub = null;
            const resubscribe = () => {
                snapshotUnsub?.();
                snapshotUnsub = null;
                const id = ctx.sessions.list.getSnapshot().current;
                const session = id === undefined ? undefined : ctx.sessions.binding(id)?.session;
                if (session !== undefined)
                    snapshotUnsub = session.subscribe(fn);
            };
            const offList = ctx.sessions.list.subscribe(() => {
                resubscribe();
                fn();
            });
            resubscribe();
            return () => {
                snapshotUnsub?.();
                offList();
            };
        },
    };
}
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
        driver = createFoldDriver(sessionSource(ctx), {
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
