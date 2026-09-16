/**
 * The /api/pair route family + the desktop status stream. Exact routes
 * under /api: the webserver matches exact paths before the connection
 * plugin's /api prefix, so these handlers own the full response lifecycle
 * and apply their own trust fence (loopback-only for control endpoints;
 * loopback-or-LAN for the phone-facing accept/heartbeat/status). The
 * cookie set on accept is the device identity the api/gate listener checks
 * on every other /api request.
 */
import { z } from 'zod';
import { UnknownLanAddressError } from "./pairing.js";
import { isLoopbackClient, readCookie } from "./gate.js";
import { readJsonBody, writeJson } from "./http.js";
/**
 * Browser-trust fence for the /api/pair routes, mirroring the connection
 * package's internal fence semantics (Host/Origin based, DNS-rebinding and
 * cross-site defense). The connection package no longer exports its trust
 * predicate — the fence for the /api prefix lives inside the connection
 * plugin — so the pairing routes, which must stay reachable from LAN phones
 * ahead of the connection prefix route (exact routes match first), carry
 * their own copy scoped to the literals the QR links advertise.
 * @param request - the node HTTP request.
 * @param trustedHosts - non-loopback authorities this surface serves: exact
 * `host:port`, or port-less `host` matching any port.
 * @returns true when the Host is ours (loopback or trusted) and any attached
 * browser markers are same-origin.
 */
export function isTrustedApiRequest(request, trustedHosts) {
    const host = request.headers.host;
    if (typeof host !== 'string')
        return false;
    let hostUrl;
    try {
        hostUrl = new URL(`http://${host}`);
    }
    catch {
        return false;
    }
    const hostname = hostUrl.hostname;
    const trusted = isLoopbackClient(request) || trustedHosts.some(entry => {
        // A port-less entry matches the hostname on any port; an exact host:port
        // entry matches that authority verbatim (WHATWG normalization both sides).
        const entryUrl = new URL(`http://${entry}`);
        return entryUrl.port === '' ? entryUrl.hostname === hostname : entryUrl.host === hostUrl.host;
    });
    if (!trusted)
        return false;
    // Cross-site fence: an explicit cross-site marker is refused regardless of
    // Origin (modern browsers label the initiator on every fetch).
    if (request.headers['sec-fetch-site'] === 'cross-site')
        return false;
    // Origin fence: when a browser attaches a concrete Origin it must be
    // exactly this authority; absent Origin is fine — the Host fence already
    // bound it. An opaque origin (`Origin: null`, sent by camera QR scanners
    // and in-app webviews when a top-level navigation leaves an origin-less
    // context) is treated the same as absent: the explicit cross-site marker
    // above already refuses subresource/iframe requests, and both the device
    // cookie (SameSite=Lax) and the harness browser cookie (SameSite=Strict)
    // are withheld from cross-site requests regardless.
    const origin = request.headers.origin;
    if (origin === undefined || origin === 'null')
        return true;
    try {
        return new URL(origin).host === hostUrl.host;
    }
    catch {
        return false;
    }
}
/** Cap on pairing request bodies (tokens and workspace ids are tiny). */
const MAX_BODY_BYTES = 4096;
/**
 * The host authority of a configured public base URL, e.g. `foo.trycloudflare.com`
 * from `https://foo.trycloudflare.com`. Undefined when the URL does not parse —
 * a malformed config then simply contributes no fence entry (and the panel
 * falls back to LAN-only URLs).
 * @param url - the configured public base URL (or undefined).
 * @returns the `host[:port]` authority the fence should trust.
 */
