import { dirname, isAbsolute, join } from "node:path";
import { setInterval, setTimeout as setTimeout$1 } from "node:timers";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "schemastery";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { Service } from "@deepseek-ai/cordis";
import { z as z$1 } from "zod";
import http, { request } from "node:http";
import { connect } from "node:net";
import { Tunnel, bin, install } from "cloudflared";
//#region src/pairing.ts
/**
* Pairing state machine: one active one-time token, a device-session table,
* and presence tracking. Pure TypeScript with injected clock/randomness so
* the whole security semantics are unit-testable without cordis. The
* cordis-facing surfaces (routes, the api/gate listener) live next door.
*
* Security invariants:
* - One active token at a time; `issue()` replaces it, so a refreshed QR
*   immediately invalidates the previous link.
* - A token is consumed by the first successful `accept()` — reuse is
*   refused with `'used'`.
* - Tokens expire; `accept()` on an expired token is refused like an
*   unknown one (no oracle for validity).
* - `stop()` revokes every device session and clears the token, so paired
*   devices are cut off on their next gated request.
* - `revoke()` drops one device session; idle sessions older than
*   `idleExpireMs` are deleted on sweep, load, and the next gated request.
*/
/** Default idle-expiry window: 7 days without heartbeat or a gated request. */
const DEFAULT_IDLE_EXPIRE_MS = 6048e5;
/** Cap on the persisted/displayed User-Agent string. */
const MAX_USER_AGENT_CHARS = 180;
/** Thrown by issue() for an address outside the sampled LAN literals. */
var UnknownLanAddressError = class extends Error {
	/**
	* @param address - the offending literal.
	*/
	constructor(address) {
		super(`remote-web-ui: unknown LAN address ${JSON.stringify(address)}`);
		this.name = "UnknownLanAddressError";
	}
};
/** Real clock/entropy: 32 random hex chars per token. */
const defaultClock = {
	now: () => Date.now(),
	randomToken: () => randomBytes(16).toString("hex")
};
/**
* The pairing state machine. Structural mutations issue/accept/stop/revoke
* and config updates (LAN bases, tunnel, posture) notify state listeners
* after the commit point that makes them true, and notification dedupes
* against the last emitted snapshot. Presence-only updates (touchDevice /
* heartbeat) just mark the store dirty and broadcast on the next sweep,
* which also surfaces time-driven transitions (a device aging offline)
* without any mutation.
*/
var PairingService = class {
	config;
	clock;
	tokens = /* @__PURE__ */ new Map();
	devices = /* @__PURE__ */ new Map();
	listeners = /* @__PURE__ */ new Set();
	lastEmitted;
	stopped = false;
	tokenSerial = 0;
	/** LAN base URLs keyed by the advertised IP literal (interface order). */
	lanBases = /* @__PURE__ */ new Map();
	/** Public (tunneled) base URL, e.g. a Cloudflare Tunnel quick URL. */
	publicBase;
	/** Auto-tunnel status, while the auto-tunnel feature is active. */
	tunnelStatus;
	posture;
	/** True when lastSeenAt changed since the last persist (flushed on sweep). */
	dirty = false;
	/**
	* @param config - tunables. The settings surface replaces the object (a
	* fresh literal) when a committed section changes; every operation reads
	* the current one.
	* @param clock - clock/entropy source (injectable for tests).
	*/
	constructor(config, clock = defaultClock) {
		this.config = config;
		this.clock = clock;
		this.loadPersisted();
	}
	/**
	* Restore device sessions persisted by a previous process run. A corrupt
	* or missing file is tolerated (an empty device table, never a throw) —
	* persistence is an availability convenience, not a security boundary.
	*/
	loadPersisted() {
		const file = this.config.devicesFile;
		if (file === void 0) return;
		try {
			const saved = JSON.parse(readFileSync(file, "utf8"));
			if (typeof saved !== "object" || saved === null) return;
			for (const [deviceId, session] of Object.entries(saved)) {
				if (typeof deviceId !== "string") continue;
				if (typeof session !== "object" || session === null) continue;
				const { createdAt, lastSeenAt, userAgent } = session;
				if (typeof createdAt !== "number" || typeof lastSeenAt !== "number") continue;
				const label = typeof userAgent === "string" ? sanitizeUserAgent(userAgent) : void 0;
				this.devices.set(deviceId, {
					createdAt,
					lastSeenAt,
					...label !== void 0 ? { userAgent: label } : {}
				});
			}
			this.clampToMaxDevices();
			if (this.evictIdle()) this.persist();
		} catch {}
	}
	/** FIFO-cap the device table (a persisted file may outlive a lowered cap). */
	clampToMaxDevices() {
		if (this.devices.size <= this.config.maxDevices) return;
		const overflow = this.devices.size - this.config.maxDevices;
		const ordered = [...this.devices.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
		for (const [id] of ordered.slice(0, overflow)) this.devices.delete(id);
	}
	/** Drop sessions whose lastSeenAt is older than idleExpireMs. */
	evictIdle() {
		const now = this.clock.now();
		const limit = this.config.idleExpireMs ?? 6048e5;
		let removed = false;
		for (const [id, session] of [...this.devices]) if (now - session.lastSeenAt > limit) {
			this.devices.delete(id);
			removed = true;
		}
		return removed;
	}
	/**
	* Write the current device table to the configured file. Called on the
	* mutation boundaries that change the set of live sessions (accept, stop,
	* revoke, idle eviction) and, throttled, from sweep() so lastSeenAt
	* survives a restart without a write per request.
	*
	* Device ids are session credentials (the gate authorizes requests by the
	* cookie's device id), so the file is written 0600 via a temp file and
	* atomic rename; a crash mid-write can never leave a half-written store.
	*/
	persist() {
		const file = this.config.devicesFile;
		if (file === void 0) return;
		try {
			mkdirSync(dirname(file), { recursive: true });
			const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
			const payload = {};
			for (const [id, session] of this.devices) payload[id] = session;
			writeFileSync(temp, JSON.stringify(payload), { mode: 384 });
			renameSync(temp, file);
			this.dirty = false;
		} catch (error) {
			console.error("remote-web-ui: failed to persist paired devices", error);
		}
	}
	/** The default LAN base URL (the first interface; undefined when not LAN-reachable). */
	get lanBaseUrl() {
		return this.lanBases.values().next().value;
	}
	/** The LAN base URL for one specific literal (undefined when not constructible). */
	lanBaseUrlFor(address) {
		return this.lanBases.get(address);
	}
	/** The LAN IP literals QR links can be built from (interface order). */
	get lanAddresses() {
		return [...this.lanBases.keys()];
	}
	/** Set the LAN base URLs once the server bind is known (interface order). */
	setLanBases(entries) {
		this.lanBases = new Map(entries.map((entry) => [entry.address, entry.base]));
		this.notify();
	}
	/** The configured public (tunneled) base URL, when present. */
	get publicBaseUrl() {
		return this.publicBase;
	}
	/** Set or clear the public base URL (a tunnel in front of this server). */
	setPublicBaseUrl(url) {
		this.publicBase = url;
		this.notify();
	}
	/** Set or clear the auto-tunnel status frame (undefined when the feature is off). */
	setTunnelStatus(status) {
		this.tunnelStatus = status;
		this.notify();
	}
	/** Set the latest /api posture probe result (see posture.ts). */
	setPosture(snapshot) {
		this.posture = snapshot;
		this.notify();
	}
	/**
	* Issue a fresh token, replacing (invalidating) any previous one. A
	* stopped service re-arms through this call (the panel's refresh button).
	* @param workspaceId - optional workspace the QR link should land in.
	* @param address - optional LAN IP literal the QR must be built from; the
	* default is the public base (when configured) or the first interface.
	* Unknown addresses are refused.
	* @returns the token secret and its expiry.
	* @throws {Error} when no reachable base exists (no all-interfaces bind and
	* no public base) — callers surface this as the lan-required state instead
	* of minting an unusable QR.
	*/
	issue(workspaceId, address) {
		if (this.lanBases.size === 0 && this.publicBase === void 0) throw new Error("remote-web-ui: pairing requires a reachable bind (--host 0.0.0.0 or publicBaseUrl)");
		if (address !== void 0 && !this.lanBases.has(address)) throw new UnknownLanAddressError(address);
		const now = this.clock.now();
		const token = this.clock.randomToken();
		this.tokens.clear();
		this.stopped = false;
		this.tokenSerial += 1;
		this.tokens.set(token, {
			id: `t${this.tokenSerial}`,
			issuedAt: now,
			expiresAt: now + this.config.tokenTtlMs,
			consumed: false,
			...workspaceId !== void 0 ? { workspaceId } : {},
			...address !== void 0 ? { address } : {}
		});
		this.notify();
		return {
			token,
			expiresAt: now + this.config.tokenTtlMs
		};
	}
	/**
	* Consume a token and bind a device session. One-time: the second
	* successful call for the same token is impossible because the first
	* consumes it.
	* @param token - the token secret from the QR link.
	* @param userAgent - optional User-Agent header captured at accept.
	* @returns the new device id, or a refusal code.
	*/
	accept(token, userAgent) {
		const record = this.tokens.get(token);
		if (record === void 0 || record.consumed || this.stopped || this.clock.now() > record.expiresAt) return {
			ok: false,
			code: record?.consumed === true ? "used" : "invalid"
		};
		record.consumed = true;
		const deviceId = this.clock.randomToken();
		const now = this.clock.now();
		if (this.devices.size >= this.config.maxDevices) {
			let oldest;
			for (const [id, session] of this.devices) if (oldest === void 0 || session.createdAt < oldest.createdAt) oldest = {
				id,
				createdAt: session.createdAt
			};
			if (oldest !== void 0) this.devices.delete(oldest.id);
		}
		const label = sanitizeUserAgent(userAgent);
		this.devices.set(deviceId, {
			createdAt: now,
			lastSeenAt: now,
			...label !== void 0 ? { userAgent: label } : {}
		});
		this.persist();
		this.notify();
		return {
			ok: true,
			deviceId
		};
	}
	/**
	* Stop remote control: revoke every device session and clear the token.
	* The phone's next gated /api request 403s; the panel falls back to
	* stopped until a fresh QR is issued.
	*/
	stop() {
		this.tokens.clear();
		this.devices.clear();
		this.persist();
		this.stopped = true;
		this.notify();
	}
	/**
	* Revoke one paired device. The next gated request from that cookie is
	* refused; other sessions stay live. Unknown ids are a no-op.
	* @param deviceId - the cookie value of the device to drop.
	* @returns true when a live session was removed.
	*/
	revoke(deviceId) {
		if (this.stopped) return false;
		if (!this.devices.delete(deviceId)) return false;
		this.persist();
		this.notify();
		return true;
	}
	/**
	* The api/gate path: record activity for a device id and report whether
	* the request may proceed. Unknown or revoked ids (including any device
	* after stop() or idle expiry) are refused.
	*
	* Presence refreshes are throttled on purpose: every gated request (and
	* the remote-channel keepalives) lands here, so a broadcast per call would
	* fan a full snapshot out to every status stream on the hot path. The refresh
	* only updates lastSeenAt and marks the store dirty; the snapshot reaches
	* listeners at the next sweep() (structural changes notify immediately).
	* @param deviceId - the cookie value of the requesting device.
	* @returns true when the device session is live and was refreshed.
	*/
	touchDevice(deviceId) {
		const session = this.liveSession(deviceId);
		if (session === void 0) return false;
		session.lastSeenAt = this.clock.now();
		this.dirty = true;
		return true;
	}
	/** Explicit presence heartbeat (the phone's client sends these). */
	heartbeat(deviceId) {
		return this.touchDevice(deviceId);
	}
	/**
	* Periodic sweep: drop idle sessions, flush a dirty lastSeenAt, and
	* re-evaluate the derived snapshot (a device aging past the offline
	* window flips the phase to disconnected). Emits only when the snapshot
	* actually changed.
	*/
	sweep() {
		if (this.evictIdle() || this.dirty) this.persist();
		this.notify();
	}
	/** The current snapshot (fresh object per call — stable between emits). */
	snapshot() {
		const now = this.clock.now();
		const devices = [...this.devices.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt).map(([id, session]) => this.toDeviceSnapshot(id, session, now));
		const onlineCount = devices.filter((device) => device.online).length;
		const token = this.activeToken();
		return {
			phase: this.derivePhase(onlineCount, token !== void 0),
			lanAvailable: this.lanBases.size > 0,
			lanAddresses: [...this.lanBases.keys()],
			...this.publicBase !== void 0 ? { publicUrl: this.publicBase } : {},
			...this.tunnelStatus !== void 0 ? { tunnel: this.tunnelStatus } : {},
			...this.posture !== void 0 ? { posture: this.posture } : {},
			...token !== void 0 ? {
				tokenId: token.record.id,
				tokenExpiresAt: token.record.expiresAt
			} : {},
			deviceCount: this.devices.size,
			onlineCount,
			devices
		};
	}
	/** Whether a cookie value names a currently live (non-idle) device session. */
	hasDevice(deviceId) {
		return this.liveSession(deviceId) !== void 0;
	}
	/** Subscribe to snapshot changes (each emit passes a fresh snapshot). */
	onState(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	activeToken() {
		for (const [token, record] of this.tokens) {
			if (this.stopped) return void 0;
			if (this.clock.now() > record.expiresAt) continue;
			return {
				token,
				record
			};
		}
	}
	/**
	* Return a live session, deleting it first when idle-expired. Side-effecting
	* so a stale cookie cannot pass the gate between sweeps.
	*/
	liveSession(deviceId) {
		if (this.stopped) return void 0;
		const session = this.devices.get(deviceId);
		if (session === void 0) return void 0;
		const limit = this.config.idleExpireMs ?? 6048e5;
		if (this.clock.now() - session.lastSeenAt > limit) {
			this.devices.delete(deviceId);
			this.persist();
			this.notify();
			return;
		}
		return session;
	}
	toDeviceSnapshot(id, session, now) {
		return {
			id,
			createdAt: session.createdAt,
			lastSeenAt: session.lastSeenAt,
			online: this.isOnlineAt(session, now),
			...session.userAgent !== void 0 ? { userAgent: session.userAgent } : {}
		};
	}
	derivePhase(onlineCount, hasToken) {
		if (this.lanBases.size === 0 && this.publicBase === void 0) return "lan-required";
		if (this.stopped) return "stopped";
		if (onlineCount > 0) return "connected";
		if (this.devices.size > 0) return "disconnected";
		if (hasToken) return "waiting";
		return "stopped";
	}
	isOnlineAt(session, now) {
		return now - session.lastSeenAt <= this.config.offlineAfterMs;
	}
	notify() {
		const snapshot = this.snapshot();
		if (this.lastEmitted !== void 0 && snapshotsEqual(this.lastEmitted, snapshot)) return;
		this.lastEmitted = snapshot;
		for (const listener of this.listeners) try {
			listener(snapshot);
		} catch (error) {
			console.error("remote-web-ui: pairing state listener failed", error);
		}
	}
};
/** Structural equality over the snapshot's wire fields. */
function snapshotsEqual(a, b) {
	return a.phase === b.phase && a.lanAvailable === b.lanAvailable && sameStrings(a.lanAddresses, b.lanAddresses) && a.publicUrl === b.publicUrl && tunnelEqual(a.tunnel, b.tunnel) && a.tokenId === b.tokenId && a.tokenExpiresAt === b.tokenExpiresAt && a.deviceCount === b.deviceCount && a.onlineCount === b.onlineCount && devicesEqual(a.devices, b.devices);
}
/** Per-device roster equality (order is pairing time). */
function devicesEqual(a, b) {
	return a.length === b.length && a.every((device, index) => {
		const other = b[index];
		return other !== void 0 && device.id === other.id && device.createdAt === other.createdAt && device.lastSeenAt === other.lastSeenAt && device.online === other.online && device.userAgent === other.userAgent;
	});
}
/** Tunnel frame equality (undefined equals undefined; fields compared shallowly). */
function tunnelEqual(a, b) {
	return a === b || a !== void 0 && b !== void 0 && a.state === b.state && a.url === b.url && a.error === b.error;
}
/** Element-wise string list equality (interface order is meaningful). */
function sameStrings(a, b) {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}
/** Strip control characters and cap the User-Agent stored with a session. */
function sanitizeUserAgent(raw) {
	if (raw === void 0) return void 0;
	const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
	if (cleaned === "") return void 0;
	return cleaned.length <= MAX_USER_AGENT_CHARS ? cleaned : cleaned.slice(0, MAX_USER_AGENT_CHARS);
}
//#endregion
//#region src/dsh-home.ts
/**
* DSH_HOME resolution shared by the plugin family's Host halves: the
* environment override wins, the platform home fallback follows. Mirrors
* what dsh-pet and dsh-liangshen each used to implement locally.
*/
/** Expand a leading ~ (or ~user) in a path, platform-style. */
function expandHome(path, home = homedir()) {
	if (path === "~") return home;
	if (path.startsWith("~/") || path.startsWith("~\\")) return join(home, path.slice(2));
	return path;
}
/**
* Resolve the DSH home directory.
* @param env - process environment to read DSH_HOME from.
* @param home - platform home directory fallback (test seam).
* @returns the absolute DSH home path.
*/
function resolveDshHome(env = process.env, home = homedir()) {
	const raw = env.DSH_HOME;
	if (raw !== void 0 && raw.trim() !== "") {
		const expanded = expandHome(raw.trim(), home);
		return isAbsolute(expanded) ? expanded : join(process.cwd(), expanded);
	}
	return join(home, ".dsh");
}
/** Resolve the DSH home directory from the live environment. */
function dshHome() {
	return resolveDshHome();
}
//#endregion
//#region src/loopback.ts
/** IPv4 127/8 predicate (four decimal octets, first == 127). */
function isIPv4Loopback(v4) {
	const parts = v4.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/** Whether a socket remote address names the loopback range (127/8, ::1, IPv4-mapped). */
function isLoopbackAddress(address) {
	if (address === void 0) return false;
	const normalized = address.toLowerCase();
	if (normalized === "::1") return true;
	if (normalized.startsWith("::ffff:")) return isIPv4Loopback(normalized.slice(7));
	return isIPv4Loopback(normalized);
}
/** Whether a normalized URL hostname names the loopback authority (localhost, [::1], 127/8). */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	return isIPv4Loopback(hostname);
}
//#endregion
//#region src/gate.ts
/**
* Loopback classification for the desktop client. The predicates now live in
* the shared synced copy (shared/host/loopback.ts, mirrored to ./loopback.ts
* by scripts/sync-shared.mjs): localhost, IPv6 loopback, and any IPv4 address
* in 127/8.
* @param hostname - WHATWG URL hostname (IPv6 literals retain brackets).
* @returns true for localhost, IPv6 loopback, or any IPv4 address in 127/8.
*/
/**
* Read one cookie value from a Cookie header.
* @param header - the raw Cookie header value (or undefined).
* @param name - the cookie name.
* @returns the value, or undefined when absent.
*/
function readCookie(header, name) {
	if (header === void 0) return void 0;
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq < 0) continue;
		if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
	}
}
/**
* The effective Host hostname of a request.
* @param request - node HTTP request.
* @returns the normalized hostname, or undefined when unparsable.
*/
function hostnameOf(request) {
	const host = request.headers.host;
	if (typeof host !== "string") return void 0;
	try {
		return new URL(`http://${host}`).hostname;
	} catch {
		return;
	}
}
/** Whether a request comes from the desktop loopback client (loopback socket AND loopback Host). */
function isLoopbackClient(request) {
	const hostname = hostnameOf(request);
	if (hostname === void 0 || !isLoopbackHostname(hostname)) return false;
	const socket = request.socket;
	return isLoopbackAddress(socket?.remoteAddress);
}
/**
* Build the api/gate listener for one pairing service.
* @param service - the pairing service.
* @param requirePairingForLan - when false, non-loopback requests pass
* without a device cookie (the feature then only manages tokens/status;
* revocation of paired devices still holds). A function is re-read per
* request, so a settings edit takes effect without a restart. Defaults to true.
* @param enabled - when false, every non-loopback request is vetoed while
* loopback stays available. A function is re-read per request so the fence
* stays mounted for the plugin lifetime and disabling the plugin cannot open
* a LAN-exposed /api. Defaults to true.
* @returns the cordis waterfall listener: call `next()` to delegate,
* return false (without calling it) to veto with 403.
*/
function makeGateListener(service, requirePairingForLan = true, enabled = true) {
	return (request, _method, next) => {
		if (isLoopbackClient(request)) return next();
		if (!(typeof enabled === "function" ? enabled() : enabled)) return false;
		if (!(typeof requirePairingForLan === "function" ? requirePairingForLan() : requirePairingForLan)) return next();
		return isPairedDeviceRequest(service, request) ? next() : false;
	};
}
/**
* Whether a request carries a live, non-revoked paired-device cookie for
* this service. Sibling host routes outside /api (aionui-panel, etc.) use
* the same check via the remoteWebUiPairing service.
* @param service - the pairing service that owns the device table.
* @param request - the incoming HTTP request.
* @returns true when the cookie names a live session (and lastSeenAt was refreshed).
*/
function isPairedDeviceRequest(service, request) {
	const deviceId = readCookie(request.headers.cookie, service.config.cookieName);
	if (deviceId === void 0) return false;
	return service.touchDevice(deviceId);
}
//#endregion
//#region src/pairing-access.ts
/** Named lookup key sibling plugins pass to ctx.get. */
const REMOTE_WEB_UI_PAIRING = "remoteWebUiPairing";
/**
* Pairing identity for one HTTP request. Structural: consumers must not
* import this class, only the method shape.
*/
var RemoteWebUiPairing = class extends Service {
	check;
	/**
	* @param ctx - host plugin context.
	* @param check - live cookie + session predicate (re-read per request).
	*/
	constructor(ctx, check) {
		super(ctx, REMOTE_WEB_UI_PAIRING);
		this.check = check;
	}
	/**
	* Whether the request carries a live paired-device cookie.
	* @param request - the incoming HTTP request.
	* @returns true when the session is live and was refreshed.
	*/
	isPairedDevice(request) {
		return this.check(request);
	}
};
//#endregion
//#region src/http.ts
/** Default body cap for readJsonBody: 64 KiB. */
const DEFAULT_JSON_BODY_MAX_BYTES = 65536;
/** Family-default JSON response headers; callers may append or override. */
const JSON_HEADERS = {
	"content-type": "application/json; charset=utf-8",
	"referrer-policy": "no-referrer"
};
/**
* Strict bounded body reader: parse a request body of at most maxBytes as
* JSON.
* @throws 'body too large' past the cap, or the JSON.parse error for an
*   invalid or empty payload.
*/
async function readBoundedJson(req, maxBytes) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		size += buffer.length;
		if (size > maxBytes) throw new Error("body too large");
		chunks.push(buffer);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
