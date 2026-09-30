/**
 * Phone and desktop remote control — browser half. Registers the `remote`
 * dictionaries, the sidebar-foot entry (phone trigger + pairing panel) into
 * the ui-sidebar `sidebar.footer.action` list seat, the remote-control
 * settings card into the Plugins page's `plugins.item` seat, and runs the
 * pair-accept boot flow (token accept + workspace deep-link + presence
 * heartbeats) plus the one-time failed-pair notice. Export discipline:
 * packages/client/AGENTS.md — the /client surface carries only what cordis
 * loading needs plus types.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { FooterRemoteEntry } from "./FooterRemoteEntry.js";
import { PairFailedNotice } from "./PairFailedNotice.js";
import { RemoteSettingsCard, RemoteSettingsCardController } from "./RemoteSettingsCard.js";
import { en, zh } from "./locales.js";
import { PAIR_FAILED_MARKER, runPairBootFlow } from "./deep-link.js";
import { sendHeartbeat } from "./pair-api.js";
/** Dictionary namespace owned by this plugin. */
const NS = 'remote';
/** Settings namespace the remote-control card edits (the Host plugin registers it). */
const REMOTE_WEB_UI_NS = 'remote-web-ui';
/** Heartbeat cadence from a paired phone (presence + revocation liveness). */
const HEARTBEAT_INTERVAL_MS = 10_000;
/** Services required by this plugin. */
export const inject = ['slots', 'locale', 'connection', 'configForms'];
/**
 * Register the remote-control surface.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => {
        try {
            return ctx.locale.register(NS, { zh, en });
        }
        catch {
            return () => { };
        }
    }, 'remote-web-ui: dictionaries');
    const t = ctx.locale.bind(NS);
    // The Host entry id (`remote-web-ui` in cordis.patch.yml) is the settings
    // namespace. `configForms` binds the shared describe mirror to it; the
    // snapshot moves on every Host commit without a page reload.
    const form = ctx.configForms.get(REMOTE_WEB_UI_NS);
    const enabled = () => {
        const snapshot = form.getSnapshot();
        return snapshot.status === 'ready'
            ? snapshot.value?.enabled ?? true
            : snapshot.status === 'unavailable';
    };
    // Sidebar foot entry beside the settings trigger: the shell declares
    // `sidebar.footer.action` (a list seat supplying { wide }); registration is
    // declaration-aware — slots.inject waits on the declaration, removes the
    // contribution when it collapses, and re-runs after a redeclaration. The
    // entry follows the plugin's enabled setting: toggling it off removes the
    // trigger, toggling it back on re-registers it.
    ctx.slots.inject('sidebar.footer.action', () => {
        let disposeEntry;
        const syncEntry = () => {
            if (enabled() && disposeEntry === undefined) {
                try {
                    disposeEntry = ctx.slots.register({ name: 'sidebar.footer.action', id: 'remote-web-ui', locale: NS }, FooterRemoteEntry);
                }
                catch {
                    // ignore registration collision
                }
            }
            else if (!enabled() && disposeEntry !== undefined) {
                disposeEntry();
                disposeEntry = undefined;
            }
        };
        const unsubscribe = form.subscribe(syncEntry);
        syncEntry();
        return () => {
            unsubscribe();
            disposeEntry?.();
        };
    });
    // Plugin configuration card: one staged form over the `remote-web-ui`
    // settings namespace, contributed to the Plugins page's `plugins.item` seat
    // (设置 → 插件). DSH 0.2.0 serves the namespace from the Loader entry's
    // volatile Config schema, and `whileServed` keeps the card off a deployment
    // that never composed this plugin.
    const remoteSettings = new RemoteSettingsCardController(form);
    ctx.effect(() => ctx.configForms.whileServed([REMOTE_WEB_UI_NS], () => ctx.slots.inject('plugins.item', () => {
        try {
            const unregister = ctx.slots.register({
                name: 'plugins.item',
                id: REMOTE_WEB_UI_NS,
                order: 100,
                label: () => t('settings.pluginsTab'),
                locale: NS,
                inject: () => remoteSettings.inject(),
            }, RemoteSettingsCard);
            return () => {
                remoteSettings.dispose();
                unregister();
            };
        }
        catch {
            return () => { };
        }
    })), 'remote-web-ui: settings card');
    // Phone-side boot flow + heartbeats. Loopback pages (the desktop) never
    // heartbeat; the server ignores unpaired heartbeats anyway. Both run only
    // while the plugin is enabled.
    let disposeRuntime;
    const syncRuntime = () => {
        if (enabled() && disposeRuntime === undefined) {
            disposeRuntime = ctx.effect(() => {
                const connection = ctx.get('connection');
                const loopback = connection?.isLoopback ?? true;
                runPairBootFlow(ctx, window.location.search);
                if (loopback)
                    return () => { };
                const timer = window.setInterval(() => { void sendHeartbeat().catch(() => { }); }, HEARTBEAT_INTERVAL_MS);
                return () => { window.clearInterval(timer); };
            }, 'remote-web-ui: pair flow + heartbeats');
        }
        else if (!enabled() && disposeRuntime !== undefined) {
            disposeRuntime();
            disposeRuntime = undefined;
        }
    };
    form.subscribe(syncRuntime);
    syncRuntime();
    // One-time failed-pair toast. The accept result lands asynchronously, so
    // the marker check is deferred past the accept round trip.
    ctx.effect(() => {
        const timer = window.setTimeout(() => {
            if (sessionStorage.getItem(PAIR_FAILED_MARKER) === null)
                return;
            sessionStorage.removeItem(PAIR_FAILED_MARKER);
            const mount = document.createElement('div');
            document.body.appendChild(mount);
            const root = createRoot(mount);
            root.render(createElement(PairFailedNotice, { t }));
            // The toast owns its dismissal; the root lives for the page lifetime.
            void root;
        }, 1500);
        return () => { window.clearTimeout(timer); };
    }, 'remote-web-ui: failed-pair notice');
}
