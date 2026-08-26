/**
 * Phone and desktop remote control for the dsh web GUI — host half. Mounts
 * the pairing service (one-time tokens, device sessions, revocation), the
 * /api/pair route family (issue/accept/stop/heartbeat/status/events), the
 * api/gate listener that enforces pairing on every other /api request from
 * non-loopback hosts, and the presence sweep. The browser half (the
 * `./client` entry) renders the sidebar entry, the pairing panel, and the
 * pair/accept + deep-link flow. A paired phone opens the full Web GUI like
 * a paired computer, riding the gated /remote channel.
 */
import { join } from 'node:path';
import { setInterval as nodeSetInterval, setTimeout as nodeSetTimeout } from 'node:timers';
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';
import z from 'schemastery';
import { DEFAULT_IDLE_EXPIRE_MS, PairingService } from "./pairing.js";
import { dshHome } from "./dsh-home.js";
import { isPairedDeviceRequest, makeGateListener } from "./gate.js";
import { RemoteWebUiPairing } from "./pairing-access.js";
import { makeRoutes } from "./routes.js";
import { makePairedModelCatalogRoutes } from "./paired-model-catalog.js";
import { makeRemoteApiRoutes, makeRemoteApiUpgradeRoutes } from "./remote-api.js";
import { claimPostureKey, postureTargets, probePosture, releasePostureKey } from "./posture.js";
import { lanIPv4Addresses } from "./lan.js";
import { TunnelManager } from "./tunnel.js";
import { mountOnce } from "./mount-once.js";
import { REMOTE_CHANNEL_BOOT_SCRIPT } from "./remote-channel-boot.js";
import { UUID_POLYFILL_SCRIPT } from "./uuid-polyfill.js";
/** Stable cordis plugin name. */
export const name = 'remote-web-ui';
/** Services required before the pairing surfaces can mount. */
export const inject = ['webServer', 'apiProxy'];
/**
 * Settings namespace of the remote-control capability — the section the web
 * settings surface edits. Spelled here rather than imported: the browser
 * half spells the same value and must not depend on a Host package.
 */