/**
* Lenient bounded body reader: parse a request body as JSON, or null on an
* empty body, invalid JSON, or a body past maxBytes (default 64 KiB).
* Overflow destroys the request instead of draining the remainder (no drain
* call, matching the current repo-wide behavior); callers must not keep
* reading the request afterwards. With objectOnly, non-JSON-object payloads
* also yield null.
*/
async function readJsonBody(req, opts = {}) {
	const maxBytes = opts.maxBytes ?? DEFAULT_JSON_BODY_MAX_BYTES;
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		size += buffer.length;
		if (size > maxBytes) {
			req.destroy();
			return null;
		}
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text === "") return null;
	try {
		const parsed = JSON.parse(text);
		if (opts.objectOnly && !isJsonObject(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}
/** Whether a value is a JSON object: typeof object, not null, not an array. */
function isJsonObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Write one JSON response. Default headers are the family defaults
* (content-type and referrer-policy); caller headers are appended or
* override them.
*/
function writeJson(res, status, body, headers = {}) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		...JSON_HEADERS,
		...headers
	});
	res.end(payload);
}
//#endregion
//#region src/routes.ts
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
function isTrustedApiRequest(request, trustedHosts) {
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	const hostname = hostUrl.hostname;
	if (!(isLoopbackClient(request) || trustedHosts.some((entry) => {
		const entryUrl = new URL(`http://${entry}`);
		return entryUrl.port === "" ? entryUrl.hostname === hostname : entryUrl.host === hostUrl.host;
	}))) return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
/** Cap on pairing request bodies (tokens and workspace ids are tiny). */
const MAX_BODY_BYTES$1 = 4096;
/**
* The host authority of a configured public base URL, e.g. `foo.trycloudflare.com`
* from `https://foo.trycloudflare.com`. Undefined when the URL does not parse —
* a malformed config then simply contributes no fence entry (and the panel
* falls back to LAN-only URLs).
* @param url - the configured public base URL (or undefined).
* @returns the `host[:port]` authority the fence should trust.
*/
function publicHostOf(url) {
	if (url === void 0) return void 0;
	try {
		return new URL(url).host;
	} catch {
		return;
	}
}
/** Cookie lifetime: one year; revoked sessions die at the gate regardless. */
const COOKIE_MAX_AGE_SEC = 31536e3;
/** Route paths (exact matches under /api). */
const PAIR_PATHS = {
	issue: "/api/pair/issue",
	accept: "/api/pair/accept",
	stop: "/api/pair/stop",
	revoke: "/api/pair/revoke",
	heartbeat: "/api/pair/heartbeat",
	status: "/api/pair/status",
	events: "/api/pair/events"
};
/**
* /api/pair request payload contracts. Each POST endpoint validates its body
* against one of these instead of reaching into a hand-parsed object: the
* control-plane endpoints that carry no meaningful payload use the permissive
* pairActionPayloadSchema so their smoke calls keep working unchanged, while
* issue/accept enforce their optional/required fields. Unknown (extra) keys
* are tolerated exactly as the previous manual reads ignored them.
*/
const issuePayloadSchema = z$1.object({
	workspaceId: z$1.string().min(1).optional(),
	address: z$1.string().min(1).optional()
});
const acceptPayloadSchema = z$1.object({ token: z$1.string().default("") });
const revokePayloadSchema = z$1.object({ deviceId: z$1.string().min(1) });
const pairActionPayloadSchema = z$1.object({}).passthrough();
/**
* Parse a pair request body through schema. A missing/empty, unparseable
* or non-object body (shared readJsonBody with objectOnly yields null for
* all of them) is treated as an empty object — the desktop stop/heartbeat
* send no body — and a value that fails the schema returns `undefined` so
* the caller can answer with the existing error shape.
*/
function parsePairPayload(schema, body) {
	const result = schema.safeParse(body ?? {});
	return result.success ? result.data : void 0;
}
/** The SSE fan-out for desktop panel status. */
var PairingEventsStream = class {
	streams = /* @__PURE__ */ new Set();
	/**
	* @param service - the pairing service whose snapshots are fanned out.
	*/
	constructor(service) {
		service.onState((snapshot) => {
			this.push(snapshot);
		});
	}
	/** Open one stream; the response is owned to completion. */
	open(req, res) {
		res.writeHead(200, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache",
			connection: "keep-alive"
		});
		const stream = {
			res,
			closed: false
		};
		this.streams.add(stream);
		const close = () => {
			if (stream.closed) return;
			stream.closed = true;
			this.streams.delete(stream);
		};
		res.on("close", close);
		req.on("close", close);
	}
	/** Push one frame to every open stream (contained per stream). */
	push(snapshot) {
		const frame = `data: ${JSON.stringify({
			type: "state",
			...snapshot
		})}\n\n`;
		for (const stream of this.streams) try {
			stream.res.write(frame);
		} catch {
			stream.closed = true;
			this.streams.delete(stream);
		}
	}
	/** Stream count (tests/diagnostics). */
	get size() {
		return this.streams.size;
	}
};
/**
* Build the /api/pair route family.
* @param deps - service + fence inputs.
* @returns the exact routes to register on webServer.
*/
function makeRoutes(deps) {
	const { service, lanAddresses, requirePairingForLan = true } = deps;
	const pairingRequired = () => typeof requirePairingForLan === "function" ? requirePairingForLan() : requirePairingForLan;
	const events = new PairingEventsStream(service);
	/** Loopback-only fence: the desktop panel's control endpoints. */
	const loopbackFence = (req) => isTrustedApiRequest(req, []);
	/** Phone-facing fence: loopback, the derived LAN literals, or the configured public host. */
	const lanFence = (req) => {
		const publicHost = publicHostOf(service.publicBaseUrl);
		return isTrustedApiRequest(req, publicHost === void 0 ? lanAddresses : [...lanAddresses, publicHost]);
	};
	const requireMethod = (req, res, method) => {
		if (req.method === method) return true;
		res.writeHead(405);
		res.end();
		return false;
	};
	/** Per-source-IP accept rate limit (brute-force defense in depth). */
	const acceptAttempts = /* @__PURE__ */ new Map();
	const ACCEPT_MAX_ATTEMPTS = 10;
	const ACCEPT_WINDOW_MS = 3e4;
	const rateLimitAccept = (req) => {
		const socketIp = req.socket?.remoteAddress ?? "unknown";
		const forwarded = typeof req.headers["x-forwarded-for"] === "string" ? (req.headers["x-forwarded-for"].split(",")[0] ?? "").trim() : void 0;
		const ip = forwarded === void 0 || forwarded === "" ? socketIp : socketIp + "|" + forwarded;
		const nowMs = Date.now();
		if (acceptAttempts.size > 256) {
			for (const [key, attempt] of acceptAttempts) if (nowMs - attempt.windowStart > ACCEPT_WINDOW_MS) acceptAttempts.delete(key);
		}
		const entry = acceptAttempts.get(ip);
		if (entry === void 0 || nowMs - entry.windowStart > ACCEPT_WINDOW_MS) {
			acceptAttempts.set(ip, {
				count: 1,
				windowStart: nowMs
			});
			return false;
		}
		entry.count += 1;
		return entry.count > ACCEPT_MAX_ATTEMPTS;
	};
	const handleIssue = async (req, res) => {
		if (!requireMethod(req, res, "POST")) return;
		if (!loopbackFence(req)) {
			writeJson(res, 403, {
				ok: false,
				code: "forbidden"
			});
			return;
		}
		const body = await readJsonBody(req, {
			maxBytes: MAX_BODY_BYTES$1,
			objectOnly: true
		});
		const payload = parsePairPayload(issuePayloadSchema, body);
		if (payload === void 0) {
			writeJson(res, 400, {
				ok: false,
				code: "bad-payload"
			});
			return;
		}
		const { workspaceId, address } = payload;
		try {
			const { token, expiresAt } = service.issue(workspaceId, address);
			const base = address === void 0 ? service.publicBaseUrl ?? service.lanBaseUrl : service.lanBaseUrlFor(address);
			if (base === void 0) throw new Error("remote-web-ui: base unavailable");
			writeJson(res, 200, {
				ok: true,
				url: `${base}/?pair=${token}${workspaceId === void 0 ? "" : `&workspace=${encodeURIComponent(workspaceId)}`}`,
				token,
				expiresAt,
				lanAddresses: service.lanAddresses,
				...service.publicBaseUrl !== void 0 ? { publicBaseUrl: service.publicBaseUrl } : {}
			});
		} catch (error) {
			const unknownAddress = error instanceof UnknownLanAddressError;
			writeJson(res, unknownAddress ? 400 : 409, {
				ok: false,
				code: unknownAddress ? "unknown-address" : "lan-required"
			});
		}
	};
	const handleAccept = async (req, res) => {
		if (!requireMethod(req, res, "POST")) return;
		if (!lanFence(req)) {
			writeJson(res, 403, {
				ok: false,
				code: "forbidden"
			});
			return;
		}
		if (rateLimitAccept(req)) {
			writeJson(res, 429, {
				ok: false,
				code: "rate-limited"
			});
			return;
		}
		const body = await readJsonBody(req, {
			maxBytes: MAX_BODY_BYTES$1,
			objectOnly: true
		});
		const payload = parsePairPayload(acceptPayloadSchema, body);
		if (payload === void 0) {
			writeJson(res, 400, {
				ok: false,
				code: "bad-payload"
			});
			return;
		}
		const ua = req.headers["user-agent"];
		const result = service.accept(payload.token, typeof ua === "string" ? ua : void 0);
		if (!result.ok) {
			writeJson(res, result.code === "used" ? 409 : 404, {
				ok: false,
				code: result.code
			});
			return;
		}
		writeJson(res, 200, {
			ok: true,
			deviceId: result.deviceId
		}, { "set-cookie": [`${service.config.cookieName}=${result.deviceId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(COOKIE_MAX_AGE_SEC)}`] });
	};
	const handleStop = async (req, res) => {
		if (!requireMethod(req, res, "POST")) return;
		if (!loopbackFence(req)) {
			writeJson(res, 403, {
				ok: false,
				code: "forbidden"
			});
			return;
		}
		const body = await readJsonBody(req, {
			maxBytes: MAX_BODY_BYTES$1,
			objectOnly: true
		});
		if (parsePairPayload(pairActionPayloadSchema, body) === void 0) {
			writeJson(res, 400, {
				ok: false,
				code: "bad-payload"
			});
			return;
		}
		service.stop();
		writeJson(res, 200, { ok: true });
	};
	const handleRevoke = async (req, res) => {
		if (!requireMethod(req, res, "POST")) return;
		if (!loopbackFence(req)) {
			writeJson(res, 403, {
				ok: false,
				code: "forbidden"
			});
			return;
		}
		const body = await readJsonBody(req, {
			maxBytes: MAX_BODY_BYTES$1,
			objectOnly: true
		});
		const payload = parsePairPayload(revokePayloadSchema, body);
		if (payload === void 0) {
			writeJson(res, 400, {
				ok: false,
				code: "bad-payload"
			});
			return;
		}
		if (!service.revoke(payload.deviceId)) {
			writeJson(res, 404, {
				ok: false,
				code: "unknown-device"
			});
			return;
		}
		writeJson(res, 200, { ok: true });
	};
	const handleHeartbeat = async (req, res) => {
		if (!requireMethod(req, res, "POST")) return;
		if (!lanFence(req)) {
			writeJson(res, 403, {
				ok: false,
				code: "forbidden"
			});
			return;
		}
		const body = await readJsonBody(req, {
			maxBytes: MAX_BODY_BYTES$1,
			objectOnly: true
		});
		if (parsePairPayload(pairActionPayloadSchema, body) === void 0) {
			writeJson(res, 400, {
				ok: false,
				code: "bad-payload"
			});
			return;
		}
		const deviceId = readCookie(req.headers.cookie, service.config.cookieName);
		if (deviceId === void 0 || !service.heartbeat(deviceId)) {
			writeJson(res, 401, {
				ok: false,
				code: "unpaired"
			});
			return;
		}
		writeJson(res, 200, { ok: true });
	};
	const handleStatus = async (req, res) => {
		if (!requireMethod(req, res, "GET")) return;
		if (!lanFence(req)) {
			writeJson(res, 403, {
				ok: false,
				code: "forbidden"
			});
			return;
		}
		const deviceId = readCookie(req.headers.cookie, service.config.cookieName);
		const paired = deviceId !== void 0 && service.hasDevice(deviceId);
		const snapshot = service.snapshot();
		const { devices: _devices, ...rest } = snapshot;
		const visible = paired ? rest : {
			phase: snapshot.phase,
			lanAvailable: snapshot.lanAvailable,
			lanAddresses: snapshot.lanAddresses
		};
		writeJson(res, 200, {
			ok: true,
			paired,
			requirePairingForLan: pairingRequired(),
			...visible
		});
	};
	const handleEvents = (req, res) => {
		if (!requireMethod(req, res, "GET")) return;
		if (!loopbackFence(req)) {
			writeJson(res, 403, {
				ok: false,
				code: "forbidden"
			});
			return;
		}
		events.open(req, res);
		events.push(service.snapshot());
	};
	return [
		{
			kind: "exact",
			path: PAIR_PATHS.issue,
			handler: handleIssue
		},
		{
			kind: "exact",
			path: PAIR_PATHS.accept,
			handler: handleAccept
		},
		{
			kind: "exact",
			path: PAIR_PATHS.stop,
			handler: handleStop
		},
		{
			kind: "exact",
			path: PAIR_PATHS.revoke,
			handler: handleRevoke
		},
		{
			kind: "exact",
			path: PAIR_PATHS.heartbeat,
			handler: handleHeartbeat
		},
		{
			kind: "exact",
			path: PAIR_PATHS.status,
			handler: handleStatus
		},
		{
			kind: "exact",
			path: PAIR_PATHS.events,
			handler: handleEvents
		}
	];
}
//#endregion
//#region src/paired-model-catalog.ts
const MAX_BODY_BYTES = 16384;
const MAX_IDENTIFIER_LENGTH = 160;
const MAX_DISPLAY_NAME_LENGTH = 240;
const MAX_TOKEN_LIMIT = 1e7;
const REASONING_EFFORTS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
const stringField = (max) => z$1.string().trim().min(1).max(max).refine((value) => !/[\r\n\0]/.test(value), "must not contain a newline or NUL");
const providerSchema = z$1.object({ provider: stringField(MAX_IDENTIFIER_LENGTH) }).strict();
const modelSchema = z$1.object({
	id: stringField(MAX_IDENTIFIER_LENGTH),
	name: stringField(MAX_DISPLAY_NAME_LENGTH).optional(),
	contextWindow: z$1.number().int().safe().positive().max(MAX_TOKEN_LIMIT).optional(),
	maxTokens: z$1.number().int().safe().positive().max(MAX_TOKEN_LIMIT).optional(),
	reasoningEfforts: z$1.array(z$1.enum(REASONING_EFFORTS)).min(1).refine((efforts) => efforts.every((effort, index) => index === 0 || REASONING_EFFORTS.indexOf(efforts[index - 1]) < REASONING_EFFORTS.indexOf(effort)), "reasoning efforts must be unique and in canonical order").optional()
}).strict();
const upsertSchema = z$1.object({
	provider: stringField(MAX_IDENTIFIER_LENGTH),
	model: modelSchema
}).strict();
const PAIRED_MODEL_CATALOG_PATHS = {
	catalog: "/api/pair/model-catalog",
	discover: "/api/pair/model-catalog/discover",
	upsert: "/api/pair/model-catalog/upsert"
};
let rpcSequence = 0;
function request$1(payload) {
	rpcSequence += 1;
	return {
		rpcId: `paired-model-catalog-${Date.now().toString(36)}-${rpcSequence.toString(36)}`,
		payload
	};
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function valueOf(response) {
	return response.result.ok ? response.result.value : void 0;
}
function errorCode(response) {
	return response.result.ok ? void 0 : response.result.error.code;
}
function reject(res, status, error) {
	writeJson(res, status, { error });
}
function publicProviderId(value) {
	const normalized = value.replace(/[\r\n\0]/g, " ").trim().slice(0, MAX_IDENTIFIER_LENGTH);
	return normalized === "" ? "unknown" : normalized;
}
function publicCatalog(value) {
	return {
		groups: value.groups.map((group) => ({
			id: group.id,
			name: group.name,
			models: group.models.map((model) => ({
				id: model.id,
				name: model.name,
				...model.description === void 0 ? {} : { description: model.description },
				...model.reasoning === void 0 ? {} : { reasoning: model.reasoning }
			}))
		})),
		failures: value.failures.map((failure) => ({
			id: failure.id,
			name: failure.name,
			message: `model catalog unavailable for provider ${publicProviderId(failure.id)}`
		}))
	};
}
function publicCandidates(models) {
	return models.map((model) => ({
		id: model.id,
		...model.name === void 0 ? {} : { name: model.name },
		...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
		...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens }
	}));
}
function fieldsOf(model, includeId) {
	const fields = {
		...includeId ? { id: model.id } : {},
		...model.name === void 0 ? {} : { name: model.name },
		...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
		...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens }
	};
	if (model.reasoningEfforts !== void 0) fields.reasoningEfforts = Object.fromEntries(model.reasoningEfforts.map((effort) => [effort, effort === "off" ? null : effort]));
	return fields;
}
function groupFor(catalog, provider) {
	if (catalog.failures.some((failure) => failure.id === provider)) return void 0;
	return catalog.groups.find((group) => group.id === provider);
}
async function readCatalog(apiProxy) {
	try {
		return valueOf(await apiProxy.llm.models(request$1({})));
	} catch {
		return;
	}
}
/** Resolve one exact active llm-pi-ai provider address, never an input-supplied path. */
async function eligibleProvider(apiProxy, requested) {
	let providersResponse;
	let settingsResponse;
	try {
		providersResponse = await apiProxy.llm.providers(request$1({}));
		settingsResponse = await apiProxy.settings.describe(request$1({}));
	} catch {
		return {
			status: 502,
			error: "model catalog capability is unavailable"
		};
	}
	const providers = valueOf(providersResponse);
	const settings = valueOf(settingsResponse);
	if (providers === void 0 || settings === void 0) return {
		status: 502,
		error: "model catalog capability is unavailable"
	};
	const route = providers.providers.find((candidate) => candidate.provider === requested);
	if (route === void 0) return {
		status: 404,
		error: `unknown provider ${requested}`
	};
	if (!settings.writable || !route.active || route.settingsNs !== "llm-pi-ai" || route.settingsPath.length !== 2 || route.settingsPath[0] !== "providers" || route.settingsPath[1] !== requested) return {
		status: 403,
		error: `provider ${requested} is not eligible for the paired model catalog`
	};
	const namespace = settings.namespaces.find((candidate) => candidate.ns === "llm-pi-ai");
	const root = namespace !== void 0 && isRecord(namespace.value) ? namespace.value : void 0;
	const providersValue = root !== void 0 && isRecord(root.providers) ? root.providers : void 0;
	const profile = providersValue !== void 0 && isRecord(providersValue[requested]) ? providersValue[requested] : void 0;
	if (namespace === void 0 || profile === void 0) return {
		status: 403,
		error: `provider ${requested} is not eligible for the paired model catalog`
	};
	return { provider: {
		provider: requested,
		displayName: route.displayName,
		namespace,
		profile
	} };
}
function validIdentifier(value) {
	const parsed = stringField(MAX_IDENTIFIER_LENGTH).safeParse(value);
	return parsed.success && parsed.data === value;
}
function configuredModels(profile) {
	if (!Object.hasOwn(profile, "models")) return { inherited: true };
	if (!Array.isArray(profile.models)) return void 0;
	if (profile.models.length === 0) return { inherited: true };
	const values = [];
	for (const entry of profile.models) {
		if (!isRecord(entry) || !validIdentifier(entry.id)) return void 0;
		values.push({ ...entry });
	}
	return {
		inherited: false,
		values
	};
}
function configuredOverrides(profile) {
	if (!Object.hasOwn(profile, "modelOverrides")) return {
		present: false,
		values: /* @__PURE__ */ new Map()
	};
	if (!isRecord(profile.modelOverrides)) return void 0;
	const values = /* @__PURE__ */ new Map();
	for (const [id, value] of Object.entries(profile.modelOverrides)) {
		if (!validIdentifier(id) || !isRecord(value)) return void 0;
		values.set(id, { ...value });
	}
	return {
		present: true,
		values
	};
}
function updatedModels(existing, model) {
	const next = existing.map((entry) => ({ ...entry }));
	const index = next.findIndex((entry) => entry.id === model.id);
	const patch = fieldsOf(model, true);
	if (index >= 0) next[index] = {
		...next[index],
		...patch
	};
	else next.push(patch);
	return next;
}
function mutationPlan(profile, provider, model, catalog) {
	const configured = configuredModels(profile);
	const overrides = configuredOverrides(profile);
	if (configured === void 0 || overrides === void 0) return void 0;
	const modelsPath = [
		"providers",
		provider,
		"models"
	];
	const overridesPath = [
		"providers",
		provider,
		"modelOverrides"
	];
	if (!configured.inherited) {
		if (overrides.values.size > 0) return void 0;
		const ops = [{
			op: "set",
			path: modelsPath,
			value: updatedModels(configured.values, model)
		}];
		if (overrides.present) ops.push({
			op: "unset",
			path: overridesPath
		});
		return { ops };
	}
	const group = groupFor(catalog, provider);
	if (group?.models.some((entry) => entry.id === model.id) === true) {
		const existing = overrides.values.get(model.id) ?? {};
		return { ops: [{
			op: "set",
			path: [...overridesPath, model.id],
			value: {
				...existing,
				...fieldsOf(model, false)
			}
		}] };
	}
	if (group === void 0) return void 0;
	const materialized = [];
	const materializedIds = /* @__PURE__ */ new Set();
	for (const installed of group.models) {
		materialized.push({
			...overrides.values.get(installed.id),
			id: installed.id
		});
		materializedIds.add(installed.id);
	}
	for (const [id, override] of overrides.values) if (!materializedIds.has(id)) materialized.push({
		...override,
		id
	});
	const ops = [{
		op: "set",
		path: modelsPath,
		value: updatedModels(materialized, model)
	}];
	if (overrides.present) ops.push({
		op: "unset",
		path: overridesPath
	});
	return { ops };
}
function paired(req, service) {
	const deviceId = readCookie(req.headers.cookie, service.config.cookieName);
	return deviceId !== void 0 && service.touchDevice(deviceId);
}
async function bodyOf(req, schema) {
	try {
		return schema.parse(await readBoundedJson(req, MAX_BODY_BYTES));
	} catch {
		return;
	}
}
/** Build the narrow paired-device model catalog routes. */
function makePairedModelCatalogRoutes(deps) {
	const { service, apiProxy, lanAddresses } = deps;
	/** Same fence as the /api/pair family: loopback, the advertised LAN literals, or the configured public host. */
	const fence = (req) => {
		const publicHost = publicHostOf(service.publicBaseUrl);
		return isTrustedApiRequest(req, publicHost === void 0 ? lanAddresses : [...lanAddresses, publicHost]);
	};
	const gate = (req, res) => {
		if (!fence(req)) {
			req.resume();
			reject(res, 403, "paired model catalog is not reachable for this origin");
			return false;
		}
		if (!paired(req, service)) {
			req.resume();
			reject(res, 403, "paired model catalog requires a live paired device");
			return false;
		}
		return true;
	};
	const catalog = async (req, res) => {
		if (!gate(req, res)) return;
		if (req.method !== "GET") return reject(res, 405, "method not allowed");
		let providersResponse;
		let settingsResponse;
		try {
			providersResponse = await apiProxy.llm.providers(request$1({}));
			settingsResponse = await apiProxy.settings.describe(request$1({}));
		} catch {
			return reject(res, 502, "model catalog capability is unavailable");
		}
		const providers = valueOf(providersResponse);
		const settings = valueOf(settingsResponse);
		if (providers === void 0 || settings === void 0) return reject(res, 502, "model catalog capability is unavailable");
		const namespace = settings.namespaces.find((candidate) => candidate.ns === "llm-pi-ai");
		const providerMap = namespace !== void 0 && isRecord(namespace.value) && isRecord(namespace.value.providers) ? namespace.value.providers : void 0;
		writeJson(res, 200, {
			capability: "paired-model-catalog",
			providers: settings.writable && providerMap !== void 0 ? providers.providers.filter((candidate) => candidate.active && candidate.settingsNs === "llm-pi-ai" && candidate.settingsPath.length === 2 && candidate.settingsPath[0] === "providers" && candidate.settingsPath[1] === candidate.provider && isRecord(providerMap[candidate.provider])).map((candidate) => ({
				provider: candidate.provider,
				displayName: candidate.displayName
			})) : []
		});
	};
	const discover = async (req, res) => {
		if (!gate(req, res)) return;
		if (req.method !== "POST") return reject(res, 405, "method not allowed");
		const body = await bodyOf(req, providerSchema);
		if (body === void 0) return reject(res, 400, "invalid model catalog request");
		const eligible = await eligibleProvider(apiProxy, body.provider);
		if (eligible.provider === void 0) return reject(res, eligible.status ?? 502, eligible.error ?? "model catalog capability is unavailable");
		try {
			const result = valueOf(await apiProxy.llm.discoverModels(request$1({
				settingsNs: "llm-pi-ai",
				provider: eligible.provider.provider
			})));
			if (result === void 0) return reject(res, 502, `model discovery failed for provider ${eligible.provider.provider}`);
			writeJson(res, 200, { models: publicCandidates(result.models) });
		} catch {
			reject(res, 502, `model discovery failed for provider ${eligible.provider.provider}`);
		}
	};
	const upsert = async (req, res) => {
		if (!gate(req, res)) return;
		if (req.method !== "POST") return reject(res, 405, "method not allowed");
		const body = await bodyOf(req, upsertSchema);
		if (body === void 0) return reject(res, 400, "invalid model catalog request");
		const eligible = await eligibleProvider(apiProxy, body.provider);
		if (eligible.provider === void 0) return reject(res, eligible.status ?? 502, eligible.error ?? "model catalog capability is unavailable");
		const before = await readCatalog(apiProxy);
		if (before === void 0) return reject(res, 502, `model catalog is unavailable for provider ${body.provider}`);
		const plan = mutationPlan(eligible.provider.profile, body.provider, body.model, before);
		if (plan === void 0) return reject(res, 502, `model catalog is unavailable for provider ${body.provider}`);
		let mutation;
		try {
			mutation = await apiProxy.settings.mutate(request$1({
				ns: "llm-pi-ai",
				expectedRevision: eligible.provider.namespace.revision,
				ops: plan.ops
			}));
		} catch {
			return reject(res, 502, `model update failed for provider ${body.provider}`);
		}
		const code = errorCode(mutation);
		if (code === "settings-conflict") return reject(res, 409, `model update conflicted for provider ${body.provider}`);
		if (code === "settings-rejected") return reject(res, 422, `model update was rejected for provider ${body.provider}`);
		if (code !== void 0) return reject(res, 502, `model update failed for provider ${body.provider}`);
		const after = await readCatalog(apiProxy);
		if (after === void 0) return reject(res, 502, `model catalog is unavailable for provider ${body.provider}`);
		writeJson(res, 200, publicCatalog(after));
	};
	return [
		{
			kind: "exact",
			path: PAIRED_MODEL_CATALOG_PATHS.catalog,
			handler: catalog
		},
		{
			kind: "exact",
			path: PAIRED_MODEL_CATALOG_PATHS.discover,
			handler: discover
		},
		{
			kind: "exact",
			path: PAIRED_MODEL_CATALOG_PATHS.upsert,
			handler: upsert
		}
	];
}
//#endregion
//#region src/loopback-proxy.ts
/** WebSocket handshake headers forwarded to the loopback upstream. */
const WS_FORWARD_HEADERS = [
	"sec-websocket-key",
	"sec-websocket-version",
	"sec-websocket-extensions",
	"sec-websocket-protocol"
];
/** Response headers copied from the loopback upstream (no hop-by-hop). */
const HTTP_FORWARD_RESPONSE_HEADERS = [
	"content-type",
	"content-length",
	"content-disposition",
	"cache-control",
	"etag",
	"last-modified"
];
/**
* Pipe one HTTP request to loopback and stream the response back.
* @param req - the already-gated outer request.
* @param res - the outer response.
* @param port - local webServer port.
* @param upstreamPath - path + query on 127.0.0.1 (must start with `/`).
*/
function proxyLoopbackHttp(req, res, port, upstreamPath) {
	const headers = {
		host: `127.0.0.1:${String(port)}`,
		"sec-fetch-site": "same-origin"
	};
	const contentType = req.headers["content-type"];
	if (typeof contentType === "string") headers["content-type"] = contentType;
	const contentLength = req.headers["content-length"];
	if (typeof contentLength === "string") headers["content-length"] = contentLength;
	const accept = req.headers.accept;
	if (typeof accept === "string") headers.accept = accept;
	const upstream = request({
		host: "127.0.0.1",
		port,
		path: upstreamPath,
		method: req.method,
		headers
	}, (upstreamRes) => {
		const out = {};
		for (const name of HTTP_FORWARD_RESPONSE_HEADERS) {
			const value = upstreamRes.headers[name];
			if (value !== void 0) out[name] = value;
		}
		res.writeHead(upstreamRes.statusCode ?? 502, out);
		upstreamRes.pipe(res);
	});
	upstream.on("error", () => {
		if (!res.headersSent) {
			writeJson(res, 502, {
				ok: false,
				error: {
					code: "upstream-failure",
					message: "upstream request failed"
				}
			});
			return;
		}
		res.destroy();
	});
	req.pipe(upstream);
}
/**
* Rebuild a WebSocket handshake as loopback-shaped and pipe both directions.
* @param req - the already-gated upgrade request.
* @param socket - the client duplex.
* @param head - bytes already read past the handshake.
* @param port - local webServer port.
* @param upstreamPath - path + query on 127.0.0.1.
*/
function proxyLoopbackUpgrade(req, socket, head, port, upstreamPath) {
	const lines = [
		`GET ${upstreamPath} HTTP/1.1`,
		`Host: 127.0.0.1:${String(port)}`,
		"Upgrade: websocket",
		"Connection: Upgrade"
	];
	for (const name of WS_FORWARD_HEADERS) {
		const value = req.headers[name];
		if (value === void 0) continue;
		lines.push(`${name}: ${Array.isArray(value) ? value.join(", ") : value}`);
	}
	const handshake = `${lines.join("\r\n")}\r\n\r\n`;
	const upstream = connect(port, "127.0.0.1");
	const tearDown = () => {
		upstream.destroy();
		socket.destroy();
	};
	upstream.on("error", tearDown);
	socket.on("error", tearDown);
	upstream.on("close", () => {
		socket.destroy();
	});
	socket.on("close", () => {
		upstream.destroy();
	});
	upstream.on("connect", () => {
		upstream.write(handshake);
		if (head.length > 0) upstream.write(head);
		socket.pipe(upstream);
		upstream.pipe(socket);
	});
}
//#endregion
//#region src/remote-methods.ts
/**
* Remote desktop channel constants — SDK-independent so tests and the
* client half can pin them without importing the host SDK graph.
*/
/** Gated mirror of same-origin fenced paths (`/remote` + original pathname). */
const REMOTE_PREFIX$1 = "/remote";
/** Connection-plugin method prefix under the gated channel. */
const REMOTE_API_PREFIX$1 = `${REMOTE_PREFIX$1}/api`;
/** WebSocket event-stream paths served by the channel (client rewrites to these). */
const REMOTE_API_PATHS = {
	mux: `${REMOTE_API_PREFIX$1}/events.mux`,
	host: `${REMOTE_API_PREFIX$1}/events.host`
};
/**
* Exact upgrade paths registered on webServer (the SDK matches upgrades by
* exact path, not prefix). Query strings ride on the request URL.
*/
const REMOTE_UPGRADE_PATHS = [
	REMOTE_API_PATHS.mux,
	REMOTE_API_PATHS.host,
	`${REMOTE_PREFIX$1}/sidebar/ws/terminal`,
	`${REMOTE_PREFIX$1}/sidebar/ws/agent-terminals`,
	`${REMOTE_API_PREFIX$1}/dsh-ssh/terminal`
];
/**
* Loopback-only methods of the host API surface, mirrored from
* client-connection's `PRIVILEGED_METHODS` (pinned by
* tests/remote-contract.spec.ts against the installed SDK). They stay
* unreachable from a paired remote desktop, matching the SDK's own stance
* that the configuration plane is loopback-same-origin only.
*/
const LOOPBACK_ONLY_METHODS = /* @__PURE__ */ new Set([
	"agentPreset.read",
	"agentPreset.copy",
	"agentPreset.openDocument",
	"agentPreset.remove",
	"host.pickDirectory",
	"host.openPath",
	"settings.describe",
	"settings.openDocument",
	"settings.update",
	"settings.replace",
	"settings.mutate",
	"credentials.describe",
	"credentials.set",
	"credentials.unset",
	"llm.discoverModels"
]);
//#endregion
//#region src/remote-api.ts
const ALLOWED_METHODS = /* @__PURE__ */ new Set([
	"GET",
	"HEAD",
	"POST",
	"PUT",
	"PATCH",
	"DELETE"
]);
/** Reject traversal and empty segments; allow plugin file-path characters. */
function isSafeSegment(segment) {
	if (segment === "") return false;
	let decoded;
	try {
		decoded = decodeURIComponent(segment);
	} catch {
		return false;
	}
	return decoded !== "." && decoded !== ".." && !decoded.includes("/") && !decoded.includes("\\") && !decoded.includes("\0");
}
/** One SDK-shaped error envelope (keeps the desktop client's parse path intact). */
function envelopeError(res, status, rpcId, code, message) {
	writeJson(res, status, {
		type: "server-response",
		rpcId,
		result: {
			ok: false,
			error: {
				code,
				message,
				details: { issues: [] }
			}
		}
	});
}
/**
* Map `/remote/...` to the inner path, or undefined when the outer path is
* not a safe rewrite target.
*/
function innerPathOf(pathname) {
	if (pathname === "/remote" || pathname === `/remote/`) return void 0;
	if (!pathname.startsWith(`/remote/`)) return void 0;
	const rest = pathname.slice(7);
	if (!rest.startsWith("/")) return void 0;
	const segments = rest.slice(1).split("/");
	if (segments.length === 0 || segments.some((segment) => !isSafeSegment(segment))) return;
	return rest;
}
/**
* Whether a paired inner path must stay physically local.
* @returns a denial message, or undefined when the path may be proxied.
*/
function loopbackOnlyDenial(innerPath) {
	if (innerPath === "/api/pair" || innerPath.startsWith("/api/pair/")) return "pairing endpoints stay loopback-only and stay unreachable from a paired remote desktop";
	if (innerPath === "/api/plugin-manager" || innerPath.startsWith(`/api/plugin-manager/`)) return "plugin-manager stays loopback-only and stays unreachable from a paired remote desktop";
	if (innerPath === "/api/dsh-desktop-launcher" || innerPath.startsWith(`/api/dsh-desktop-launcher/`)) return "desktop-launcher endpoints stay loopback-only and stay unreachable from a paired remote desktop";
	if (innerPath === "/api/dsh-web-ui-settings" || innerPath.startsWith(`/api/dsh-web-ui-settings/`)) return "settings-bridge endpoints stay loopback-only and stay unreachable from a paired remote desktop";
	if (!innerPath.startsWith("/api/")) return void 0;
	const method = innerPath.slice(5);
	if (method !== "" && !method.includes("/") && LOOPBACK_ONLY_METHODS.has(method)) return `${method} is loopback-only and stays unreachable from a paired remote desktop`;
}
/**
* Build the remote desktop channel HTTP routes.
* @param deps - pairing service + local port + live pairing policy.
* @returns the routes to register on webServer.
*/
function makeRemoteApiRoutes(deps) {
	const { service, port, requirePairingForLan = true } = deps;
	const handler = (req, res) => {
		if (typeof requirePairingForLan === "function" ? requirePairingForLan() : requirePairingForLan) {
			const deviceId = readCookie(req.headers.cookie, service.config.cookieName);
			if (!(deviceId !== void 0 && service.touchDevice(deviceId))) {
				req.resume();
				envelopeError(res, 403, "invalid-request", "unpaired", "this device is not paired with the desktop");
				return;
			}
		}
		const method = req.method ?? "GET";
		if (!ALLOWED_METHODS.has(method)) {
			req.resume();
			res.writeHead(405).end();
			return;
		}
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const inner = innerPathOf(url.pathname);
		if (inner === void 0) {
			req.resume();
			res.writeHead(404).end();
			return;
		}
		const denied = loopbackOnlyDenial(inner);
		if (denied !== void 0) {
			req.resume();
			envelopeError(res, 403, "invalid-request", "forbidden", denied);
			return;
		}
		proxyLoopbackHttp(req, res, port, `${inner}${url.search}`);
	};
	return [{
		kind: "prefix",
		path: REMOTE_PREFIX$1,
		handler
	}];
}
/**
* Map one outer upgrade URL onto the loopback path (query string included).
*/
function upgradeInnerPath(reqUrl, fallbackPath) {
	if (reqUrl === void 0 || reqUrl === "") return fallbackPath;
	let url;
	try {
		url = new URL(reqUrl, "http://127.0.0.1");
	} catch {
		return fallbackPath;
	}
	const inner = innerPathOf(url.pathname);
	if (inner === void 0) return fallbackPath;
	return `${inner}${url.search}`;
}
/**
* Build the WebSocket upgrade routes for the event streams and known plugin
* sockets. webServer matches upgrades by exact path.
* @param deps - pairing service + local port + live pairing policy.
* @returns the upgrade routes to register on webServer.
*/
function makeRemoteApiUpgradeRoutes(deps) {
	const { service, port, requirePairingForLan = true } = deps;
	const handlerFor = (fallbackPath) => (req, socket, head) => {
		if (typeof requirePairingForLan === "function" ? requirePairingForLan() : requirePairingForLan) {
			const deviceId = readCookie(req.headers.cookie, service.config.cookieName);
			if (deviceId === void 0 || !service.touchDevice(deviceId)) {
				socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
				socket.destroy();
				return;
			}
		}
		const inner = upgradeInnerPath(req.url, fallbackPath);
		if (loopbackOnlyDenial(inner.split("?")[0] ?? inner) !== void 0) {
			socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}
		proxyLoopbackUpgrade(req, socket, head, port, inner);
	};
	return REMOTE_UPGRADE_PATHS.map((path) => ({
		path,
		handler: handlerFor(path.slice(7))
	}));
}
//#endregion
//#region src/posture.ts
/**
* Build the forged Host values to probe: the public base authority (host or
* host:port as written in the URL) plus every LAN base literal.
* @param publicBaseUrl - the configured public base URL (or undefined).
* @param lanAddresses - the LAN interface addresses the QR advertises.
* @param port - the local webServer port (LAN hosts are probed as host:port).
* @returns Host header values, de-duplicated.
*/
function postureTargets(publicBaseUrl, lanAddresses, port) {
	const targets = [];
	if (publicBaseUrl !== void 0) try {
		const url = new URL(publicBaseUrl);
		const authority = url.port === "" ? url.hostname : `${url.hostname}:${url.port}`;
		if (authority !== "") targets.push(authority);
	} catch {}
	for (const address of lanAddresses) targets.push(`${address}:${String(port)}`);
	return [...new Set(targets)];
}
const defaultRequest = (options, onStatus) => {
	const request = http.request(options, (response) => {
		onStatus(response.statusCode ?? 0);
	});
	request.on("error", () => {
		onStatus(0);
	});
	return request;
};
/**
* Probe one forged Host against the local `/api` fence.
* @param port - the local webServer port.
* @param hostHeader - the Host header to forge.
* @param request - transport seam.
* @param timeoutMs - give up after this long (counts as not exposed; the
* fence being unreachable is not evidence it is open).
* @returns true when the probe got past the fence.
*/
async function probeHost(port, hostHeader, request, timeoutMs) {
	return await new Promise((resolve) => {
		let settled = false;
		const finish = (exposed) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			handle.destroy();
			resolve(exposed);
		};
		const handle = request({
			host: "127.0.0.1",
			port,
			method: "POST",
			path: "/api/session.list",
			headers: {
				host: hostHeader,
				"content-type": "application/json"
			},
			timeout: timeoutMs
		}, (status) => {
			finish(status !== 403);
		});
		const timer = setTimeout(() => {
			finish(false);
		}, timeoutMs + 1e3);
		handle.on("error", () => {
			finish(false);
		});
		handle.end("{}");
	});
}
/**
* Run one posture probe round.
* @returns the snapshot for this round.
*/
async function probePosture(options) {
	const { port, targets } = options;
	const request = options.request ?? defaultRequest;
	const timeoutMs = options.timeoutMs ?? 3e3;
	const now = options.now ?? (() => Date.now());
	const hosts = [];
	for (const target of targets) hosts.push({
		host: target,
		exposed: await probeHost(port, target, request, timeoutMs)
	});
	return {
		checkedAt: now(),
		hosts
	};
}
/**
* Reserve an advertised-target key so a second trigger with the same set
* does not overlap an in-flight round. Pair with {@link releasePostureKey}
* on failure — otherwise that key never retries.
*/
function claimPostureKey(current, key) {
	if (current === key) return {
		run: false,
		next: current
	};
	return {
		run: true,
		next: key
	};
}
/**
* Drop a failed in-flight key so the next trigger re-probes the same targets.
* A newer key that started meanwhile is left alone.
*/
function releasePostureKey(current, attempted) {
	return current === attempted ? void 0 : current;
}
//#endregion
//#region src/lan.ts
/**
* LAN address derivation for the pairing URLs. Mirrors the dsh CLI's
* boot-time sampling (apps/cli/src/app-cli-entry.ts `resolveLanTrust`): the
* pairing links may only name addresses the /api trust fence was configured
* with, so the same non-internal IPv4 derivation applies here — an external
* plugin cannot read the CLI's sampled snapshot, but the fence accepts
* exactly these literals, which is the property that matters.
*/
/**
* Non-internal IPv4 interface addresses of this machine — the IP-literal
* authorities an all-interfaces bind is reachable by on the LAN.
* @returns the addresses in interface order (possibly empty).
*/
function lanIPv4Addresses() {
	return Object.values(networkInterfaces()).flat().filter((iface) => {
		return iface !== void 0 && iface.family === "IPv4" && !iface.internal;
	}).map((iface) => iface.address);
}
//#endregion
//#region src/tunnel.ts
/**
* Auto-tunnel manager: spawns a Cloudflare quick tunnel (`cloudflared
* tunnel --url <local>`) through the `cloudflared` npm package — its
* postinstall downloads the platform binary, so no user-side tooling is
* involved — surfaces the minted `https://xxx.trycloudflare.com` URL, and
* restarts the process after unexpected exits with exponential backoff.
*
* The cloudflared package's Tunnel is a thin spawn wrapper; this manager
* owns the lifecycle policy (binary readiness, URL timeout, restart
* backoff) around it. All seams — the tunnel factory, binary readiness,
* timers — are injectable so the whole lifecycle is unit-testable without
* a real binary or network.
*/
/** Default binary readiness: download the platform binary on first use. */
async function defaultEnsureBinary() {
	if (existsSync(bin)) return;
	await install(bin);
}
/** Default factory: the cloudflared package's quick tunnel (no account). */
function defaultFactory(targetUrl) {
	return Tunnel.quick(targetUrl, { "--no-autoupdate": true });
}
/** Node timers. */
const nodeTimer = {
	setTimeout,
	clearTimeout
};
/**
* Own the lifecycle of one auto-tunnel: start/stop, URL surfacing, and
* crash-restart backoff.
*/
var TunnelManager = class {
	factory;
	ensureBinary;
	urlTimeoutMs;
	restartBaseMs;
	restartMaxMs;
	timer;
	phase = "stopped";
	url;
	error;
	targetUrl;
	handle;
	urlTimer;
	restartTimer;
	attempts = 0;
	generation = 0;
	stopping = false;
	urlListeners = /* @__PURE__ */ new Set();
	phaseListeners = /* @__PURE__ */ new Set();
	/**
	* @param options - seams; defaults spawn the real quick tunnel.
	*/
	constructor(options = {}) {
		this.factory = options.factory ?? defaultFactory;
		this.ensureBinary = options.ensureBinary ?? defaultEnsureBinary;
		this.urlTimeoutMs = options.urlTimeoutMs ?? 3e4;
		this.restartBaseMs = options.restartBaseMs ?? 5e3;
		this.restartMaxMs = options.restartMaxMs ?? 6e4;
		this.timer = options.timer ?? nodeTimer;
	}
	/** The current status frame. */
	get info() {
		return {
			phase: this.phase,
			...this.url !== void 0 ? { url: this.url } : {},
			...this.error !== void 0 ? { error: this.error } : {}
		};
	}
	/**
	* Start (or keep) a quick tunnel toward `targetUrl`. Restarting with a
	* different target tears the old tunnel down first; restarting with the
	* same target while running is a no-op.
	* @param targetUrl - the local URL to expose, e.g. `http://127.0.0.1:3080`.
	*/
	start(targetUrl) {
		if (this.targetUrl === targetUrl && (this.phase === "starting" || this.phase === "running")) return;
		this.teardown();
		this.stopping = false;
		this.targetUrl = targetUrl;
		this.attempts = 0;
		this.generation += 1;
		this.attempt();
	}
	/** Stop the tunnel for good: no restarts, no state. */
	stop() {
		this.teardown();
		this.stopping = false;
		this.targetUrl = void 0;
		this.setPhase("stopped");
	}
	/** Alias of {@link stop} for plugin-effect disposal. */
	dispose() {
		this.stop();
	}
	/** Subscribe to minted tunnel URLs (fire-and-forget duplicates dropped). */
	onUrl(listener) {
		this.urlListeners.add(listener);
		return () => {
			this.urlListeners.delete(listener);
		};
	}
	/** Subscribe to every phase change. */
	onPhase(listener) {
		this.phaseListeners.add(listener);
		return () => {
			this.phaseListeners.delete(listener);
		};
	}
	attempt() {
		if (this.stopping || this.targetUrl === void 0) return;
		const gen = this.generation;
		this.setPhase("starting");
		this.handle = void 0;
		this.url = void 0;
		this.error = void 0;
		this.ensureBinary().then(() => {
			if (this.stopping || this.targetUrl === void 0 || gen !== this.generation) return;
			const handle = this.factory(this.targetUrl);
			this.handle = handle;
			this.urlTimer = this.timer.setTimeout(() => {
				this.fail("timed out waiting for the tunnel URL");
			}, this.urlTimeoutMs);
			handle.on("url", (value) => {
				if (this.handle !== handle) return;
				this.handleUrl(value);
			});
			handle.on("exit", () => {
				if (this.handle !== handle) return;
				this.handleExit();
			});
			handle.on("error", (value) => {
				if (this.handle !== handle || this.phase !== "starting") return;
				this.error = value instanceof Error ? value.message : String(value);
			});
		}).catch((value) => {
			if (this.stopping || this.targetUrl === void 0 || gen !== this.generation) return;
			const message = value instanceof Error ? value.message : String(value);
			this.fail(`could not obtain the cloudflared binary: ${message}`);
		});
	}
	handleUrl(value) {
		if (this.urlTimer !== void 0) {
			this.timer.clearTimeout(this.urlTimer);
			this.urlTimer = void 0;
		}
		this.url = value;
		this.error = void 0;
		this.attempts = 0;
		this.setPhase("running");
		for (const listener of this.urlListeners) try {
			listener(value);
		} catch {}
	}
	handleExit() {
		if (this.stopping) return;
		this.fail("the tunnel process exited unexpectedly");
	}
	fail(message) {
		if (this.stopping) return;
		this.url = void 0;
		this.error = message;
		if (this.handle !== void 0) {
			this.handle.stop();
			this.handle = void 0;
		}
		if (this.urlTimer !== void 0) {
			this.timer.clearTimeout(this.urlTimer);
			this.urlTimer = void 0;
		}
		this.setPhase("failed");
		this.attempts += 1;
		const delay = Math.min(this.restartBaseMs * 2 ** (this.attempts - 1), this.restartMaxMs);
		this.restartTimer = this.timer.setTimeout(() => {
			this.restartTimer = void 0;
			this.attempt();
		}, delay);
	}
	/** Stop the current process and cancel every pending timer (no phase change). */
	teardown() {
		this.stopping = true;
		if (this.urlTimer !== void 0) {
			this.timer.clearTimeout(this.urlTimer);
			this.urlTimer = void 0;
		}
		if (this.restartTimer !== void 0) {
			this.timer.clearTimeout(this.restartTimer);
			this.restartTimer = void 0;
		}
		if (this.handle !== void 0) {
			this.handle.stop();
			this.handle = void 0;
		}
	}
	setPhase(phase) {
		this.phase = phase;
		const info = this.info;
		for (const listener of this.phaseListeners) try {
			listener(info);
		} catch {}
	}
};
//#endregion
//#region src/mount-once.ts
/**
* Host single-instance guard shared by the plugin family. The family bundle
* (dsh-web-ui-all / dsh-skins) namespaces every child row id (web-ui-*), so
* the loader accepts a standalone install of the same package side by side;
* without this guard the second instance would still re-register the same
* webserver routes, tools, settings namespaces, and system-prompt sections
* and fail the boot. mountOnce makes the second host apply a no-op for the
* lifetime of the first instance (the browser half is already deduped by
* package name in the client module host).
*
* The registry rides a global symbol so two module instances of the same
* package (npm copy vs repository link) still share one verdict. cordis
* `ctx.effect` runs its callback immediately and treats the callback's
* return value as the fiber disposer, so the unmarker is returned, not run.
*/
const MOUNTED = Symbol.for("dsh-web-ui.mounted-plugins");
function mountedSet() {
	const registry = globalThis;
	return registry[MOUNTED] ??= /* @__PURE__ */ new Set();
}
/**
* Wrap a cordis plugin apply so the package runs at most once per process.
* The first mount registers normally and unmarks when its fiber disposes;
* any later mount of the same package name is a no-op.
* @param packageName - npm package identity shared by every install source.
* @param fn - the original plugin apply.
* @returns an apply of the same shape.
*/
function mountOnce(packageName, fn) {
	return ((...args) => {
		const mounted = mountedSet();
		if (mounted.has(packageName)) return;
		mounted.add(packageName);
		args[0]?.effect?.(() => () => {
			mounted.delete(packageName);
		});
		return fn(...args);
	});
}
/** The live rule set. */
const REMOTE_CHANNEL_RULES = {
	remotePrefix: "/remote",
	apiPrefix: "/api/",
	pairPrefix: "/api/pair/",
	desktopLauncherPrefix: "/api/dsh-desktop-launcher",
	settingsBridgePrefix: "/api/dsh-web-ui-settings",
	sidebarPrefix: "/sidebar/",
	gitPrefix: "/git/",
	petPrefix: "/pet/",
	wsPaths: [
		"/api/events.mux",
		"/api/events.host",
		"/sidebar/ws/terminal",
		"/sidebar/ws/agent-terminals",
		"/api/dsh-ssh/terminal"
	]
};
/** The window global the boot patch publishes its seat under. */
const REMOTE_CHANNEL_BOOT_GLOBAL = "__DSH_REMOTE_CHANNEL_BOOT__";
//#endregion
//#region src/remote-channel-boot.ts
/**
* Parse-time remote-channel boot patch (issue #987): the browser-half patch
* (client/remote-channel.ts) installs when this plugin's boot entry runs,
* but `dsh-client-connection` boots earlier and opens its event streams
* unrewritten — on a non-loopback origin the SDK fence rejects them and the
* workspace list never loads. The host therefore inlines this classic script
* right after the opening <head> tag (webserver/index-inject), so the
* fetch/WebSocket/EventSource/src rewrite is active before ANY boot entry
* executes. The plugin's client apply later adopts the installed seat
* (hooks + pending unpaired signal) instead of patching twice.
*
* The rewrite decisions are generated from REMOTE_CHANNEL_RULES, the same
* data the browser patch consumes — the two cannot drift apart. The script
* self-skips on loopback origins and never throws.
* @module dsh-remote-web-ui/remote-channel-boot
*/
/**
* Build the inline boot script. The result contains no `<\/script` sequence
* (the injection contract) and installs a {@link RemoteChannelBootSeat} on
* the window global.
*/
function buildRemoteChannelBootScript(rules = REMOTE_CHANNEL_RULES) {
	const json = JSON.stringify(rules);
	const seat = JSON.stringify(REMOTE_CHANNEL_BOOT_GLOBAL);
	return "(function(){try{var w=window,loc=w.location,h=loc.hostname;if(h==='localhost'||h==='::1'||/^127(\\.\\d{1,3}){3}$/.test(h))return;var R=" + json + ";function sf(p){if(p.indexOf(R.pairPrefix)===0)return false;if(p===R.desktopLauncherPrefix||p.indexOf(R.desktopLauncherPrefix+\"/\")===0)return false;if(p===R.settingsBridgePrefix||p.indexOf(R.settingsBridgePrefix+\"/\")===0)return false;if(p.indexOf(R.apiPrefix)===0)return true;if(p.indexOf(R.sidebarPrefix)===0||p===\"/sidebar\")return true;if(p.indexOf(R.gitPrefix)===0||p===\"/git\")return true;if(p.indexOf(R.petPrefix)===0||p===\"/pet\")return true;return false}function sw(p){return R.wsPaths.indexOf(p)!==-1}function rp(p){return R.remotePrefix+p}function so(u){return u.origin===loc.origin}function rr(raw){var u;try{u=new URL(raw,loc.href)}catch(e){return raw}if(u.origin!==loc.origin)return raw;if(!sf(u.pathname))return raw;u.pathname=rp(u.pathname);if(raw.charAt(0)===\"/\"&&raw.charAt(1)!==\"/\")return u.pathname+u.search+u.hash;return u.href}function uc(v){if(typeof v!==\"object\"||v===null)return undefined;var n=v.result;if(typeof n===\"object\"&&n!==null){var e=n.error;if(typeof e===\"object\"&&e!==null&&typeof e.code===\"string\")return e.code}var t=v.error;if(typeof t===\"object\"&&t!==null&&typeof t.code===\"string\")return t.code;return undefined}var seat={onUnpaired:null,onPaired:null,pendingUnpaired:false,restore:function(){}};function denied(res){if(res.status!==403)return false;return res.clone().json().then(function(b){return uc(b)===\"unpaired\"}).catch(function(){return false})}function signal(unpaired){if(unpaired){if(seat.onUnpaired)seat.onUnpaired();else seat.pendingUnpaired=true}else{seat.pendingUnpaired=false;if(seat.onPaired)seat.onPaired()}}var of=w.fetch;w.fetch=function(input,init){var raw=typeof input===\"string\"||input instanceof URL?input.toString():input.url;var url=new URL(raw,loc.href);if(so(url)&&sf(url.pathname)){var next=new URL(url);next.pathname=rp(url.pathname);var target=typeof input===\"string\"||input instanceof URL?next.toString():new Request(next,input);return Promise.resolve(of.call(w,target,init)).then(function(res){void Promise.resolve(denied(res)).then(signal);return res})}return of.call(w,input,init)};var OW=w.WebSocket;w.WebSocket=function(url,protocols){var p=new URL(url.toString(),loc.href);var o=p.protocol===\"wss:\"?\"https://\"+p.host:p.protocol===\"ws:\"?\"http://\"+p.host:\"\";if(o!==\"\"&&o===loc.origin&&sw(p.pathname)){var nx=new URL(p);nx.pathname=rp(p.pathname);return protocols!==undefined?new OW(nx,protocols):new OW(nx)}return protocols!==undefined?new OW(url,protocols):new OW(url)};w.WebSocket.prototype=OW.prototype;w.WebSocket.CONNECTING=OW.CONNECTING;w.WebSocket.OPEN=OW.OPEN;w.WebSocket.CLOSING=OW.CLOSING;w.WebSocket.CLOSED=OW.CLOSED;var OE=w.EventSource;if(OE!==undefined){w.EventSource=function(url,cfg){var p=new URL(url.toString(),loc.href);if(so(p)&&sf(p.pathname)){var nx=new URL(p);nx.pathname=rp(p.pathname);return new OE(nx,cfg)}return new OE(url,cfg)};w.EventSource.prototype=OE.prototype}var restores=[];function patchSrc(C){if(C===undefined)return;var d=Object.getOwnPropertyDescriptor(C.prototype,\"src\");if(d===undefined||d.configurable===false||d.set===undefined)return;var os=d.set;Object.defineProperty(C.prototype,\"src\",{configurable:true,enumerable:d.enumerable!==false,get:d.get,set:function(v){os.call(this,rr(String(v)))}});restores.push(function(){Object.defineProperty(C.prototype,\"src\",d)})}patchSrc(w.HTMLImageElement);patchSrc(w.HTMLScriptElement);patchSrc(w.HTMLIFrameElement);seat.restore=function(){w.fetch=of;w.WebSocket=OW;if(OE!==undefined)w.EventSource=OE;for(var i=0;i<restores.length;i++)restores[i]();try{delete w[" + seat + "]}catch(e){w[" + seat + "]=undefined}};w[" + seat + "]=seat}catch(e){}})();";
}
/** The script this plugin contributes; built once from the live rules. */
const REMOTE_CHANNEL_BOOT_SCRIPT = buildRemoteChannelBootScript();
//#endregion
//#region src/uuid-polyfill.ts
/**
* Polyfill for crypto.randomUUID for non-secure contexts (LAN HTTP)
* where the browser does not expose crypto.randomUUID.
*
* The script string is injected as an inline <script> in the desktop HTML
* head so the SDK's mintRpcId() sees a working randomUUID even on plain
* http:// origins (#1024).
*/
const UUID_POLYFILL_SCRIPT = [
	"(function(){",
	"var g=typeof globalThis!==\"undefined\"?globalThis:typeof window!==\"undefined\"?window:self;",
	"if(typeof g.crypto===\"undefined\"){g.crypto={};}",
	"if(typeof g.crypto.randomUUID!==\"function\"){",
	"g.crypto.randomUUID=function(){",
	"var a=new Uint8Array(16);",
	"if(g.crypto.getRandomValues){g.crypto.getRandomValues(a);}",
	"else{for(var j=0;j<16;j++){a[j]=Math.random()*256|0;}}",
	"a[6]=(a[6]&0x0f)|0x40;",
	"a[8]=(a[8]&0x3f)|0x80;",
	"var h=\"\",x=\"0123456789abcdef\";",
	"for(var i=0;i<16;i++){h+=x[a[i]>>4]+x[a[i]&0x0f];",
	"if(i===3||i===5||i===7||i===9)h+=\"-\";}",
	"return h;",
	"};",
	"}",
	"})();"
].join("");
//#endregion
//#region src/index.ts
/** Stable cordis plugin name. */
const name = "remote-web-ui";
/** Services required before the pairing surfaces can mount. */
const inject = ["webServer", "apiProxy"];
/**
* Settings namespace of the remote-control capability — the section the web
* settings surface edits. Spelled here rather than imported: the browser
* half spells the same value and must not depend on a Host package.
*/
const REMOTE_WEB_UI_SETTINGS_NAMESPACE = settingsNamespace("remote-web-ui");
const Config = z.object({
	tokenTtlMs: z.number().step(1).min(6e4).default(6e5),
	offlineAfterMs: z.number().step(1).min(5e3).default(25e3),
	maxDevices: z.number().step(1).min(1).max(64).default(4),
	idleExpireMs: z.number().step(1).min(6e4).default(DEFAULT_IDLE_EXPIRE_MS),
	cookieName: z.string().min(1).default("dsh_pair"),
	requirePairingForLan: z.boolean().default(true),
	publicBaseUrl: z.string(),
	devicesFile: z.string(),
	autoTunnel: z.boolean().default(false),
	enabled: z.boolean().default(true)
});
/** Presence sweep cadence (a stale device flips to disconnected within two sweeps). */
const SWEEP_INTERVAL_MS = 1e4;
/**
* The single mapping from resolved plugin config to the pairing service
* config. Both the constructed service and every live settings sync reuse
* it, so no field can be silently dropped when the web settings surface
* pushes a new value into the running service.
*/
function pairingConfigOf(resolved) {
	return {
		tokenTtlMs: resolved.tokenTtlMs,
		offlineAfterMs: resolved.offlineAfterMs,
		maxDevices: resolved.maxDevices,
		idleExpireMs: resolved.idleExpireMs,
		cookieName: resolved.cookieName,
		devicesFile: resolved.devicesFile
	};
}
/** Default paired-session store: `$DSH_HOME/remote-web-ui-devices.json`. */
function defaultDevicesFile(home = dshHome()) {
	return join(home, "remote-web-ui-devices.json");
}
/** Schema defaults, re-read for hand-built test contexts (the loader applies them normally). */
const DEFAULTS = {
	tokenTtlMs: 6e5,
	offlineAfterMs: 25e3,
	maxDevices: 4,
	idleExpireMs: DEFAULT_IDLE_EXPIRE_MS,
	cookieName: "dsh_pair",
	requirePairingForLan: true,
	publicBaseUrl: void 0,
	devicesFile: defaultDevicesFile(),
	autoTunnel: false,
	enabled: true
};
/**
* Mount the pairing service, routes, gate listener, and presence sweep.
* @param ctx - host plugin context carrying webServer.
* @param config - resolved plugin config (schema defaults applied by the loader).
*/
const apply = mountOnce("dsh-remote-web-ui", applyImpl);
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
		enabled: config?.enabled ?? DEFAULTS.enabled
	};
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
			enabled: value.enabled ?? DEFAULTS.enabled
		};
	};
	const service = new PairingService(pairingConfigOf(resolved));
	const tunnel = new TunnelManager();
	let autoTunnel = resolved.autoTunnel;
	tunnel.onPhase((info) => {
		if (!autoTunnel) return;
		if (info.phase === "running" && info.url !== void 0) {
			service.setPublicBaseUrl(info.url);
			service.setTunnelStatus({
				state: "running",
				url: info.url
			});
			runPostureProbe();
		} else if (info.phase === "starting") {
			service.setPublicBaseUrl(void 0);
			service.setTunnelStatus({ state: "starting" });
		} else if (info.phase === "failed") {
			service.setPublicBaseUrl(void 0);
			service.setTunnelStatus(info.error === void 0 ? { state: "failed" } : {
				state: "failed",
				error: info.error
			});
		}
	});
	ctx.effect(() => () => {
		tunnel.dispose();
	}, "remote-web-ui: auto tunnel");
	const lanBases = ctx.webServer.host === "0.0.0.0" ? lanIPv4Addresses().map((address) => ({
		address,
		base: `http://${address}:${String(ctx.webServer.port)}`
	})) : [];
	service.setLanBases(lanBases);
	const lanAddresses = lanBases.map((entry) => entry.address);
	let disposeRoutes;
	let disposeSweep;
	const apiProxy = ctx.get("apiProxy");
	if (apiProxy === void 0) console.warn("remote-web-ui: apiProxy service unavailable — the paired model catalog is disabled");
	const routes = [
		...makeRoutes({
			service,
			lanAddresses,
			requirePairingForLan: () => resolve().requirePairingForLan
		}),
		...apiProxy !== void 0 ? makePairedModelCatalogRoutes({
			service,
			apiProxy,
			lanAddresses
		}) : [],
		...makeRemoteApiRoutes({
			service,
			port: ctx.webServer.port,
			requirePairingForLan: () => resolve().requirePairingForLan
		})
	];
	const upgrades = makeRemoteApiUpgradeRoutes({
		service,
		port: ctx.webServer.port,
		requirePairingForLan: () => resolve().requirePairingForLan
	});
	const gate = makeGateListener(service, () => resolve().requirePairingForLan, () => resolve().enabled);
	ctx.effect(() => ctx.on("api/gate", gate), "remote-web-ui: api gate");
	let postureKey;
	let postureWasExposed = false;
	const runPostureProbe = () => {
		if (!resolve().enabled) return;
		const targets = postureTargets(service.publicBaseUrl, service.lanAddresses, ctx.webServer.port);
		if (targets.length === 0) {
			postureKey = void 0;
			service.setPosture(void 0);
			return;
		}
		const key = targets.join("|");
		const claim = claimPostureKey(postureKey, key);
		if (!claim.run) return;
		postureKey = claim.next;
		probePosture({
			port: ctx.webServer.port,
			targets
		}).then((snapshot) => {
			service.setPosture(snapshot);
			const exposedHosts = snapshot.hosts.filter((host) => host.exposed).map((host) => host.host);
			const exposed = exposedHosts.length > 0;
			if (exposed && !postureWasExposed) console.error(`remote-web-ui: CRITICAL — the /api fence is OPEN for [${exposedHosts.join(", ")}]: unpaired clients reach the full host API. Remove --trusted-host for these hosts (pairing covers them) or bind loopback.`);
			else if (!exposed && postureWasExposed) console.log("remote-web-ui: the /api posture probe is clean again (every advertised origin refused with 403).");
			postureWasExposed = exposed;
		}).catch(() => {
			postureKey = releasePostureKey(postureKey, key);
		});
	};
	const initialPostureTimer = setTimeout$1(() => {
		runPostureProbe();
	}, 5e3);
	initialPostureTimer.unref();
	ctx.effect(() => () => {
		clearTimeout(initialPostureTimer);
	}, "remote-web-ui: posture probe boot");
	new RemoteWebUiPairing(ctx, (request) => {
		if (!resolve().enabled) return false;
		return isPairedDeviceRequest(service, request);
	});
	const sync = () => {
		const value = resolve();
		service.config = pairingConfigOf(value);
		autoTunnel = value.autoTunnel === true;
		if (autoTunnel) {
			if (value.publicBaseUrl !== void 0) console.warn("remote-web-ui: autoTunnel is on — ignoring the manually configured publicBaseUrl");
			tunnel.start(`http://127.0.0.1:${String(ctx.webServer.port)}`);
		} else {
			tunnel.stop();
			if (value.publicBaseUrl !== void 0 && !isHttpUrl(value.publicBaseUrl)) {
				console.warn(`remote-web-ui: ignoring malformed publicBaseUrl ${JSON.stringify(value.publicBaseUrl)} (expected https://host[:port])`);
				service.setPublicBaseUrl(void 0);
			} else service.setPublicBaseUrl(value.publicBaseUrl);
		}
		const enabled = value.enabled;
		if (!enabled) service.stop();
		if (disposeRoutes === void 0 && enabled) disposeRoutes = ctx.effect(() => {
			const disposers = [...routes.map((route) => ctx.webServer.register(route)), ...upgrades.map((route) => ctx.webServer.registerUpgrade(route))];
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "remote-web-ui: pairing routes");
		else if (disposeRoutes !== void 0 && !enabled) {
			disposeRoutes();
			disposeRoutes = void 0;
		}
		if (disposeSweep === void 0 && enabled) disposeSweep = ctx.effect(() => {
			const timer = setInterval(() => {
				service.sweep();
			}, SWEEP_INTERVAL_MS);
			timer.unref();
			return () => {
				clearInterval(timer);
			};
		}, "remote-web-ui: presence sweep");
		else if (disposeSweep !== void 0 && !enabled) {
			disposeSweep();
			disposeSweep = void 0;
		}
		runPostureProbe();
	};
	ctx.effect(() => ctx.on("webserver/index-inject", (table) => {
		table.push({
			kind: "script",
			placement: "head",
			text: UUID_POLYFILL_SCRIPT
		});
	}), "remote-web-ui: uuid polyfill");
	ctx.effect(() => ctx.on("webserver/index-inject", (table) => {
		const value = resolve();
		if (!value.enabled || !value.requirePairingForLan) return;
		table.push({
			kind: "script",
			placement: "head",
			text: REMOTE_CHANNEL_BOOT_SCRIPT
		});
	}), "remote-web-ui: remote channel boot patch");
	installSettingsSection(ctx, REMOTE_WEB_UI_SETTINGS_NAMESPACE, Config, config ?? {}, {
		setSource: (source) => {
			current = source;
			sync();
		},
		onChange: sync
	});
	sync();
}
/** Whether a configured public base is a parseable http(s) URL with a host. */
function isHttpUrl(value) {
	try {
		const url = new URL(value);
		return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
	} catch {
		return false;
	}
}
//#endregion
export { Config, REMOTE_WEB_UI_SETTINGS_NAMESPACE, apply, defaultDevicesFile, inject, name, pairingConfigOf };