export function publicHostOf(url) {
    if (url === undefined)
        return undefined;
    try {
        return new URL(url).host;
    }
    catch {
        return undefined;
    }
}
/** Cookie lifetime: one year; revoked sessions die at the gate regardless. */
const COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60;
/** Route paths (exact matches under /api). */
export const PAIR_PATHS = {
    issue: '/api/pair/issue',
    accept: '/api/pair/accept',
    open: '/api/pair/open',
    stop: '/api/pair/stop',
    revoke: '/api/pair/revoke',
    heartbeat: '/api/pair/heartbeat',
    status: '/api/pair/status',
    events: '/api/pair/events',
};
/**
 * /api/pair request payload contracts. Each POST endpoint validates its body
 * against one of these instead of reaching into a hand-parsed object: the
 * control-plane endpoints that carry no meaningful payload use the permissive
 * pairActionPayloadSchema so their smoke calls keep working unchanged, while
 * issue/accept enforce their optional/required fields. Unknown (extra) keys
 * are tolerated exactly as the previous manual reads ignored them.
 */
export const issuePayloadSchema = z.object({
    workspaceId: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
});
export const acceptPayloadSchema = z.object({
    token: z.string().default(''),
});
export const revokePayloadSchema = z.object({
    deviceId: z.string().min(1),
});
export const pairActionPayloadSchema = z.object({}).passthrough();
/**
 * Parse a pair request body through schema. A missing/empty, unparseable
 * or non-object body (shared readJsonBody with objectOnly yields null for
 * all of them) is treated as an empty object — the desktop stop/heartbeat
 * send no body — and a value that fails the schema returns `undefined` so
 * the caller can answer with the existing error shape.
 */
function parsePairPayload(schema, body) {
    const result = schema.safeParse(body ?? {});
    return result.success ? result.data : undefined;
}
/** The SSE fan-out for desktop panel status. */
export class PairingEventsStream {
    streams = new Set();
    /**
     * @param service - the pairing service whose snapshots are fanned out.
     */
    constructor(service) {
        service.onState((snapshot) => { this.push(snapshot); });
    }
    /** Open one stream; the response is owned to completion. */
    open(req, res) {
        res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
        });
        const stream = { res, closed: false };
        this.streams.add(stream);
        const close = () => {
            if (stream.closed)
                return;
            stream.closed = true;
            this.streams.delete(stream);
        };
        res.on('close', close);
        req.on('close', close);
    }
    /** Push one frame to every open stream (contained per stream). */
    push(snapshot) {
        const frame = `data: ${JSON.stringify({ type: 'state', ...snapshot })}\n\n`;
        for (const stream of this.streams) {
            try {
                stream.res.write(frame);
            }
            catch {
                stream.closed = true;
                this.streams.delete(stream);
            }
        }
    }
    /** Stream count (tests/diagnostics). */
    get size() {
        return this.streams.size;
    }
}
/** One device-session cookie (the accept and bootstrap hops share it). */
function deviceSessionCookie(service, deviceId) {
    return `${service.config.cookieName}=${deviceId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(COOKIE_MAX_AGE_SEC)}`;
}
/**
 * The origin the phone actually reached the server through, preserving the
 * scheme. A tunneled public base keeps https; every other authority (LAN,
 * or loopback) is plain http — the native launch-token exchange is
 * authority-agnostic, so the redirect simply lands on the origin the QR was
 * opened from.
 * @param req - the bootstrap request (its Host names the reachable authority).
 * @param service - pairing service carrying the configured public base.
 * @returns the base origin for the redirect, or undefined without a Host.
 */
export function requestOriginBase(req, service) {
    const host = req.headers.host;
    if (typeof host !== 'string' || host === '')
        return undefined;
    const publicUrl = service.publicBaseUrl;
    if (publicUrl !== undefined) {
        try {
            const publicHost = new URL(publicUrl).hostname;
            if (new URL(`http://${host}`).hostname === publicHost) {
                return `${new URL(publicUrl).protocol}//${host}`;
            }
        }
        catch {
            // Malformed public base: fall through to the plain-http construction.
        }
    }
    return `http://${host}`;
}
/** One minimal plain-text response (bootstrap-hop error pages). */
function writeText(res, status, text) {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(text);
}
/**
 * Build the /api/pair route family.
 * @param deps - service + fence inputs.
 * @returns the exact routes to register on webServer.
 */
