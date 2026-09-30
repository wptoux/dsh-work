/**
 * Phone and desktop remote control for the dsh web GUI — host half. Mounts
 * the pairing service (one-time tokens, device sessions, revocation), the
 * /api/pair route family (issue/accept/stop/heartbeat/status/events), the
 * presence sweep, and the optional public-tunnel QR base. The browser half
 * (the `./client` entry) renders the sidebar entry, the pairing panel, and
 * the pair/accept + deep-link flow.
 *
 * DSH 0.2.0 adaptation: plugin configuration is the Loader entry's own Config
 * (this package's `cordis.patch.yml` row), projected into the settings surface
 * from schema fields marked `.volatile()`. There is no `installSection`; a
 * live edit commits straight into the frozen `Volatile` references this plugin
 * reads, and the `settings/document-updated` event re-runs the structural
 * sync. The browser half registers its own card into the Plugins page's
 * `plugins.item` seat, so this half suppresses the auto-generated page.
 *
 * The harness's /api trust fence is declarative (`Connection` config
 * trustedHosts + LAN literals auto-trusted from an all-interface bind).
 * Pairing is therefore identity/recognition: this plugin owns its /api/pair
 * surfaces and exposes the live paired-cookie predicate to sibling plugins
 * (RemoteWebUiPairing), but it does not veto the harness's own /api dispatch.
 */
import { join } from 'node:path';
import { setInterval as nodeSetInterval } from 'node:timers';
import z from '@deepseek-ai/schemastery';
import { DEFAULT_IDLE_EXPIRE_MS, PairingService } from "./pairing.js";
import { asTrustedHostsOwner, ConnectionTrustSync } from "./connection-trust.js";
import { dshHome } from "./dsh-home.js";
import { isPairedDeviceRequest } from "./gate.js";
import { RemoteWebUiPairing } from "./pairing-access.js";
import { makeRoutes } from "./routes.js";
import { lanIPv4Addresses } from "./lan.js";
import { TunnelManager } from "./tunnel.js";
import { mountOnce } from "./mount-once.js";
import { UUID_POLYFILL_SCRIPT } from "./uuid-polyfill.js";
/** Stable cordis plugin name. */
export const name = 'remote-web-ui';
/** Services required before the pairing surfaces can mount. */
export const inject = ['webServer', 'connection'];
/**
 * Settings namespace of the remote-control capability — the section the web
 * settings surface edits. Spelled here rather than imported: the browser
 * half spells the same value and must not depend on a Host package.
 */
export const REMOTE_WEB_UI_SETTINGS_NAMESPACE = 'remote-web-ui';
export const Config = z.object({
    tokenTtlMs: z.number().step(1).min(60_000).default(10 * 60_000).volatile(),
    offlineAfterMs: z.number().step(1).min(5_000).default(25_000).volatile(),
    maxDevices: z.number().step(1).min(1).max(64).default(4).volatile(),
    idleExpireMs: z.number().step(1).min(60_000).default(DEFAULT_IDLE_EXPIRE_MS).volatile(),
    cookieName: z.string().min(1).default('dsh_pair').volatile(),
    publicBaseUrl: z.string().volatile(),
    devicesFile: z.string().volatile(),
    autoTunnel: z.boolean().default(false).volatile(),
    enabled: z.boolean().default(true).volatile(),
});
/** Presence sweep cadence (a stale device flips to disconnected within two sweeps). */
const SWEEP_INTERVAL_MS = 10_000;
/**
 * Read one config field's current value. The Loader hands `apply` frozen
 * `Volatile` references (`.get()`); hand-built test contexts may pass plain
 * values instead, so both shapes are accepted.
 * @param value - a Volatile reference, a plain value, or undefined.
 * @returns the current plain value.
 */
function readConfig(value) {
    if (value === null || typeof value !== 'object')
        return value;
    const get = value.get;
    return typeof get === 'function' ? get.call(value) : value;
}
/**
 * The single mapping from resolved plugin config to the pairing service
 * config. Both the constructed service and every live settings sync reuse
 * it, so no field can be silently dropped when the web settings surface
 * pushes a new value into the running service.
 */
