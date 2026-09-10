// HERMETIC regression test for the /api/usage-stats/usage 500 after the DSH
// 0.1.5 upgrade.
//
// Root cause: DSH 0.1.5's host `Session` (from @deepseek-ai/dsh-session,
// provided as ctx.sessions) no longer exposes a public `events` array — the
// durable log is private and reads go through `snapshotEvents(fromSeq,
// toSeqExclusive)` (plus the `seq` getter). The pre-0.1.5 live fold read
// `session.events.length`, which is undefined in 0.1.5 → TypeError
// "Cannot read properties of undefined (reading 'length')" → HTTP 500.
//
// This test drives collectUsage() with a faithful 0.1.5-shaped host Session
// (`events` accessor THROWS, proving the fold never touches it) and asserts
// the fold is exact, incremental, and never throws.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectUsage } from "../lib/index.js";
import { dayKey } from "../lib/usage.js";

// Hermetic cache: point DSH_HOME at a throwaway directory BEFORE import.
const scratch = mkdtempSync(join(tmpdir(), "dsh-usage-stats-livefold-"));
process.env.DSH_HOME = scratch;

const DAY = Date.UTC(2026, 8, 10, 6, 0, 0);

/**
 * Faithful 0.1.5 host `Session`: durable log behind `seq` + `snapshotEvents`,
 * NO public `events` member (any read throws → proves collectUsage never uses
 * the removed 0.1.1 API).
 */
function makeSession(id, events) {
	const log = [...events];
	return {
		id,
		get seq() {
			return log.length;
		},
		snapshotEvents(fromSeq = 0, toSeqExclusive = log.length) {
			return Object.freeze(log.slice(fromSeq, toSeqExclusive));
		},
		/** Model the host's append-only log growing with one live event. */
		append(event) {
			log.push(event);
		},
		get events() {
			throw new Error(`DSH 0.1.5 host Session has no public events member (${id})`);
		}
	};
}

const day = dayKey(DAY);
const eventsA = [
	{ seq: 0, type: "request/header", time: DAY, data: { header: { config: { provider: "deepseek", model: "deepseek-chat" } } } },
	{ seq: 1, type: "assistant/message", time: DAY, data: { turn: 1, step: 1, stream: [], message: { source: { provider: "deepseek", model: "deepseek-chat" } }, usage: { inputTokens: 100, outputTokens: 50 } } },
	{ seq: 2, type: "assistant/message", time: DAY + 1000, data: { turn: 1, step: 2, stream: [], message: { source: { provider: "deepseek", model: "deepseek-chat" } }, usage: { inputTokens: 30, outputTokens: 20, cacheReadTokens: 10 } } }
];
const sessionA = makeSession("session-live-a", eventsA);
const sessionB = makeSession("session-live-b", []); // empty log

const ctx = {
	get(name) {
		switch (name) {
			case "sessions":
				return { list: () => [sessionA, sessionB] };
			case "sessionPersistence":
				return void 0;
			default:
				return void 0;
		}
	},
	logger: { warn: (message) => console.warn(`[warn] ${message}`) }
};

let failures = 0;
function assert(condition, label) {
	if (condition) {
		console.log(`  ✓ ${label}`);
	} else {
		failures += 1;
		console.error(`  ✗ ${label}`);
	}
}

// First collection: folds both live sessions from scratch.
console.log("collectUsage #1 (full fold)");
const first = await collectUsage(ctx);
assert(first.total.inputTokens === 130, `total.inputTokens === 130 (got ${first.total.inputTokens})`);
assert(first.total.outputTokens === 70, `total.outputTokens === 70 (got ${first.total.outputTokens})`);
assert(first.total.cacheReadTokens === 10, `total.cacheReadTokens === 10 (got ${first.total.cacheReadTokens})`);
assert(first.total.cacheWriteTokens === 0, `total.cacheWriteTokens === 0 (got ${first.total.cacheWriteTokens})`);
assert(first.total.tokens === 210, `total.tokens === 210 (got ${first.total.tokens})`);
const dayEntry = first.days.find((entry) => entry.date === day);
assert(dayEntry !== void 0, `day ${day} present`);
assert(dayEntry?.models?.[0]?.model === "deepseek/deepseek-chat", `model attribution "deepseek/deepseek-chat" (got ${dayEntry?.models?.[0]?.model})`);

// Empty-log live session must not disturb the fold.
assert(first.days.length === 1, `exactly one day rendered (got ${first.days.length})`);

// Second collection: cursor already at the log end → no double counting.
console.log("collectUsage #2 (incremental, cursor at end)");
const second = await collectUsage(ctx);
assert(second.total.inputTokens === 130, `incremental: inputTokens still 130 (got ${second.total.inputTokens})`);
assert(second.total.outputTokens === 70, `incremental: outputTokens still 70 (got ${second.total.outputTokens})`);

// Third collection after appending one event → only the delta is folded.
console.log("collectUsage #3 (delta fold)");
sessionA.append({ seq: 3, type: "assistant/message", time: DAY + 2000, data: { turn: 1, step: 3, stream: [], message: { source: { provider: "deepseek", model: "deepseek-chat" } }, usage: { inputTokens: 5 } } });
const third = await collectUsage(ctx);
assert(third.total.inputTokens === 135, `delta: inputTokens 130 → 135 (got ${third.total.inputTokens})`);
assert(third.total.outputTokens === 70, `delta: outputTokens unchanged (got ${third.total.outputTokens})`);

// Defensive fallback: a session exposing only the pre-0.1.5 `events` array
// (no snapshotEvents) must still fold without throwing.
console.log("collectUsage #4 (legacy `.events` fallback)");
const legacy = {
	id: "session-legacy",
	events: [
		{ seq: 0, type: "assistant/message", time: DAY, data: { turn: 9, step: 1, stream: [], message: { source: { provider: "deepseek", model: "deepseek-chat" } }, usage: { inputTokens: 42, outputTokens: 8 } } }
	]
};
const legacyCtx = {
	get(name) { return name === "sessions" ? { list: () => [legacy] } : void 0; },
	logger: ctx.logger
};
const legacyResult = await collectUsage(legacyCtx);
assert(legacyResult.total.inputTokens === 42, `fallback: inputTokens === 42 (got ${legacyResult.total.inputTokens})`);
assert(legacyResult.total.outputTokens === 8, `fallback: outputTokens === 8 (got ${legacyResult.total.outputTokens})`);

rmSync(scratch, { recursive: true, force: true });

if (failures > 0) {
	console.error(`\nFAILED (${failures} assertion(s))`);
	process.exit(1);
}
console.log("\nPASS — live-session fold works against the DSH 0.1.5 host Session shape");