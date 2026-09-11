/**
 * Phone and desktop remote control for the dsh web GUI — host half. Mounts
 * the pairing service (one-time tokens, device sessions, revocation), the
 * /api/pair route family (issue/accept/stop/heartbeat/status/events), the
 * presence sweep, and the optional public-tunnel QR base. The browser half
 * (the `./client` entry) renders the sidebar entry, the pairing panel, and
 * the pair/accept + deep-link flow.
 *
 * DSH 0.1.5 adaptation: the harness's /api trust fence is declarative
 * (`Connection` config trustedHosts + LAN literals auto-trusted from an
 * all-interface bind) and the 0.1.1 `api/gate` per-request veto seam no
 * longer exists. Pairing is therefore identity/recognition: this plugin owns
 * its /api/pair surfaces and exposes the live paired-cookie predicate to
 * sibling plugins (RemoteWebUiPairing), but it does not veto the harness's
 * own /api dispatch.
 */
import type { Context } from '@deepseek-ai/cordis';
import z from 'schemastery';
import { type PairingConfig } from './pairing.ts';
/** Stable cordis plugin name. */
export declare const name = "remote-web-ui";
/** Services required before the pairing surfaces can mount. */
export declare const inject: string[];
/**
 * Settings namespace of the remote-control capability — the section the web
 * settings surface edits. Spelled here rather than imported: the browser
 * half spells the same value and must not depend on a Host package.
 */
export declare const REMOTE_WEB_UI_SETTINGS_NAMESPACE = "remote-web-ui";
/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
    /** Token lifetime in ms; the QR link dies after this. */
    tokenTtlMs?: number;
    /** A device is "online" while its lastSeenAt is newer than this (ms). */
    offlineAfterMs?: number;
    /** Hard cap on paired device sessions (oldest evicted when full). */
    maxDevices?: number;
    /**
     * Idle sessions older than this (ms) are deleted from memory and disk.
     * Default is 7 days; a leftover cookie no longer authorizes after expiry.
     */
    idleExpireMs?: number;
    /** Cookie name carrying the paired device id. */
    cookieName?: string;
    /**
     * Public base URL of a tunnel in front of this server (e.g. a Cloudflare
     * Tunnel quick URL `https://xxx.trycloudflare.com` or a named-tunnel
     * subdomain). When set, the QR link is built from it — a phone anywhere
     * can pair — and its host is trusted by the phone-facing pairing fence.
     * Leave unset for LAN-only usage. Malformed values are ignored with a
     * warning (LAN-only behavior preserved). Ignored while `autoTunnel` is on.
     */
    publicBaseUrl?: string;
    /**
     * Absolute path to a JSON file where paired device sessions are persisted.
     * Defaults to `$DSH_HOME/remote-web-ui-devices.json` so a paired device
     * keeps its session across `dsh web` restarts (the cookie already lives
     * 365 days). Override to another absolute path when needed.
     */
    devicesFile?: string;
    /**
     * When true, the plugin runs its own Cloudflare quick tunnel (the
     * cloudflared binary ships with the package — no user-side install) and
     * feeds the minted public URL into the QR base and the phone-facing
     * pairing fence dynamically, so phones anywhere can pair without any manual
     * tunnel setup. The manual `publicBaseUrl` is ignored while this is on.
     */
    autoTunnel?: boolean;
    /** Master switch for the plugin (browser half + host pairing surfaces). */
    enabled?: boolean;
}
export declare const Config: z<Config>;
/**
 * Fully resolved config: every field non-optional except `publicBaseUrl`,
 * which legitimately resolves to `undefined` when unset (the schema keeps it
 * optional, so `Required` alone would over-narrow it to `string`).
 */
type ResolvedConfig = Required<Omit<Config, 'publicBaseUrl' | 'devicesFile'>> & {
    publicBaseUrl: string | undefined;
    devicesFile: string;
};
/**
 * The single mapping from resolved plugin config to the pairing service
 * config. Both the constructed service and every live settings sync reuse
 * it, so no field can be silently dropped when the web settings surface
 * pushes a new value into the running service.
 */
export declare function pairingConfigOf(resolved: Pick<ResolvedConfig, 'tokenTtlMs' | 'offlineAfterMs' | 'maxDevices' | 'idleExpireMs' | 'cookieName' | 'devicesFile'>): PairingConfig;
/** Default paired-session store: `$DSH_HOME/remote-web-ui-devices.json`. */
export declare function defaultDevicesFile(home?: string): string;
/**
 * Mount the pairing service, routes, and presence sweep.
 * @param ctx - host plugin context carrying webServer and settings.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export declare const apply: typeof applyImpl;
declare function applyImpl(ctx: Context, config?: Config): void;
export {};
//# sourceMappingURL=index.d.ts.map