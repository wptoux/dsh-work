/**
 * The remote data channel: `/remote` is this plugin's own prefix, so the
 * paired-device cookie is the access control — the only channel a phone or
 * computer outside loopback rides (the dedicated `/m/api` mobile surface
 * was removed; every device now runs the full Web GUI through this gate).
 * After that gate, every fenced same-origin path the browser rewrote here is
 * re-issued to 127.0.0.1 as a loopback-shaped request so sibling plugin
 * fences (and the connection plugin's `/api`) accept it — no `--trusted-host`
 * and no per-plugin pairing consult.
 *
 * Security model:
 * - While `requirePairingForLan` is on (default), every request must carry a
 *   live paired-device cookie, enforced before any bytes are forwarded and
 *   before any host call. With the policy off, the cookie gate is skipped
 *   (the loopback-only denials below still apply).
 * - The SDK's loopback-only privileged methods (native dialogs, the settings
 *   plane, credentials — the `PRIVILEGED_METHODS` set of client-connection)
 *   are denied here. The set is pinned by tests/remote-contract.spec.ts.
 * - `/api/pair/*`, `/api/plugin-manager/*`,
 *   `/api/dsh-desktop-launcher/*` and `/api/dsh-web-ui-settings/*` stay physically local.
 * - Everything else is HTTP- or WebSocket-proxied to the local port with
 *   Host rewritten, Origin and cookies dropped, and a synthetic same-origin
 *   browser marker added after authentication. Plugin loopback fences then
 *   pass. The pairing cookie never leaves this process.
 */
import type { WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver';
import type { PairingService } from './pairing.ts';
export { DESKTOP_LAUNCHER_PATH, LOOPBACK_ONLY_METHODS, PLUGIN_MANAGER_PATH, REMOTE_API_PATHS, REMOTE_PREFIX, REMOTE_UPGRADE_PATHS, WEB_UI_SETTINGS_BRIDGE_PATH, } from './remote-methods.ts';
export { REMOTE_API_PREFIX } from './remote-methods.ts';
/** Route-family dependencies. */
export interface RemoteApiDeps {
    /** The pairing service (device gate + cookie name). */
    service: PairingService;
    /** The local webServer port the loopback proxy connects to. */
    port: number;
    /**
     * Live policy: whether the paired-device cookie gates the /remote channel.
     * When false, requests are proxied without a cookie (the loopback-only
     * denials still apply). A function is re-read per request, so a settings
     * edit takes effect without a restart. Defaults to true.
     */
    requirePairingForLan?: boolean | (() => boolean);
}
/**
 * Map `/remote/...` to the inner path, or undefined when the outer path is
 * not a safe rewrite target.
 */
export declare function innerPathOf(pathname: string): string | undefined;
/**
 * Whether a paired inner path must stay physically local.
 * @returns a denial message, or undefined when the path may be proxied.
 */
export declare function loopbackOnlyDenial(innerPath: string): string | undefined;
/**
 * Build the remote desktop channel HTTP routes.
 * @param deps - pairing service + local port + live pairing policy.
 * @returns the routes to register on webServer.
 */
export declare function makeRemoteApiRoutes(deps: RemoteApiDeps): WebRoute[];
/**
 * Map one outer upgrade URL onto the loopback path (query string included).
 */
export declare function upgradeInnerPath(reqUrl: string | undefined, fallbackPath: string): string;
/**
 * Build the WebSocket upgrade routes for the event streams and known plugin
 * sockets. webServer matches upgrades by exact path.
 * @param deps - pairing service + local port + live pairing policy.
 * @returns the upgrade routes to register on webServer.
 */
export declare function makeRemoteApiUpgradeRoutes(deps: RemoteApiDeps): WebUpgradeRoute[];
//# sourceMappingURL=remote-api.d.ts.map