export function makeRoutes(deps) {
    const { service, lanAddresses } = deps;
    const events = new PairingEventsStream(service);
    /** Loopback-only fence: the desktop panel's control endpoints. */
    const loopbackFence = (req) => isTrustedApiRequest(req, []);
    /** Phone-facing fence: loopback, the derived LAN literals, or the configured public host. */
    const lanFence = (req) => {
        const publicHost = publicHostOf(service.publicBaseUrl);
        return isTrustedApiRequest(req, publicHost === undefined ? lanAddresses : [...lanAddresses, publicHost]);
    };
    const requireMethod = (req, res, method) => {
        if (req.method === method)
            return true;
        res.writeHead(405);
        res.end();
        return false;
    };
    /** Per-source-IP accept rate limit (brute-force defense in depth). */
    const acceptAttempts = new Map();
    const ACCEPT_MAX_ATTEMPTS = 10;
    const ACCEPT_WINDOW_MS = 30_000;
    const rateLimitAccept = (req) => {
        const socketIp = req.socket?.remoteAddress ?? 'unknown';
        // Behind the auto-tunnel every internet client arrives from 127.0.0.1,
        // so a single shared bucket would let one attacker keep the legitimate
        // owner rate-limited. Partition the availability bucket by the first
        // client-visible XFF hop (set by the tunnel edge): XFF is untrusted for
        // authentication and only separates buckets, it never grants access.
        const forwarded = typeof req.headers['x-forwarded-for'] === 'string'
            ? (req.headers['x-forwarded-for'].split(',')[0] ?? '').trim()
            : undefined;
        const ip = forwarded === undefined || forwarded === '' ? socketIp : socketIp + '|' + forwarded;
        const nowMs = Date.now();
        // The map lives as long as the plugin: prune expired windows once the
        // table grows past a modest size so distinct source IPs (LAN clients,
        // brute-force scans) cannot accumulate forever.
        if (acceptAttempts.size > 256) {
            for (const [key, attempt] of acceptAttempts) {
                if (nowMs - attempt.windowStart > ACCEPT_WINDOW_MS)
                    acceptAttempts.delete(key);
            }
        }
        const entry = acceptAttempts.get(ip);
        if (entry === undefined || nowMs - entry.windowStart > ACCEPT_WINDOW_MS) {
            acceptAttempts.set(ip, { count: 1, windowStart: nowMs });
            return false;
        }
        entry.count += 1;
        return entry.count > ACCEPT_MAX_ATTEMPTS;
    };
    const handleIssue = async (req, res) => {
        if (!requireMethod(req, res, 'POST'))
            return;
        if (!loopbackFence(req)) {
            writeJson(res, 403, { ok: false, code: 'forbidden' });
            return;
        }
        const body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES, objectOnly: true });
        const payload = parsePairPayload(issuePayloadSchema, body);
        if (payload === undefined) {
            writeJson(res, 400, { ok: false, code: 'bad-payload' });
            return;
        }
        const { workspaceId, address } = payload;
        try {
            const { token, expiresAt } = service.issue(workspaceId, address);
            // The default base is the public (tunneled) URL when configured — a
            // phone anywhere can reach it — and the first LAN interface otherwise.
            // An explicit address always names a LAN literal.
            const base = address === undefined ? (service.publicBaseUrl ?? service.lanBaseUrl) : service.lanBaseUrlFor(address);
            if (base === undefined)
                throw new Error('remote-web-ui: base unavailable');
            writeJson(res, 200, {
                ok: true,
                // One bootstrap link for every device: the /api/pair/open hop
                // consumes the one-time token, sets the device cookie, and redirects
                // to the native launch-token URL so DSH 0.1.5's index auth mints the
                // browser cookie and serves the full Web GUI.
                url: `${base}/api/pair/open?token=${token}`,
                token,
                expiresAt,
                // Every constructible base, so a multi-homed panel can switch the
                // advertised network without a second round trip.
                lanAddresses: service.lanAddresses,
                // The configured public base, when present — the panel uses it to
                // label the QR as a public (tunneled) link.
                ...(service.publicBaseUrl !== undefined ? { publicBaseUrl: service.publicBaseUrl } : {}),
            });
        }
        catch (error) {
            // lan-required (no bind) and unknown-address are both configuration
            // mistakes the panel should surface distinctly.
            const unknownAddress = error instanceof UnknownLanAddressError;
            writeJson(res, unknownAddress ? 400 : 409, {
                ok: false,
                code: unknownAddress ? 'unknown-address' : 'lan-required',
            });
        }
    };
    const handleAccept = async (req, res) => {
        if (!requireMethod(req, res, 'POST'))
            return;
        if (!lanFence(req)) {
            writeJson(res, 403, { ok: false, code: 'forbidden' });
            return;
        }
        if (rateLimitAccept(req)) {
            writeJson(res, 429, { ok: false, code: 'rate-limited' });
            return;
        }
        const body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES, objectOnly: true });
        const payload = parsePairPayload(acceptPayloadSchema, body);
        if (payload === undefined) {
            writeJson(res, 400, { ok: false, code: 'bad-payload' });
            return;
        }
        const ua = req.headers['user-agent'];
        const result = service.accept(payload.token, typeof ua === 'string' ? ua : undefined);
        if (!result.ok) {
            writeJson(res, result.code === 'used' ? 409 : 404, { ok: false, code: result.code });
            return;
        }
        // No Secure attribute: LAN pairing runs over plain HTTP (the cookie must
        // work there), and the same cookie rides HTTPS on the tunnel. Lax keeps
        // top-level navigations working while blocking cross-site subrequests.
        writeJson(res, 200, { ok: true, deviceId: result.deviceId }, {
            'set-cookie': [deviceSessionCookie(service, result.deviceId)],
        });
    };
    /**
     * The QR bootstrap hop (GET /api/pair/open?token=…). A fresh phone opens
     * this: the one-time token is consumed, the device cookie is set, and the
     * browser is redirected to the native launch-token URL (`base/?token=…`) —
     * DSH 0.1.5's index auth exchange then mints the browser cookie and lands
     * the device on the full Web GUI with both credentials. A dead link with a
     * live paired cookie still re-opens the GUI (idempotent re-entry); with no
     * live cookie it is refused.
     */
    const handleOpen = (req, res) => {
        if (!requireMethod(req, res, 'GET'))
            return;
        if (!lanFence(req)) {
            writeText(res, 403, 'forbidden');
            return;
        }
        if (rateLimitAccept(req)) {
            writeText(res, 429, 'rate-limited');
            return;
        }
        const token = new URL(req.url ?? '/', 'http://dsh.invalid').searchParams.get('token') ?? '';
        const ua = req.headers['user-agent'];
        const result = service.accept(token, typeof ua === 'string' ? ua : undefined);
        const cookieId = result.ok ? result.deviceId : readCookie(req.headers.cookie, service.config.cookieName);
        const liveDevice = cookieId !== undefined && service.hasDevice(cookieId);
        if (!result.ok && !liveDevice) {
            writeText(res, 404, 'This pairing link is invalid, expired, or already used. Open a fresh link from the remote-control panel.');
            return;
        }
        const base = requestOriginBase(req, service);
        if (base === undefined) {
            writeText(res, 400, 'missing Host header');
            return;
        }
        res.writeHead(303, {
            'location': deps.authenticatedUrl(base),
            'cache-control': 'no-store',
            'set-cookie': [deviceSessionCookie(service, cookieId)],
        });
        res.end();
    };
    const handleStop = async (req, res) => {
        if (!requireMethod(req, res, 'POST'))
            return;
        if (!loopbackFence(req)) {
            writeJson(res, 403, { ok: false, code: 'forbidden' });
            return;
        }
        const body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES, objectOnly: true });
        if (parsePairPayload(pairActionPayloadSchema, body) === undefined) {
            writeJson(res, 400, { ok: false, code: 'bad-payload' });
            return;
        }
        service.stop();
        writeJson(res, 200, { ok: true });
    };
    const handleRevoke = async (req, res) => {
        if (!requireMethod(req, res, 'POST'))
            return;
        if (!loopbackFence(req)) {
            writeJson(res, 403, { ok: false, code: 'forbidden' });
            return;
        }
        const body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES, objectOnly: true });
        const payload = parsePairPayload(revokePayloadSchema, body);
        if (payload === undefined) {
            writeJson(res, 400, { ok: false, code: 'bad-payload' });
            return;
        }
        const revoked = service.revoke(payload.deviceId);
        if (!revoked) {
            writeJson(res, 404, { ok: false, code: 'unknown-device' });
            return;
        }
        writeJson(res, 200, { ok: true });
    };
    const handleHeartbeat = async (req, res) => {
        if (!requireMethod(req, res, 'POST'))
            return;
        if (!lanFence(req)) {
            writeJson(res, 403, { ok: false, code: 'forbidden' });
            return;
        }
        const body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES, objectOnly: true });
        if (parsePairPayload(pairActionPayloadSchema, body) === undefined) {
            writeJson(res, 400, { ok: false, code: 'bad-payload' });
            return;
        }
        const deviceId = readCookie(req.headers.cookie, service.config.cookieName);
        if (deviceId === undefined || !service.heartbeat(deviceId)) {
            writeJson(res, 401, { ok: false, code: 'unpaired' });
            return;
        }
        writeJson(res, 200, { ok: true });
    };
    const handleStatus = async (req, res) => {
        if (!requireMethod(req, res, 'GET'))
            return;
        if (!lanFence(req)) {
            writeJson(res, 403, { ok: false, code: 'forbidden' });
            return;
        }
        const deviceId = readCookie(req.headers.cookie, service.config.cookieName);
        const paired = deviceId !== undefined && service.hasDevice(deviceId);
        const snapshot = service.snapshot();
        // Unpaired LAN/tunnel clients get only the pairing-relevant fields; the
        // token expiry, public tunnel URL, and counts are an oracle for targeting
        // and stay behind a live device cookie. The per-device roster (ids are
        // session credentials) is never returned here — only the loopback events
        // stream carries it to the desktop panel.
        const { devices: _devices, ...rest } = snapshot;
        const visible = paired
            ? rest
            : { phase: snapshot.phase, lanAvailable: snapshot.lanAvailable, lanAddresses: snapshot.lanAddresses };
        writeJson(res, 200, { ok: true, paired, ...visible });
    };
    const handleEvents = (req, res) => {
        if (!requireMethod(req, res, 'GET'))
            return;
        if (!loopbackFence(req)) {
            writeJson(res, 403, { ok: false, code: 'forbidden' });
            return;
        }
        events.open(req, res);
        // Snapshot on open: a late-opening panel converges without history.
        events.push(service.snapshot());
    };
    return [
        { kind: 'exact', path: PAIR_PATHS.issue, handler: handleIssue },
        { kind: 'exact', path: PAIR_PATHS.accept, handler: handleAccept },
        { kind: 'exact', path: PAIR_PATHS.open, handler: handleOpen },
        { kind: 'exact', path: PAIR_PATHS.stop, handler: handleStop },
        { kind: 'exact', path: PAIR_PATHS.revoke, handler: handleRevoke },
        { kind: 'exact', path: PAIR_PATHS.heartbeat, handler: handleHeartbeat },
        { kind: 'exact', path: PAIR_PATHS.status, handler: handleStatus },
        { kind: 'exact', path: PAIR_PATHS.events, handler: handleEvents },
    ];
}