export function pairingConfigOf(resolved) {
    return {
        tokenTtlMs: resolved.tokenTtlMs,
        offlineAfterMs: resolved.offlineAfterMs,
        maxDevices: resolved.maxDevices,
        idleExpireMs: resolved.idleExpireMs,
        cookieName: resolved.cookieName,
        devicesFile: resolved.devicesFile,
    };
}
/** Default paired-session store: `$DSH_HOME/remote-web-ui-devices.json`. */
export function defaultDevicesFile(home = dshHome()) {
    return join(home, 'remote-web-ui-devices.json');
}
/** Schema defaults, re-read for hand-built test contexts (the loader applies them normally). */
const DEFAULTS = {
    tokenTtlMs: 10 * 60_000,
    offlineAfterMs: 25_000,
    maxDevices: 4,
    idleExpireMs: DEFAULT_IDLE_EXPIRE_MS,
    cookieName: 'dsh_pair',
    publicBaseUrl: undefined,
    devicesFile: defaultDevicesFile(),
    autoTunnel: false,
    enabled: true,
};
/**
 * Mount the pairing service, routes, and presence sweep.
 * @param ctx - host plugin context carrying webServer and settings.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export const apply = mountOnce('dsh-remote-web-ui', applyImpl);
function applyImpl(ctx, config) {
    // The composition entry's Config is the single source. Every field is
    // volatile, so reading `get()` per call sees live settings edits without a
    // remount; the structural reactions ride `sync` below.
    const resolve = () => ({
        tokenTtlMs: readConfig(config?.tokenTtlMs) ?? DEFAULTS.tokenTtlMs,
        offlineAfterMs: readConfig(config?.offlineAfterMs) ?? DEFAULTS.offlineAfterMs,
        maxDevices: readConfig(config?.maxDevices) ?? DEFAULTS.maxDevices,
        idleExpireMs: readConfig(config?.idleExpireMs) ?? DEFAULTS.idleExpireMs,
        cookieName: readConfig(config?.cookieName) ?? DEFAULTS.cookieName,
        publicBaseUrl: readConfig(config?.publicBaseUrl),
        devicesFile: readConfig(config?.devicesFile) ?? DEFAULTS.devicesFile,
        autoTunnel: readConfig(config?.autoTunnel) ?? DEFAULTS.autoTunnel,
        enabled: readConfig(config?.enabled) ?? DEFAULTS.enabled,
    });
    const service = new PairingService(pairingConfigOf(resolve()));
    // ── native connection integration (DSH 0.1.5) ─────────────────────────────
    // The QR bootstrap hop redirects to the connection plugin's launch-token
    // URL (the phone lands on the Web GUI with the browser cookie), and the
    // active public host — a tunnel host is unknowable at boot, so it cannot
    // enter the fence via --trusted-host — is mirrored into the connection
    // fence's trustedHosts so the tunneled phone's /api requests pass the Host
    // check while the browser-session cookie still gates every request.
    const trust = new ConnectionTrustSync(asTrustedHostsOwner(ctx.connection));
    // ── auto tunnel ─────────────────────────────────────────────────────────
    // The minted public URL becomes the QR base (and the phone-facing pairing
    // fence's trusted host).
    const tunnel = new TunnelManager();
    let autoTunnel = resolve().autoTunnel;
    tunnel.onPhase((info) => {
        if (!autoTunnel)
            return;
        if (info.phase === 'running' && info.url !== undefined) {
            service.setPublicBaseUrl(info.url);
            service.setTunnelStatus({ state: 'running', url: info.url });
        }
        else if (info.phase === 'starting') {
            // A restart mints a NEW hostname: the previous URL dies with the old
            // process, so clear it now rather than advertising a dead link.
            service.setPublicBaseUrl(undefined);
            service.setTunnelStatus({ state: 'starting' });
        }
        else if (info.phase === 'failed') {
            service.setPublicBaseUrl(undefined);
            service.setTunnelStatus(info.error === undefined ? { state: 'failed' } : { state: 'failed', error: info.error });
        }
        trust.reflect(service.publicBaseUrl);
    });
    ctx.effect(() => () => {
        tunnel.dispose();
        trust.dispose();
    }, 'remote-web-ui: auto tunnel');
    // The bind facts are known by now (webServer is an inject edge): the LAN
    // bases are frozen per process, matching the CLI's once-per-invocation
    // sampling stance. The QR can only advertise addresses the fence accepts;
    // every interface gets its own base URL so a multi-homed machine can pick
    // the network the phone can actually reach.
    const lanBases = ctx.webServer.host === '0.0.0.0'
        ? lanIPv4Addresses().map(address => ({ address, base: `http://${address}:${String(ctx.webServer.port)}` }))
        : [];
    service.setLanBases(lanBases);
    const lanAddresses = lanBases.map(entry => entry.address);
    // Push a committed settings section into the service. The service config
    // object is read per operation (token mint, touch, sweep), so a live edit
    // takes effect without a restart. When `enabled` turns off, the pairing
    // routes and sweep timer are dropped and all device/token state is revoked.
    let disposeRoutes;
    let disposeSweep;
    const routes = makeRoutes({
        service,
        lanAddresses,
        authenticatedUrl: base => ctx.connection.authenticatedUrl(base),
    });
    // Inject the crypto.randomUUID polyfill before any other script runs, so that
    // the main bundle doesn't crash on non-secure contexts (LAN HTTP)
    ctx.effect(() => ctx.on('webserver/index-inject', (table) => {
        table.push({ kind: 'script', placement: 'head', text: UUID_POLYFILL_SCRIPT });
    }), 'remote-web-ui: uuid polyfill');
    // Sibling plugins look this service up by name to recognize a live paired
    // device (the cookie) on their own surfaces. Absent when this plugin is
    // not installed; stop() / enabled=false still refuse cookies.
    new RemoteWebUiPairing(ctx, (request) => {
        if (!resolve().enabled)
            return false;
        return isPairedDeviceRequest(service, request);
    });
    const sync = () => {
        const value = resolve();
        service.config = pairingConfigOf(value);
        // The auto tunnel owns the public base while enabled: the minted URL
        // lands in the service through the tunnel's phase listener. The manual
        // publicBaseUrl applies only when the auto tunnel is off.
        autoTunnel = value.autoTunnel === true;
        if (autoTunnel) {
            if (value.publicBaseUrl !== undefined) {
                console.warn('remote-web-ui: autoTunnel is on — ignoring the manually configured publicBaseUrl');
            }
            tunnel.start(`http://127.0.0.1:${String(ctx.webServer.port)}`);
        }
        else {
            tunnel.stop();
            // A malformed public base is ignored with a warning — LAN-only behavior
            // stays intact rather than silently minting unusable QR links.
            if (value.publicBaseUrl !== undefined && !isHttpUrl(value.publicBaseUrl)) {
                console.warn(`remote-web-ui: ignoring malformed publicBaseUrl ${JSON.stringify(value.publicBaseUrl)} (expected https://host[:port])`);
                service.setPublicBaseUrl(undefined);
            }
            else {
                service.setPublicBaseUrl(value.publicBaseUrl);
            }
        }
        // The tunnel phase listener mirrors the auto-tunnel URL; the manual base
        // (and every live edit) lands here.
        trust.reflect(service.publicBaseUrl);
        const enabled = value.enabled;
        if (!enabled)
            service.stop();
        if (disposeRoutes === undefined && enabled) {
            disposeRoutes = ctx.effect(() => {
                const disposers = routes.map(route => ctx.webServer.register(route));
                return () => { for (const dispose of disposers)
                    dispose(); };
            }, 'remote-web-ui: pairing routes');
        }
        else if (disposeRoutes !== undefined && !enabled) {
            disposeRoutes();
            disposeRoutes = undefined;
        }
        if (disposeSweep === undefined && enabled) {
            disposeSweep = ctx.effect(() => {
                const timer = nodeSetInterval(() => { service.sweep(); }, SWEEP_INTERVAL_MS);
                timer.unref();
                return () => { clearInterval(timer); };
            }, 'remote-web-ui: presence sweep');
        }
        else if (disposeSweep !== undefined && !enabled) {
            disposeSweep();
            disposeSweep = undefined;
        }
    };
    sync();
    // DSH 0.2.0 owns plugin configuration: the Loader entry's Config schema is
    // the single source, and the settings surface projects its volatile fields.
    // The browser half contributes its own card to the Plugins page, so suppress
    // the auto-generated page for this entry.
    ctx.inject(['settings'], (child) => {
        child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
    });
    // A volatile-only settings edit commits into the references without
    // remounting this fiber, so re-run the structural sync when this entry's
    // document changes (enable/disable, tunnel start/stop).
    ctx.effect(() => ctx.on('settings/document-updated', (ns) => {
        if (ns === REMOTE_WEB_UI_SETTINGS_NAMESPACE)
            sync();
    }), 'remote-web-ui: live settings sync');
}
/** Whether a configured public base is a parseable http(s) URL with a host. */
function isHttpUrl(value) {
    try {
        const url = new URL(value);
        return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
    }
    catch {
        return false;
    }
}