export const REMOTE_WEB_UI_SETTINGS_NAMESPACE = settingsNamespace('remote-web-ui');
export const Config = z.object({
    tokenTtlMs: z.number().step(1).min(60_000).default(10 * 60_000),
    offlineAfterMs: z.number().step(1).min(5_000).default(25_000),
    maxDevices: z.number().step(1).min(1).max(64).default(4),
    idleExpireMs: z.number().step(1).min(60_000).default(DEFAULT_IDLE_EXPIRE_MS),
    cookieName: z.string().min(1).default('dsh_pair'),
    requirePairingForLan: z.boolean().default(true),
    publicBaseUrl: z.string(),
    devicesFile: z.string(),
    autoTunnel: z.boolean().default(false),
    enabled: z.boolean().default(true),
});
/** Presence sweep cadence (a stale device flips to disconnected within two sweeps). */
const SWEEP_INTERVAL_MS = 10_000;
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
    requirePairingForLan: true,
    publicBaseUrl: undefined,
    devicesFile: defaultDevicesFile(),
    autoTunnel: false,
    enabled: true,
};
/**
 * Mount the pairing service, routes, gate listener, and presence sweep.
 * @param ctx - host plugin context carrying webServer.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export const apply = mountOnce('dsh-remote-web-ui', applyImpl);
function applyImpl(ctx, config) {
    const resolved = {
        tokenTtlMs: config?.tokenTtlMs ?? DEFAULTS.tokenTtlMs,
        offlineAfterMs: config?.offlineAfterMs ?? DEFAULTS.offlineAfterMs,
        maxDevices: config?.maxDevices ?? DEFAULTS.maxDevices,
        idleExpireMs: config?.idleExpireMs ?? DEFAULTS.idleExpireMs,
        cookieName: config?.cookieName ?? DEFAULTS.cookieName,
        requirePairingForLan: config?.requirePairingForLan ?? DEFAULTS.requirePairingForLan,
        publicBaseUrl: config?.publicBaseUrl,
        devicesFile: config?.devicesFile ?? DEFAULTS.devicesFile,
        autoTunnel: config?.autoTunnel ?? DEFAULTS.autoTunnel,
        enabled: config?.enabled ?? DEFAULTS.enabled,
    };
    // The live source the pairing service and the gate read: the settings
    // section once the web settings surface is served, the composition entry
    // otherwise (installSettingsSection swaps it when the namespace registers).
    let current = () => config ?? {};
    const resolve = () => {
        const value = current();
        return {
            tokenTtlMs: value.tokenTtlMs ?? DEFAULTS.tokenTtlMs,
            offlineAfterMs: value.offlineAfterMs ?? DEFAULTS.offlineAfterMs,
            maxDevices: value.maxDevices ?? DEFAULTS.maxDevices,
            idleExpireMs: value.idleExpireMs ?? DEFAULTS.idleExpireMs,
            cookieName: value.cookieName ?? DEFAULTS.cookieName,
            requirePairingForLan: value.requirePairingForLan ?? DEFAULTS.requirePairingForLan,
            publicBaseUrl: value.publicBaseUrl,
            devicesFile: value.devicesFile ?? DEFAULTS.devicesFile,
            autoTunnel: value.autoTunnel ?? DEFAULTS.autoTunnel,
            enabled: value.enabled ?? DEFAULTS.enabled,
        };
    };
    const service = new PairingService(pairingConfigOf(resolved));
    // ── auto tunnel ─────────────────────────────────────────────────────────
    // The minted public URL becomes the QR base (and the pairing fence's
    // trusted host). A phone (non-loopback) rides the gated /remote desktop
    // channel like any paired computer — no connection trust fence mutation is
    // needed here (a distributable plugin must not change the harness's
    // connection plugin).
    const tunnel = new TunnelManager();
    let autoTunnel = resolved.autoTunnel;
    tunnel.onPhase((info) => {
        if (!autoTunnel)
            return;
        if (info.phase === 'running' && info.url !== undefined) {
            service.setPublicBaseUrl(info.url);
            service.setTunnelStatus({ state: 'running', url: info.url });
            runPostureProbe();
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
    });
    ctx.effect(() => () => {
        tunnel.dispose();
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
    // Push a committed settings section into the service and gate. The service
    // config object is read per operation (token mint, touch, sweep), and the
    // gate re-reads its fence flag per request, so a live edit takes effect
    // without a restart. When `enabled` turns off, the pairing routes and
    // sweep timer are dropped and all device/token state is revoked, but the
    // gate listener stays mounted so a LAN-exposed /api stays behind pairing
    // (now vetoing every non-loopback request) instead of opening the fence.
    let disposeRoutes;
    let disposeSweep;
    // The pairing surface: /api/pair routes, the paired model catalog (needs
    // the host ApiProxy service; the plugin injects it), and the gated
    // /remote desktop channel every non-loopback device (phone or computer)
    // rides.
    const apiProxy = ctx.get('apiProxy');
    if (apiProxy === undefined) {
        console.warn('remote-web-ui: apiProxy service unavailable — the paired model catalog is disabled');
    }
    const routes = [
        ...makeRoutes({ service, lanAddresses, requirePairingForLan: () => resolve().requirePairingForLan }),
        ...(apiProxy !== undefined ? makePairedModelCatalogRoutes({ service, apiProxy, lanAddresses }) : []),
        // The remote desktop channel: policy-gated `/remote` prefix that
        // re-issues fenced paths to loopback (see remote-api.ts). The live
        // requirePairingForLan is re-read per request, same as the gate listener
        // and routes above, so a stale client rewrite on an open-LAN deployment
        // proxies instead of 403ing.
        ...makeRemoteApiRoutes({
            service,
            port: ctx.webServer.port,
            requirePairingForLan: () => resolve().requirePairingForLan,
        }),
    ];
    const upgrades = makeRemoteApiUpgradeRoutes({
        service,
        port: ctx.webServer.port,
        requirePairingForLan: () => resolve().requirePairingForLan,
    });
    const gate = makeGateListener(service, () => resolve().requirePairingForLan, () => resolve().enabled);
    ctx.effect(() => ctx.on('api/gate', gate), 'remote-web-ui: api gate');
    // ── posture probe ─────────────────────────────────────────────────────────
    // Guardrail for the one seam this plugin cannot mount a gate into: the
    // connection plugin's /api Host fence. Forged-Host probes against every
    // advertised origin (public base + LAN bases) make a re-opened /api (a
    // re-added --trusted-host, or the SDK's LAN auto-trust under 0.0.0.0)
    // visible on the panel and the log instead of silently trusted.
    let postureKey;
    let postureWasExposed = false;
    const runPostureProbe = () => {
        if (!resolve().enabled)
            return;
        const targets = postureTargets(service.publicBaseUrl, service.lanAddresses, ctx.webServer.port);
        if (targets.length === 0) {
            postureKey = undefined;
            service.setPosture(undefined);
            return;
        }
        const key = targets.join('|');
        const claim = claimPostureKey(postureKey, key);
        if (!claim.run)
            return;
        postureKey = claim.next;
        void probePosture({ port: ctx.webServer.port, targets }).then((snapshot) => {
            service.setPosture(snapshot);
            const exposedHosts = snapshot.hosts.filter(host => host.exposed).map(host => host.host);
            const exposed = exposedHosts.length > 0;
            if (exposed && !postureWasExposed) {
                console.error(`remote-web-ui: CRITICAL — the /api fence is OPEN for [${exposedHosts.join(', ')}]: unpaired clients reach the full host API. Remove --trusted-host for these hosts (pairing covers them) or bind loopback.`);
            }
            else if (!exposed && postureWasExposed) {
                console.log('remote-web-ui: the /api posture probe is clean again (every advertised origin refused with 403).');
            }
            postureWasExposed = exposed;
        }).catch(() => {
            // Keep the previous snapshot; drop the in-flight key so the same
            // targets retry instead of sticking on a failed round.
            postureKey = releasePostureKey(postureKey, key);
        });
    };
    // The first round waits for the connection plugin's /api route: a probe
    // before it mounts would read the SPA fallback and false-positive.
    const initialPostureTimer = nodeSetTimeout(() => { runPostureProbe(); }, 5_000);
    initialPostureTimer.unref();
    ctx.effect(() => () => { clearTimeout(initialPostureTimer); }, 'remote-web-ui: posture probe boot');
    // Sibling plugins (aionui-panel, …) look this up by name. Absent when this
    // plugin is not installed; stop() / enabled=false still refuse cookies.
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
        const enabled = value.enabled;
        if (!enabled)
            service.stop();
        if (disposeRoutes === undefined && enabled) {
            disposeRoutes = ctx.effect(() => {
                const disposers = [
                    ...routes.map(route => ctx.webServer.register(route)),
                    ...upgrades.map(route => ctx.webServer.registerUpgrade(route)),
                ];
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
        // Settings changed the reachable posture (manual publicBaseUrl, bind):
        // re-probe unless the target set is unchanged.
        runPostureProbe();
    };
    // Inject the crypto.randomUUID polyfill before any other script runs, so that
    // the main bundle doesn't crash on non-secure contexts (LAN HTTP)
    ctx.effect(() => ctx.on('webserver/index-inject', (table) => {
        table.push({ kind: 'script', placement: 'head', text: UUID_POLYFILL_SCRIPT });
    }), 'remote-web-ui: uuid polyfill');
    // Issue #987: the browser-half channel patch installs at this plugin's
    // boot entry, but dsh-client-connection boots earlier and opens its event
    // streams unrewritten — on a non-loopback origin the SDK fence rejects
    // them and the workspace list never loads. Contribute the rewrite as a
    // parse-time head script so it is active before ANY boot entry runs; the
    // client apply adopts the installed seat instead of patching twice. The
    // row follows the live steady-state decision (enabled + pairing gate); the
    // script itself skips loopback origins.
    ctx.effect(() => ctx.on('webserver/index-inject', (table) => {
        const value = resolve();
        if (!value.enabled || !value.requirePairingForLan)
            return;
        table.push({ kind: 'script', placement: 'head', text: REMOTE_CHANNEL_BOOT_SCRIPT });
    }), 'remote-web-ui: remote channel boot patch');
    installSettingsSection(ctx, REMOTE_WEB_UI_SETTINGS_NAMESPACE, Config, config ?? {}, {
        setSource: (source) => {
            current = source;
            sync();
        },
        onChange: sync,
    });
    sync();
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
