/**
 * Runtime mirror of the plugin's active public base into the Connection
 * fence's trusted-host list.
 *
 * DSH 0.1.5's /api trust fence (`client-connection` `requestRejection`)
 * accepts loopback and the `trustedHosts` configured at load time — the web
 * profile feeds it `--trusted-host` values plus LAN literals derived from an
 * all-interface bind. It exposes no dynamic trust API, so a tunnel host
 * discovered AFTER boot (auto-tunnel quick URLs mint a fresh hostname on
 * every restart, and a manual `publicBaseUrl` is a plugin-level value) cannot
 * enter the fence through configuration.
 *
 * The plugin's own tunnel is the advertised access point — precisely the
 * authority `--trusted-host` would declare if it were knowable at boot — so
 * the active public host is mirrored into the connection service's trust list
 * at runtime. The mirror is additive and scoped: the Host/Origin fence and
 * the browser-session cookie still gate every /api request exactly as
 * configured, and a cleared public base (tunnel restart/failure, stop, or
 * plugin disposal) removes the entry again. The `trustedHosts` field is
 * private in the kernel's type declarations, so this access is a deliberate,
 * documented seam — the only dynamic alternative would be per-request veto
 * hooks, which 0.1.5 removed.
 */
/**
 * Narrow an unknown Connection handle to its trust-list face, or undefined
 * when the runtime shape is absent (test contexts, non-web profiles). The
 * structural check mirrors what the kernel's fence actually reads.
 * @param connection - the `ctx.connection` service instance.
 * @returns the live trust-list owner, when present.
 */
export function asTrustedHostsOwner(connection) {
    if (connection === null || typeof connection !== 'object')
        return undefined;
    const candidate = connection;
    return Array.isArray(candidate.trustedHosts) ? candidate : undefined;
}
/**
 * Track the last mirrored public host and keep the fence's trust list in
 * sync. `reflect()` is idempotent and safe to call after every state change;
 * `dispose()` clears the mirror (plugin teardown).
 */
export class ConnectionTrustSync {
    owner;
    host;
    /**
     * @param owner - the connection service's trust list, when present.
     */
    constructor(owner) {
        this.owner = owner;
    }
    /**
     * Mirror the active public base's authority (or clear it). A malformed
     * base clears the previous entry rather than throwing — the caller already
     * validated it before advertising, and a bad value must not wedge the
     * fence.
     * @param baseUrl - the active public base URL, or undefined when none.
     */
    reflect(baseUrl) {
        if (this.owner === undefined)
            return;
        let host;
        if (baseUrl !== undefined) {
            try {
                host = new URL(baseUrl).host;
            }
            catch {
                host = undefined;
            }
        }
        if (host === this.host)
            return;
        if (this.host !== undefined) {
            const index = this.owner.trustedHosts.indexOf(this.host);
            if (index !== -1)
                this.owner.trustedHosts.splice(index, 1);
        }
        this.host = host;
        if (host !== undefined && !this.owner.trustedHosts.includes(host)) {
            this.owner.trustedHosts.push(host);
        }
    }
    /** Clear the mirrored authority (plugin teardown). */
    dispose() {
        this.reflect(undefined);
    }
}
