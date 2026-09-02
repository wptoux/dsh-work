import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import z from "schemastery";
import * as tar from "tar";
import { Service } from "@deepseek-ai/cordis";
//#region src/config.ts
/**
* Plugin configuration and defaults. The loader validates the schemastery
* `Config` schema from cordis.patch.yml; {@link resolveModelSyncConfig}
* applies the same defaults for direct callers.
* @module dsh-model-sync/config
*/
const DEFAULT_MIRROR = {
	source: "opencode-go",
	id: "opencode-go-live",
	api: "openai-completions",
	baseURL: "https://opencode.ai/zen/go/v1"
};
/** Loader-validated configuration schema (defaults filled by the loader). */
const Config = z.object({
	mirrors: z.array(z.object({
		source: z.string(),
		id: z.string(),
		api: z.string(),
		baseURL: z.string()
	})).default([DEFAULT_MIRROR]),
	intervalMs: z.number().min(6e4).default(36e5),
	fetchLive: z.boolean().default(true),
	timeoutMs: z.number().min(1e3).default(15e3)
});
/** Configuration defaults, applied per-field when the caller omitted a value. */
const DEFAULT_CONFIG = {
	mirrors: [DEFAULT_MIRROR],
	intervalMs: 36e5,
	fetchLive: true,
	timeoutMs: 15e3
};
/** Fill defaults for a possibly-partial configuration object. */
function resolveModelSyncConfig(config) {
	return {
		mirrors: config?.mirrors ?? [...DEFAULT_CONFIG.mirrors],
		intervalMs: config?.intervalMs ?? DEFAULT_CONFIG.intervalMs,
		fetchLive: config?.fetchLive ?? DEFAULT_CONFIG.fetchLive,
		timeoutMs: config?.timeoutMs ?? DEFAULT_CONFIG.timeoutMs
	};
}
//#endregion
//#region src/catalog-json.ts
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Flatten a pi-ai data file (`{ [api: string]: { [id: string]: entry } }`)
* into an id-keyed map. The model id is taken from the group key; a
* conflicting `entry.id` is normalized to the key. Non-object entries are
* skipped (the upstream files occasionally carry stray values); a non-object
* root or group is refused because it means the data file changed shape.
* @param raw - parsed JSON of `<provider>.json`.
* @returns catalog models by id.
* @throws TypeError when the root or a group is not a plain object.
*/
function parsePiAiCatalog(raw) {
	if (!isRecord$1(raw)) throw new TypeError("pi-ai catalog root must be an object");
	const models = /* @__PURE__ */ new Map();
	for (const [api, group] of Object.entries(raw)) {
		if (!isRecord$1(group)) throw new TypeError(`pi-ai catalog group "${api}" must be an object`);
		for (const [id, entry] of Object.entries(group)) {
			if (!isRecord$1(entry)) continue;
			models.set(id, {
				...entry,
				id
			});
		}
	}
	return models;
}
//#endregion
//#region src/registry.ts
/**
* Fetch the latest pi-ai catalog for one route from the npm registry, with a
* disk cache keyed by version. A fresh cache (< maxAgeMs) skips the network
* entirely; a still-current version skips the tarball download; otherwise the
* tarball is fetched and the one `<route>.json` data file extracted.
* @module dsh-model-sync/registry
*/
const DEFAULT_PKG = "@earendil-works/pi-ai";
const TARBALL_ENTRY_PREFIX = "package/dist/providers/data/";
/**
* Extract exactly one entry from a gzipped tarball into a string, without
* touching anything else. Returns undefined when the entry is absent or the
* archive is unreadable.
*/
async function extractTarballEntry(bytes, entryPath) {
	const dir = await mkdtemp(join(tmpdir(), "dsh-model-sync-"));
	try {
		await writeFile(join(dir, "pkg.tgz"), bytes);
		await tar.x({
			file: join(dir, "pkg.tgz"),
			cwd: dir,
			filter: (path) => path === entryPath,
			strict: false
		});
		return await readFile(join(dir, entryPath), "utf8");
	} catch {
		return;
	} finally {
		await rm(dir, {
			recursive: true,
			force: true
		});
	}
}
/** Catalog source backed by the npm registry. */
var NpmRegistryClient = class {
	cacheDirRoot;
	pkg;
	registry;
	timeoutMs;
	maxAgeMs;
	now;
	fetchImpl;
	constructor(opts) {
		this.pkg = opts.pkg ?? DEFAULT_PKG;
		this.cacheDirRoot = opts.cacheDir;
		this.registry = (opts.registry ?? "https://registry.npmjs.org").replace(/\/+$/, "");
		this.timeoutMs = opts.timeoutMs ?? 15e3;
		this.maxAgeMs = opts.maxAgeMs ?? 216e5;
		this.now = opts.now ?? Date.now;
		this.fetchImpl = opts.fetchImpl ?? fetch;
	}
	/**
	* Latest catalog for one route, or undefined when the network fetch or the
	* extraction failed (the caller keeps its last-good state).
	*/
	async fetchCatalog(route) {
		const metaPath = join(this.cacheDirRoot, `${route}.meta.json`);
		const dataPath = join(this.cacheDirRoot, `${route}.json`);
		const cache = await this.readMeta(metaPath);
		const now = this.now();
		if (cache !== void 0 && now - cache.cachedAt < this.maxAgeMs) return this.readCached(route, dataPath, cache.version);
		const latest = await this.fetchLatestMetadata();
		if (latest === void 0) {
			if (cache !== void 0) return this.readCached(route, dataPath, cache.version);
			return;
		}
		if (cache !== void 0 && cache.version === latest.version) return this.readCached(route, dataPath, latest.version);
		const tarball = await this.fetchBytes(latest.tarball);
		if (tarball === void 0) {
			if (cache !== void 0) return this.readCached(route, dataPath, cache.version);
			return;
		}
		const raw = await extractTarballEntry(tarball, `${TARBALL_ENTRY_PREFIX}${route}.json`);
		if (raw === void 0) return void 0;
		let models;
		try {
			models = parsePiAiCatalog(JSON.parse(raw));
		} catch {
			return;
		}
		await this.writeCache(route, latest.version, raw);
		return {
			version: latest.version,
			route,
			models
		};
	}
	async readMeta(path) {
		try {
			const parsed = JSON.parse(await readFile(path, "utf8"));
			if (typeof parsed.version === "string" && typeof parsed.cachedAt === "number") return {
				version: parsed.version,
				cachedAt: parsed.cachedAt
			};
			return;
		} catch {
			return;
		}
	}
	async readCached(route, dataPath, version) {
		try {
			const raw = await readFile(dataPath, "utf8");
			return {
				version,
				route,
				models: parsePiAiCatalog(JSON.parse(raw))
			};
		} catch {
			return;
		}
	}
	async writeCache(route, version, raw) {
		const dir = this.cacheDirRoot;
		await mkdir(dir, { recursive: true });
		const dataPath = join(dir, `${route}.json`);
		const metaPath = join(dir, `${route}.meta.json`);
		await writeFile(dataPath, raw);
		await writeFile(metaPath, JSON.stringify({
			version,
			cachedAt: this.now()
		}));
	}
	async fetchLatestMetadata() {
		try {
			const url = `${this.registry}/${encodeURIComponent(this.pkg)}/latest`;
			const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });
			if (!response.ok) return void 0;
			const json = await response.json();
			if (typeof json.version !== "string" || typeof json.dist?.tarball !== "string") return void 0;
			return {
				version: json.version,
				tarball: json.dist.tarball
			};
		} catch {
			return;
		}
	}
	async fetchBytes(url) {
		try {
			const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });
			if (!response.ok) return void 0;
			return new Uint8Array(await response.arrayBuffer());
		} catch {
			return;
		}
	}
};
//#endregion
//#region src/live.ts
/**
* Optional live `/models` probe. Deliberately signal-only: the reply is
* logged, never fed into the mirror list (the npm catalog carries capacities
* and reasoning metadata the listing endpoint does not disclose). Never
* throws — failures are reported to the caller for logging.
* @module dsh-model-sync/live
*/
/** Resolve a llm-pi-ai `apiKeyEnv` credential reference in the environment. */
function resolveEnvKey(apiKeyEnv) {
	if (apiKeyEnv === void 0 || apiKeyEnv.length === 0) return void 0;
	return process.env[apiKeyEnv];
}
/** Join an endpoint base with the OpenAI-compatible listing path. */
function buildLiveUrl(baseURL) {
	return `${baseURL.replace(/\/+$/, "")}/models`;
}
/** Parse an OpenAI-compatible `/models` listing body into model ids. */
function parseLiveListing(raw) {
	if (typeof raw !== "object" || raw === null) return void 0;
	const data = raw.data;
	if (!Array.isArray(data)) return void 0;
	const ids = [];
	for (const entry of data) if (typeof entry === "object" && entry !== null && typeof entry.id === "string") ids.push(entry.id);
	return ids;
}
/** Probe one provider's live listing; never throws. */
async function probeLiveModels(opts) {
	const timeoutMs = opts.timeoutMs ?? 15e3;
	const fetchImpl = opts.fetchImpl ?? fetch;
	try {
		const response = await fetchImpl(buildLiveUrl(opts.baseURL), {
			headers: opts.apiKey === void 0 ? {} : { Authorization: `Bearer ${opts.apiKey}` },
			signal: AbortSignal.timeout(timeoutMs)
		});
		if (!response.ok) return {
			ok: false,
			reason: `HTTP ${response.status}`
		};
		const ids = parseLiveListing(await response.json());
		if (ids === void 0) return {
			ok: false,
			reason: "unparseable listing"
		};
		return {
			ok: true,
			ids
		};
	} catch (error) {
		return {
			ok: false,
			reason: error instanceof Error ? error.message : String(error)
		};
	}
}
/**
* Service Definition for the user-settings capability seam (`ctx.settings`). Providers store one raw document of
* per-namespace sections; plugins register a namespace schema and read the
* resolved value, which layers schema defaults, the registrant's composition
* `base`, and the user document section, in that order.
* @module @deepseek-ai/dsh-settings
*/
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/;
/**
* Brand a raw string as a {@link SettingsNamespace}.
* @param value - candidate namespace; lowercase kebab-case, as in plugin short names.
* @returns the branded namespace.
*/
function settingsNamespace(value) {
	if (!NAMESPACE_PATTERN.test(value)) throw new TypeError(`settings namespace "${value}" must match ${String(NAMESPACE_PATTERN)}`);
	return value;
}
/**
* A write refused because the namespace moved since the caller read it. The
* Service Definition's serialized write queue orders writes; it cannot tell a fresh writer
* from one holding a stale snapshot, which is what this reports.
*/
var SettingsConflictError = class extends Error {
	/** Stable machine code for wire layers mapping this to their own taxonomy. */
	code = "SETTINGS_CONFLICT";
	/** The revision the write expected. */
	expected;
	/** The revision the namespace actually stands at. */
	actual;
	/**
	* @param ns - the namespace whose write was refused.
	* @param expected - the revision the caller sent.
	* @param actual - the revision now stored.
	*/
	constructor(ns, expected, actual) {
		super(`settings namespace "${ns}" changed since it was read (expected revision ${String(expected)}, now ${String(actual)})`);
		this.name = "SettingsConflictError";
		this.expected = expected;
		this.actual = actual;
	}
};
Service.init;
//#endregion
//#region src/translate.ts
/**
* Translation between pi-ai's catalog metadata and llm-pi-ai model-entry
* fields. llm-pi-ai's `PiAiModelProfile` accepts id/name/contextWindow/
* maxTokens/input/reasoningEfforts/compat; pi-ai's data files spell reasoning
* as `thinkingLevelMap` and compat with optional vendor fields, so both need
* a narrowing translation. Everything here is a pure function.
* @module dsh-model-sync/translate
*/
/**
* Every llm-pi-ai `PiAiCompatProfile` field the config surface offers
* (catalog.ts `COMPLETIONS_COMPAT_GATE` / `RESPONSES_COMPAT_GATE` /
* `ANTHROPIC_COMPAT_GATE` / `BEDROCK_COMPAT_GATE` dispositions of "offer").
* pi-ai's data compat entries that fall outside this list would be refused by
* llm-pi-ai's `assertOfferedCompatFields`, so mirroring filters them out.
*/
const COMPAT_OFFERED_FIELDS = [
	"supportsStore",
	"supportsDeveloperRole",
	"supportsReasoningEffort",
	"supportsUsageInStreaming",
	"maxTokensField",
	"requiresToolResultName",
	"requiresAssistantAfterToolResult",
	"requiresThinkingAsText",
	"requiresReasoningContentOnAssistantMessages",
	"thinkingFormat",
	"chatTemplateKwargs",
	"supportsStrictMode",
	"cacheControlFormat",
	"supportsLongCacheRetention",
	"supportsEagerToolInputStreaming",
	"supportsCacheControlOnTools",
	"supportsTemperature",
	"forceAdaptiveThinking",
	"allowEmptySignature",
	"supportsStrictTools"
];
/**
* Translate a pi-ai `thinkingLevelMap` into llm-pi-ai `reasoningEfforts`.
* llm-pi-ai's map semantics: each key is a selectable level and its value the
* wire spelling; only `off` may be empty. pi-ai pins unsupported levels to
* `null`, so those are dropped; `off` is dropped (models with a map always
* reason). Nothing left means the model declares no reasoning levels.
*/
function translateThinkingLevelMap(map) {
	if (map === void 0 || map === null) return void 0;
	const out = {};
	for (const [level, wire] of Object.entries(map)) {
		if (level === "off") continue;
		if (wire !== null && wire !== void 0) out[level] = wire;
	}
	return Object.keys(out).length > 0 ? out : void 0;
}
/** Request modalities llm-pi-ai accepts. */
const KNOWN_MODALITIES = /* @__PURE__ */ new Set(["text", "image"]);
/** Translate a pi-ai `input` modality list; unknown modalities are dropped. */
function translateInput(input) {
	if (input === void 0 || input.length === 0) return void 0;
	const out = input.filter((value) => KNOWN_MODALITIES.has(value));
	return out.length > 0 ? out : void 0;
}
/** Narrow a pi-ai compat block to the fields llm-pi-ai's schema offers. */
function filterCompat(compat) {
	if (compat === void 0) return void 0;
	const out = {};
	for (const field of COMPAT_OFFERED_FIELDS) if (field in compat) out[field] = compat[field];
	return Object.keys(out).length > 0 ? out : void 0;
}
//#endregion
//#region src/merge.ts
/** Spell out a full llm-pi-ai entry for one pi-ai catalog model. */
function generateEntry(model) {
	const entry = { id: model.id };
	if (model.name !== void 0) entry.name = model.name;
	if (model.contextWindow !== void 0) entry.contextWindow = model.contextWindow;
	if (model.maxTokens !== void 0) entry.maxTokens = model.maxTokens;
	const input = translateInput(model.input);
	if (input !== void 0) entry.input = input;
	entry.reasoningEfforts = translateThinkingLevelMap(model.thinkingLevelMap) ?? (model.reasoning === true ? void 0 : false);
	const compat = filterCompat(model.compat);
	if (compat !== void 0) entry.compat = compat;
	return entry;
}
/** Build the next mirror models list (see module doc for semantics). */
function buildMirrorModels(args) {
	const { previous, latest, served } = args;
	const previousIds = new Set(previous.map((entry) => entry.id));
	const servedIds = new Set(served);
	const models = [...previous];
	const added = [];
	for (const [id, model] of latest) {
		if (previousIds.has(id) || servedIds.has(id)) continue;
		models.push(generateEntry(model));
		added.push(id);
	}
	return {
		models,
		added,
		changed: JSON.stringify(models) !== JSON.stringify(previous)
	};
}
//#endregion
//#region src/sync.ts
/**
* Sync orchestration for one mirror route. Reads the current settings
* section, fetches the latest source-route catalog, merges new models into
* the mirror's models list and writes it back through the settings seam —
* llm-pi-ai's reactive section then re-materializes the route and the GUI
* refreshes on `settings/document-updated`. Never throws: every failure is
* logged and the previous state (and every live route) stays untouched.
* @module dsh-model-sync/sync
*/
/** The settings namespace llm-pi-ai owns. */
const SETTINGS_NS = settingsNamespace("llm-pi-ai");
/** Read the current revision of the llm-pi-ai section, for conflict detection. */
function currentRevision(settings) {
	for (const entry of settings.describe()) if (entry.ns === SETTINGS_NS) return entry.revision;
	return 0;
}
/**
* Match a settings-conflict error no matter which copy of dsh-settings threw
* it. The built artifact inlines its own copy of the library (tsdown pulls in
* the devDependency), so at runtime the host throws ITS SettingsConflictError
* instance and `instanceof` here is false. Both copies set the same stable
* machine code, which is what the host class carries too.
*/
function isSettingsConflict(error) {
	if (error instanceof SettingsConflictError) return true;
	if (typeof error === "object" && error !== null) return error.code === "SETTINGS_CONFLICT";
	return false;
}
/** Write ops with one conflict retry. */
async function writeOps(settings, ops) {
	for (let attempt = 0; attempt < 2; attempt += 1) try {
		await settings.mutate(SETTINGS_NS, ops, currentRevision(settings));
		return true;
	} catch (error) {
		if (isSettingsConflict(error)) continue;
		throw error;
	}
	return false;
}
/** Sync one mirror route (see module doc). */
async function syncMirror(deps, spec, opts) {
	const log = deps.log;
	try {
		const section = deps.settings.get(SETTINGS_NS);
		const source = section?.providers?.[spec.source];
		if (source === void 0) {
			log(`source route "${spec.source}" is not configured in llm-pi-ai; skipping`);
			return;
		}
		if (!new Set(deps.llm.listProviders().map((provider) => provider.id)).has(spec.source)) {
			log(`source route "${spec.source}" is not serving; skipping`);
			return;
		}
		let served = [];
		try {
			served = (await deps.llm.listModels(spec.id)).map((model) => model.id);
		} catch {
			served = [];
		}
		const latest = await deps.catalog.fetchCatalog(spec.source);
		if (latest === void 0) {
			log(`catalog fetch for "${spec.source}" failed; keeping last-good state`);
			return;
		}
		const mirror = section?.providers?.[spec.id];
		const result = buildMirrorModels({
			previous: mirror?.models ?? [],
			latest: latest.models,
			served
		});
		const needsBootstrap = mirror === void 0 || mirror.api === void 0 || mirror.baseURL === void 0;
		if (!result.changed && !needsBootstrap) {
			log(`mirror "${spec.id}" is current (${served.length} models, ${latest.version})`);
			await maybeProbe(deps, spec, source, opts);
			return;
		}
		const ops = [];
		if (mirror?.api === void 0 && spec.api !== void 0) ops.push({
			op: "set",
			path: [
				"providers",
				spec.id,
				"api"
			],
			value: spec.api
		});
		if (mirror?.baseURL === void 0 && spec.baseURL !== void 0) ops.push({
			op: "set",
			path: [
				"providers",
				spec.id,
				"baseURL"
			],
			value: spec.baseURL
		});
		if (mirror?.apiKeyEnv === void 0 && source.apiKeyEnv !== void 0) ops.push({
			op: "set",
			path: [
				"providers",
				spec.id,
				"apiKeyEnv"
			],
			value: source.apiKeyEnv
		});
		ops.push({
			op: "set",
			path: [
				"providers",
				spec.id,
				"models"
			],
			value: result.models
		});
		if (!await writeOps(deps.settings, ops)) {
			log(`settings write for "${spec.id}" conflicted twice; keeping last-good state`);
			return;
		}
		log(`mirror "${spec.id}" updated: ${result.added.length > 0 ? `+${result.added.join(", ")}` : "no new models"} (catalog ${latest.version})`);
		await maybeProbe(deps, spec, source, opts);
	} catch (error) {
		log(`sync failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
async function maybeProbe(deps, spec, _source, opts) {
	if (!opts.fetchLive || deps.probe === void 0) return;
	if (spec.baseURL === void 0) return;
	const result = await deps.probe(spec, _source.apiKeyEnv);
	if (result !== void 0 && result !== null && typeof result === "object" && "ok" in result) {
		const probe = result;
		deps.log(probe.ok ? `live /models probe: ${probe.ids?.length ?? 0} models advertised` : `live /models probe failed: ${probe.reason ?? "unknown"}`);
	}
}
//#endregion
//#region src/index.ts
/**
* dsh-model-sync host half. On startup — and again at short bounded retries,
* then every `intervalMs` — each configured mirror is synced: the latest pi-ai
* catalog for the source route is fetched (disk-cached by version), new models
* are appended to the mirror route's `models:` list in the `llm-pi-ai:`
* settings section, and llm-pi-ai's reactive section re-materializes the route
* so the GUI model picker updates without a restart. Failures are logged and
* never touch live routes.
*
* The scheduler deliberately does NOT rely on the host's `ctx.setInterval`:
* that member is a mixin of the `timer` service and is only present on
* contexts that resolved it, which is not guaranteed for profile plugins at
* apply time. A plain `setTimeout` chain with a dispose guard is robust
* everywhere. Early bounded retries cover boot-order races: `ctx.inject`
* resolves the `settings`/`llm` services the moment they exist, which can
* precede the `llm-pi-ai` plugin's own apply — at that point its settings
* section and routes are not registered yet and a first sync would skip.
*
* Every log line the sync emits is also appended to a ring buffer written to
* `<cacheDir>/status.json`, so the plugin's behavior is observable without the
* host console.
*/
/** Stable cordis plugin name. */
const name = "model-sync";
/** Early bounded retries that cover llm-pi-ai not being applied yet. */
const EARLY_RETRY_DELAYS_MS = [
	3e3,
	15e3,
	6e4
];
/** Ring-buffer size of the status.json log. */
const STATUS_LINES_LIMIT = 100;
function apply(ctx, config) {
	const resolved = resolveModelSyncConfig(config);
	ctx.inject(["settings", "llm"], (sctx) => {
		const settings = sctx.get("settings");
		if (settings === void 0) {
			sctx.logger.error("[model-sync] settings service is absent; mirror sync disabled");
			return;
		}
		const llm = sctx.llm;
		const dataRoot = sctx.baseDir ?? sctx.baseUrl ?? join(homedir(), ".dsh");
		const cacheDir = join(dataRoot, "storages", "dsh-model-sync");
		const statusPath = join(cacheDir, "status.json");
		const statusLines = [];
		let disposed = false;
		const timerIds = /* @__PURE__ */ new Set();
		const statusWriteQueued = { current: Promise.resolve() };
		/**
		* Append one line to the status ring buffer and persist it. Best-effort:
		* a failing status file never breaks the sync itself. Writes are queued so
		* bursts of log lines cannot interleave mid-file.
		*/
		const record = (line) => {
			const stamp = (/* @__PURE__ */ new Date()).toISOString();
			statusLines.push(`[${stamp}] ${line}`);
			if (statusLines.length > STATUS_LINES_LIMIT) statusLines.splice(0, statusLines.length - STATUS_LINES_LIMIT);
			const body = `${statusLines.join("\n")}\n`;
			statusWriteQueued.current = statusWriteQueued.current.catch(() => void 0).then(async () => {
				await mkdir(cacheDir, { recursive: true });
				await writeFile(statusPath, body, "utf8");
			}).catch(() => void 0);
		};
		const sctxDispose = () => {
			disposed = true;
			for (const timerId of timerIds) clearTimeout(timerId);
		};
		sctx.on("dispose", sctxDispose);
		/** Run one bound timer; no-ops after dispose. */
		const later = (callback, delayMs) => {
			if (disposed) return;
			const timerId = setTimeout(() => {
				timerIds.delete(timerId);
				if (disposed) return;
				callback();
			}, delayMs);
			timerIds.add(timerId);
		};
		const deps = {
			settings,
			llm,
			catalog: new NpmRegistryClient({
				cacheDir,
				timeoutMs: resolved.timeoutMs
			}),
			log: (message) => {
				record(message);
				sctx.logger.info(`[model-sync] ${message}`);
			},
			probe: resolved.fetchLive ? async (spec, apiKeyEnv) => {
				if (spec.baseURL === void 0) return void 0;
				return probeLiveModels({
					baseURL: spec.baseURL,
					apiKey: resolveEnvKey(apiKeyEnv),
					timeoutMs: resolved.timeoutMs
				});
			} : void 0
		};
		const run = () => {
			for (const spec of resolved.mirrors) {
				record(`syncing mirror "${spec.id}" from "${spec.source}"`);
				syncMirror(deps, spec, { fetchLive: resolved.fetchLive });
			}
		};
		const scheduleLoop = () => {
			later(() => {
				run();
				scheduleLoop();
			}, resolved.intervalMs);
		};
		record(`plugin started; mirrors: ${resolved.mirrors.map((m) => `${m.id} <- ${m.source}`).join(", ")}`);
		run();
		for (const delayMs of EARLY_RETRY_DELAYS_MS) later(run, delayMs);
		scheduleLoop();
	});
}
//#endregion
export { Config, apply, name, resolveModelSyncConfig };
