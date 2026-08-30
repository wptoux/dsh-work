# dsh-model-sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `plugins/dsh-model-sync`, a host-side dsh plugin that keeps the GUI model picker fresh: it maintains a mirror LLM route (`opencode-go-live`) whose `models:` list is synced from the latest `@earendil-works/pi-ai` catalog, written into the `llm-pi-ai:` settings section so the picker updates automatically without a restart.

**Architecture:** The plugin registers`model-sync` in the web profile bundle. On startup and then every `intervalMs`, for each configured mirror it: reads the source route profile and the mirror's current models from the settings document, fetches the latest pi-ai tarball's `<source>.json` catalog (disk-cached by version), diffs against models currently served, appends full-field entries for new models (existing entries kept verbatim — add-only), and writes the merged list plus the mirror skeleton (`apiKeyEnv` copied from the source) via `settings.mutate`. llm-pi-ai's reactive settings section then re-materializes the route and the GUI refreshes via `settings/document-updated` — no restart needed. Pure logic (parse/translate/merge/probe) lives in small modules with vitest tests; only the orchestration touches cordis `ctx`.

**Tech Stack:** TypeScript (strict, ES2024), cordis v4 (`@deepseek-ai/cordis`), schemastery (plugin config), `@deepseek-ai/dsh-settings` (SettingsProvider: `get`/`describe`/`mutate`), `@deepseek-ai/dsh-llm` (`ctx.llm.listProviders`/`listModels` — types only), npm registry + `tar` (catalog fetch), vitest + tsdown + tsc.

**Spec:** `docs/superpowers/specs/2026-08-29-dsh-model-sync-design.md` (v2 mirror-route revision, commit `652fc98`). The plan argues from the spec; executors read both.

## Global Constraints

- Do NOT modify the dsh kernel (`/usr/local/lib/node_modules/@deepseek-ai/dsh`), the official checkout (`~/deepseek-harness`), or any `@deepseek-ai/*` SDK package; no `git fetch/push` against upstream repos; push only the plugin's own repo (`wptoux/dsh-work`).
- `lib/` is a published build artifact: build from `src/` via `pnpm build` before committing; never hand-edit `lib/`.
- `node_modules/` and `*.tsbuildinfo` must not be committed (gitignore).
- Runtime dependency changes require `pnpm install` inside the plugin directory (self-managed deps).
- Commits at the repo root (`/root/dsh-work`), Conventional Commits, no emoji, `git status --short` clean before committing.
- The route written by this plugin is a hand-declared mirror route (`opencode-go-live`): route-level `api: openai-completions`, `baseURL` from config; model entries may NOT carry `api`/`baseURL` (llm-pi-ai schema forbids it).
- Settings section namespace is `llm-pi-ai`; writer must preserve all other fields and only add/modify the mirror route's own keys.
- Add-only semantics: never rewrite an existing mirror `models:` entry, never delete models; failures keep last-good and never touch live routes.
- Delivery report must note "需用户重启 DSH 服务后生效" (profile bundle wiring takes effect at boot); functional verification is the user's after-restart feedback.

---

### Task 1: Scaffold the package (build pipeline + empty plugin)

**Files:**
- Create: `plugins/dsh-model-sync/package.json`
- Create: `plugins/dsh-model-sync/tsconfig.json`
- Create: `plugins/dsh-model-sync/tsconfig.build.json`
- Create: `plugins/dsh-model-sync/tsconfig.vitest.json`
- Create: `plugins/dsh-model-sync/tsdown.config.ts`
- Create: `plugins/dsh-model-sync/vitest.config.ts`
- Create: `plugins/dsh-model-sync/.gitignore`
- Create: `plugins/dsh-model-sync/cordis.patch.yml`
- Create: `plugins/dsh-model-sync/src/index.ts` (stub)
- Create: `plugins/dsh-model-sync/tests/smoke.spec.ts`

**Interfaces:**
- Produces: package `dsh-model-sync` with `main` `lib/index.js`, `types` `lib/types/index.d.ts`, exports `.` + `./package.json`; `dsh.bundle.patch` → `./cordis.patch.yml`; cordis plugin id `model-sync`; build pipeline `pnpm build` (tsc declarations → tsdown ESM node bundle) and `pnpm test` (vitest).

- [ ] **Step 1: Write the package files**

`plugins/dsh-model-sync/package.json`:

```json
{
  "name": "dsh-model-sync",
  "description": "Keep supported LLM model lists fresh: mirrors a catalog route into a hand-declared route whose models list is synced from the latest pi-ai catalog, so the GUI model picker shows new models without a restart.",
  "version": "0.1.0",
  "type": "module",
  "packageManager": "pnpm@11.7.0",
  "engines": {
    "node": "^22.19.0 || >=24.0.0"
  },
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "lib/**/*.js",
    "lib/**/*.js.map",
    "lib/**/*.d.ts",
    "lib/**/*.d.ts.map",
    "src",
    "cordis.patch.yml"
  ],
  "license": "Apache-2.0",
  "dsh": {
    "engines": {
      "dsh": ">=0.1.1-rc.1"
    },
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
  "scripts": {
    "build": "rm -rf lib && tsc -p tsconfig.build.json && tsdown",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "schemastery": "^3.18.0",
    "tar": "^7.4.3"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1"
  },
  "peerDependenciesMeta": {
    "@deepseek-ai/cordis": {
      "optional": true
    }
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-llm": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-settings": "^0.1.1-rc.2",
    "@types/node": "^22.20.0",
    "tsdown": "^0.22.14",
    "typescript": "^6.0.3",
    "vite-tsconfig-paths": "^6.1.1",
    "vitest": "^4.1.8"
  }
}
```

`plugins/dsh-model-sync/tsconfig.json` (host-only, no DOM):

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "strict": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "lib": ["ES2024"],
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

`plugins/dsh-model-sync/tsconfig.build.json` (declarations only):

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "emitDeclarationOnly": true,
    "outDir": "lib/types"
  },
  "include": ["src"]
}
```

`plugins/dsh-model-sync/tsconfig.vitest.json` (vitest path resolution):

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

`plugins/dsh-model-sync/tsdown.config.ts`:

```ts
import type { UserConfig } from 'tsdown'

export default {
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  // build script removes lib/ before tsc; tsdown clean would wipe the
  // lib/types declarations tsc just emitted.
  clean: false,
} satisfies UserConfig
```

`plugins/dsh-model-sync/vitest.config.ts`:

```ts
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.vitest.json'] })],
  server: {
    sourcemapIgnoreList: () => true,
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    pool: 'forks',
    server: {
      deps: { inline: [/@deepseek-ai\//] },
    },
  },
})
```

`plugins/dsh-model-sync/.gitignore`:

```
node_modules/
*.tsbuildinfo
coverage/
```

`plugins/dsh-model-sync/cordis.patch.yml`:

```yaml
# dsh-model-sync bundle patch
#
# Mounts the host half of the plugin into the dsh web profile. The plugin is
# host-only: no client bundle, no dsh.client field.
- insert:
    - id: model-sync
      name: 'dsh-model-sync'
      config:
        mirrors:
          - source: opencode-go
            id: opencode-go-live
            api: openai-completions
            baseURL: https://opencode.ai/zen/go/v1
```

`plugins/dsh-model-sync/src/index.ts` (stub for the pipeline; real wiring lands in Task 9):

```ts
import type { Context } from '@deepseek-ai/cordis'

/** Stable cordis plugin name. */
export const name = 'model-sync'

/** Placeholder host half; wiring lands with the sync orchestration. */
export function apply(_ctx: Context): void {
  // no-op until Task 9
}
```

`plugins/dsh-model-sync/tests/smoke.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { name } from '../src/index.ts'

describe('plugin identity', () => {
  it('registers under the stable cordis id', () => {
    expect(name).toBe('model-sync')
  })
})
```

- [ ] **Step 2: Install dependencies**

Run (in the plugin dir):

```bash
cd /root/dsh-work/plugins/dsh-model-sync
pnpm install
```

Expected: installs devDeps (`@deepseek-ai/*`, tsdown, vitest, …) and runtime deps (schemastery, tar) into the plugin's own `node_modules`.

- [ ] **Step 3: Run tests — expect pass**

Run: `pnpm test`
Expected: `tests/smoke.spec.ts` passes (1 test).

- [ ] **Step 4: Build — expect `lib/` with index + types**

Run: `pnpm build`
Expected: `lib/index.js`, `lib/types/index.d.ts` exist; no errors.

- [ ] **Step 5: Verify host lib loads**

Run:

```bash
node -e "import('./lib/index.js').then(m => console.log(m.name))"
```

Expected: prints `model-sync`.

- [ ] **Step 6: Commit**

```bash
cd /root/dsh-work
git add plugins/dsh-model-sync
git commit -m "chore(dsh-model-sync): scaffold package with build pipeline"
```

---

### Task 2: Plugin config schema and defaults

**Files:**
- Create: `plugins/dsh-model-sync/src/config.ts`
- Test: `plugins/dsh-model-sync/tests/config.spec.ts`

**Interfaces:**
- Produces:
  - `export interface MirrorSpec { source: string; id: string; api?: string; baseURL?: string }`
  - `export interface ModelSyncConfig { mirrors: MirrorSpec[]; intervalMs: number; fetchLive: boolean; timeoutMs: number }`
  - `export const DEFAULT_CONFIG: ModelSyncConfig`
  - `export function resolveModelSyncConfig(config?: Partial<ModelSyncConfig>): ModelSyncConfig` — fills defaults per field (mirrors default to the opencode-go mirror when absent).

- [ ] **Step 1: Write the failing test**

`plugins/dsh-model-sync/tests/config.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveModelSyncConfig } from '../src/config.ts'

describe('resolveModelSyncConfig', () => {
  it('defaults to the opencode-go mirror and hourly interval', () => {
    const c = resolveModelSyncConfig()
    expect(c.mirrors).toEqual([
      { source: 'opencode-go', id: 'opencode-go-live', api: 'openai-completions', baseURL: 'https://opencode.ai/zen/go/v1' },
    ])
    expect(c.intervalMs).toBe(3_600_000)
    expect(c.fetchLive).toBe(true)
    expect(c.timeoutMs).toBe(15_000)
  })

  it('keeps user-supplied mirrors and overrides', () => {
    const c = resolveModelSyncConfig({
      mirrors: [{ source: 'deepseek', id: 'deepseek-live', api: 'openai-completions' }],
      intervalMs: 60_000,
    })
    expect(c.mirrors).toHaveLength(1)
    expect(c.mirrors[0]!.source).toBe('deepseek')
    expect(c.intervalMs).toBe(60_000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/config.spec.ts`
Expected: FAIL — `resolveModelSyncConfig` is not exported.

- [ ] **Step 3: Implement**

`plugins/dsh-model-sync/src/config.ts`:

```ts
/**
 * Plugin configuration and defaults. The loader validates the schemastery
 * `Config` schema from cordis.patch.yml; {@link resolveModelSyncConfig}
 * applies the same defaults for direct callers.
 * @module dsh-model-sync/config
 */

import z from 'schemastery'

/** One mirror: a hand-declared route whose models list stays synced to a source catalog route. */
export interface MirrorSpec {
  /** Source route id known to llm-pi-ai (its pi-ai data file is the model source). */
  source: string
  /** The mirror route id written into the llm-pi-ai settings section. */
  id: string
  /** Wire protocol for the mirror route, required when the source route is mixed-protocol. */
  api?: string
  /** Endpoint for the mirror route; falls back to the source route's baseURL. */
  baseURL?: string
}

/** Plugin configuration. */
export interface ModelSyncConfig {
  /** Mirrors to maintain, in order. */
  mirrors: MirrorSpec[]
  /** Interval between background syncs. */
  intervalMs: number
  /** Probe the provider's live /models endpoint for signal logging. */
  fetchLive: boolean
  /** Per-network-operation timeout. */
  timeoutMs: number
}

const DEFAULT_MIRROR: MirrorSpec = {
  source: 'opencode-go',
  id: 'opencode-go-live',
  api: 'openai-completions',
  baseURL: 'https://opencode.ai/zen/go/v1',
}

/** Loader-validated configuration schema (defaults filled by the loader). */
export const Config = z.object({
  mirrors: z.array(z.object({
    source: z.string(),
    id: z.string(),
    api: z.string().optional(),
    baseURL: z.string().optional(),
  })).default([DEFAULT_MIRROR]),
  intervalMs: z.number().min(60_000).default(3_600_000),
  fetchLive: z.boolean().default(true),
  timeoutMs: z.number().min(1_000).default(15_000),
})

/** Configuration defaults, applied per-field when the caller omitted a value. */
export const DEFAULT_CONFIG: ModelSyncConfig = {
  mirrors: [DEFAULT_MIRROR],
  intervalMs: 3_600_000,
  fetchLive: true,
  timeoutMs: 15_000,
}

/** Fill defaults for a possibly-partial configuration object. */
export function resolveModelSyncConfig(config?: Partial<ModelSyncConfig>): ModelSyncConfig {
  return {
    mirrors: config?.mirrors ?? [...DEFAULT_CONFIG.mirrors],
    intervalMs: config?.intervalMs ?? DEFAULT_CONFIG.intervalMs,
    fetchLive: config?.fetchLive ?? DEFAULT_CONFIG.fetchLive,
    timeoutMs: config?.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/config.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /root/dsh-work
git add plugins/dsh-model-sync/src/config.ts plugins/dsh-model-sync/tests/config.spec.ts
git commit -m "feat(dsh-model-sync): add config schema and defaults"
```

---

### Task 3: pi-ai catalog JSON parsing

**Files:**
- Create: `plugins/dsh-model-sync/src/catalog-json.ts`
- Create: `plugins/dsh-model-sync/tests/fixtures/opencode-go.sample.json`
- Test: `plugins/dsh-model-sync/tests/catalog-json.spec.ts`

**Interfaces:**
- Produces:
  - `export interface PiAiModelJson { id: string; name?: string; api?: string; baseUrl?: string; reasoning?: boolean; input?: readonly string[]; contextWindow?: number; maxTokens?: number; thinkingLevelMap?: Record<string, string | null> | null; compat?: Record<string, unknown> }`
  - `export function parsePiAiCatalog(raw: unknown): Map<string, PiAiModelJson>` — input is the pi-ai data file shape `{ [api: string]: { [id: string]: PiAiModelJson } }`; flattens to id → entry (id from the group key); throws `TypeError` on a non-object root or group; skips non-object entries.

- [ ] **Step 1: Write the fixture**

`plugins/dsh-model-sync/tests/fixtures/opencode-go.sample.json`:

```json
{
  "openai-completions": {
    "alpha-1": {
      "id": "alpha-1",
      "name": "Alpha One",
      "api": "openai-completions",
      "baseUrl": "https://opencode.ai/zen/go/v1",
      "reasoning": true,
      "input": ["text"],
      "contextWindow": 1000000,
      "maxTokens": 384000,
      "compat": { "supportsStore": false, "thinkingFormat": "deepseek" },
      "thinkingLevelMap": { "minimal": null, "high": "high", "max": "max" }
    },
    "alpha-2": {
      "id": "alpha-2",
      "api": "openai-completions",
      "baseUrl": "https://opencode.ai/zen/go/v1",
      "reasoning": false,
      "input": ["text", "image"],
      "contextWindow": 262144,
      "maxTokens": 32768
    }
  },
  "openai-responses": {
    "beta-1": {
      "id": "beta-1",
      "name": "Beta One",
      "api": "openai-responses",
      "baseUrl": "https://opencode.ai/zen/go/v1",
      "reasoning": true,
      "input": ["text"],
      "contextWindow": 524288,
      "maxTokens": 65536,
      "thinkingLevelMap": { "off": null, "low": "low" }
    }
  },
  "anthropic-messages": {
    "not-an-object": "garbage"
  }
}
```

- [ ] **Step 2: Write the failing tests**

`plugins/dsh-model-sync/tests/catalog-json.spec.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parsePiAiCatalog } from '../src/catalog-json.ts'

const fixture = async () => {
  const dir = fileURLToPath(new URL('.', import.meta.url))
  return JSON.parse(await readFile(join(dir, 'fixtures/opencode-go.sample.json'), 'utf8')) as unknown
}

describe('parsePiAiCatalog', () => {
  it('flattens per-api groups into an id-keyed map', async () => {
    const models = parsePiAiCatalog(await fixture())
    expect([...models.keys()]).toEqual(['alpha-1', 'alpha-2', 'beta-1'])
    expect(models.get('alpha-1')).toMatchObject({ id: 'alpha-1', api: 'openai-completions', contextWindow: 1_000_000 })
    expect(models.get('beta-1')?.api).toBe('openai-responses')
  })

  it('skips non-object entries but keeps the rest', async () => {
    const models = parsePiAiCatalog(await fixture())
    expect(models.size).toBe(3)
  })

  it('throws on a non-object root', () => {
    expect(() => parsePiAiCatalog(null)).toThrow(TypeError)
    expect(() => parsePiAiCatalog([])).toThrow(TypeError)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run tests/catalog-json.spec.ts`
Expected: FAIL — `parsePiAiCatalog` is not exported.

- [ ] **Step 4: Implement**

`plugins/dsh-model-sync/src/catalog-json.ts`:

```ts
/**
 * One model entry as pi-ai's generated data files describe it (per-api group,
 * keyed by model id). Field names match the pi-ai JSON; the plugin reads only
 * the fields it mirrors into llm-pi-ai model entries.
 * @module dsh-model-sync/catalog-json
 */

export interface PiAiModelJson {
  id: string
  name?: string
  api?: string
  baseUrl?: string
  reasoning?: boolean
  input?: readonly string[]
  contextWindow?: number
  maxTokens?: number
  thinkingLevelMap?: Record<string, string | null> | null
  compat?: Record<string, unknown>
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
export function parsePiAiCatalog(raw: unknown): Map<string, PiAiModelJson> {
  if (!isRecord(raw)) throw new TypeError('pi-ai catalog root must be an object')
  const models = new Map<string, PiAiModelJson>()
  for (const [api, group] of Object.entries(raw)) {
    if (!isRecord(group)) throw new TypeError(`pi-ai catalog group "${api}" must be an object`)
    for (const [id, entry] of Object.entries(group)) {
      if (!isRecord(entry)) continue
      models.set(id, { ...entry, id } as unknown as PiAiModelJson)
    }
  }
  return models
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/catalog-json.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
cd /root/dsh-work
git add plugins/dsh-model-sync/src/catalog-json.ts plugins/dsh-model-sync/tests/catalog-json.spec.ts plugins/dsh-model-sync/tests/fixtures
git commit -m "feat(dsh-model-sync): parse pi-ai provider data files"
```

---

### Task 4: Field translation (thinking levels, modalities, compat)

**Files:**
- Create: `plugins/dsh-model-sync/src/translate.ts`
- Test: `plugins/dsh-model-sync/tests/translate.spec.ts`

**Interfaces:**
- Produces:
  - `export const COMPAT_OFFERED_FIELDS: readonly string[]` — every llm-pi-ai `PiAiCompatProfile` field the config surface offers (see below).
  - `export function translateThinkingLevelMap(map: Record<string, string | null> | null | undefined): Record<string, string> | undefined` — drops `null` values and `off`; returns `undefined` when nothing remains (an empty/absent map declares no reasoning levels).
  - `export function translateInput(input: readonly string[] | undefined): ('text' | 'image')[] | undefined` — keeps only `text`/`image`; `undefined`/empty → `undefined`.
  - `export function filterCompat(compat: Record<string, unknown> | undefined): Record<string, unknown> | undefined` — keeps only `COMPAT_OFFERED_FIELDS` keys; `undefined` when none remain.

- [ ] **Step 1: Write the failing tests**

`plugins/dsh-model-sync/tests/translate.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { COMPAT_OFFERED_FIELDS, filterCompat, translateInput, translateThinkingLevelMap } from '../src/translate.ts'

describe('translateThinkingLevelMap', () => {
  it('drops null wire values and off', () => {
    expect(translateThinkingLevelMap({ minimal: null, high: 'high', max: 'max' })).toEqual({ high: 'high', max: 'max' })
  })

  it('returns undefined for absent or empty maps', () => {
    expect(translateThinkingLevelMap(undefined)).toBeUndefined()
    expect(translateThinkingLevelMap(null)).toBeUndefined()
    expect(translateThinkingLevelMap({ off: null })).toBeUndefined()
  })
})

describe('translateInput', () => {
  it('keeps text and image only', () => {
    expect(translateInput(['text', 'image'])).toEqual(['text', 'image'])
    expect(translateInput(['text', 'video'])).toEqual(['text'])
  })

  it('returns undefined for absent or empty input', () => {
    expect(translateInput(undefined)).toBeUndefined()
    expect(translateInput([])).toBeUndefined()
  })
})

describe('filterCompat', () => {
  it('keeps only offered fields', () => {
    const out = filterCompat({ supportsStore: false, thinkingFormat: 'deepseek', openRouterRouting: true })
    expect(out).toEqual({ supportsStore: false, thinkingFormat: 'deepseek' })
  })

  it('returns undefined when nothing is offered', () => {
    expect(filterCompat({ openRouterRouting: true })).toBeUndefined()
    expect(filterCompat(undefined)).toBeUndefined()
  })

  it('offers the fields llm-pi-ai accepts', () => {
    expect(COMPAT_OFFERED_FIELDS).toContain('supportsStore')
    expect(COMPAT_OFFERED_FIELDS).toContain('thinkingFormat')
    expect(COMPAT_OFFERED_FIELDS).toContain('maxTokensField')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/translate.spec.ts`
Expected: FAIL — module not exported.

- [ ] **Step 3: Implement**

`plugins/dsh-model-sync/src/translate.ts`:

```ts
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
export const COMPAT_OFFERED_FIELDS: readonly string[] = [
  'supportsStore',
  'supportsDeveloperRole',
  'supportsReasoningEffort',
  'supportsUsageInStreaming',
  'maxTokensField',
  'requiresToolResultName',
  'requiresAssistantAfterToolResult',
  'requiresThinkingAsText',
  'requiresReasoningContentOnAssistantMessages',
  'thinkingFormat',
  'chatTemplateKwargs',
  'supportsStrictMode',
  'cacheControlFormat',
  'supportsLongCacheRetention',
  'supportsEagerToolInputStreaming',
  'supportsCacheControlOnTools',
  'supportsTemperature',
  'forceAdaptiveThinking',
  'allowEmptySignature',
  'supportsStrictTools',
]

/**
 * Translate a pi-ai `thinkingLevelMap` into llm-pi-ai `reasoningEfforts`.
 * llm-pi-ai's map semantics: each key is a selectable level and its value the
 * wire spelling; only `off` may be empty. pi-ai pins unsupported levels to
 * `null`, so those are dropped; `off` is dropped (models with a map always
 * reason). Nothing left means the model declares no reasoning levels.
 */
export function translateThinkingLevelMap(
  map: Record<string, string | null> | null | undefined,
): Record<string, string> | undefined {
  if (map === undefined || map === null) return undefined
  const out: Record<string, string> = {}
  for (const [level, wire] of Object.entries(map)) {
    if (level === 'off') continue
    if (wire !== null && wire !== undefined) out[level] = wire
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Request modalities llm-pi-ai accepts. */
const KNOWN_MODALITIES = new Set(['text', 'image'])

/** Translate a pi-ai `input` modality list; unknown modalities are dropped. */
export function translateInput(input: readonly string[] | undefined): ('text' | 'image')[] | undefined {
  if (input === undefined || input.length === 0) return undefined
  const out = input.filter((value): value is 'text' | 'image' => KNOWN_MODALITIES.has(value))
  return out.length > 0 ? out : undefined
}

/** Narrow a pi-ai compat block to the fields llm-pi-ai's schema offers. */
export function filterCompat(compat: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (compat === undefined) return undefined
  const out: Record<string, unknown> = {}
  for (const field of COMPAT_OFFERED_FIELDS) {
    if (field in compat) out[field] = compat[field]
  }
  return Object.keys(out).length > 0 ? out : undefined
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/translate.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd /root/dsh-work
git add plugins/dsh-model-sync/src/translate.ts plugins/dsh-model-sync/tests/translate.spec.ts
git commit -m "feat(dsh-model-sync): translate pi-ai metadata into llm-pi-ai entry fields"
```

---

### Task 5: Mirror model list merging

**Files:**
- Create: `plugins/dsh-model-sync/src/merge.ts`
- Test: `plugins/dsh-model-sync/tests/merge.spec.ts`

**Interfaces:**
- Consumes: `PiAiModelJson` (Task 3), `translateThinkingLevelMap`/`translateInput`/`filterCompat` (Task 4).
- Produces:
  - `export interface ModelEntry { id: string; name?: string; contextWindow?: number; maxTokens?: number; input?: readonly string[]; reasoningEfforts?: false | Record<string, string>; compat?: Record<string, unknown>; [key: string]: unknown }`
  - `export function generateEntry(model: PiAiModelJson): ModelEntry` — full-field entry for one pi-ai model (spread passthrough for extra fields; `reasoningEfforts: false` when the model does not reason and has no map; input/compat/efforts omitted when undefined).
  - `export interface BuildMirrorModelsArgs { previous: readonly ModelEntry[]; latest: Map<string, PiAiModelJson>; served: readonly string[] }`
  - `export interface BuildMirrorModelsResult { models: ModelEntry[]; added: string[]; changed: boolean }`
  - `export function buildMirrorModels(args: BuildMirrorModelsArgs): BuildMirrorModelsResult` — previous entries kept VERBATIM (add-only, user edits preserved); then `latest` ids neither present in previous nor served are appended as generated entries; `changed` compares against `previous` by JSON.

- [ ] **Step 1: Write the failing tests**

`plugins/dsh-model-sync/tests/merge.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildMirrorModels, generateEntry, type ModelEntry } from '../src/merge.ts'
import type { PiAiModelJson } from '../src/catalog-json.ts'

const alpha1: PiAiModelJson = {
  id: 'alpha-1',
  name: 'Alpha One',
  api: 'openai-completions',
  baseUrl: 'https://opencode.ai/zen/go/v1',
  reasoning: true,
  input: ['text'],
  contextWindow: 1_000_000,
  maxTokens: 384_000,
  compat: { supportsStore: false, thinkingFormat: 'deepseek', openRouterRouting: true },
  thinkingLevelMap: { minimal: null, high: 'high', max: 'max' },
}

const beta1: PiAiModelJson = {
  id: 'beta-1',
  api: 'openai-responses',
  baseUrl: 'https://opencode.ai/zen/go/v1',
  reasoning: false,
  input: ['text', 'image'],
  contextWindow: 524_288,
  maxTokens: 65_536,
}

describe('generateEntry', () => {
  it('spells out the llm-pi-ai entry fields from pi-ai metadata', () => {
    const entry = generateEntry(alpha1)
    expect(entry).toMatchObject({
      id: 'alpha-1',
      name: 'Alpha One',
      contextWindow: 1_000_000,
      maxTokens: 384_000,
      input: ['text'],
      reasoningEfforts: { high: 'high', max: 'max' },
      compat: { supportsStore: false, thinkingFormat: 'deepseek' },
    })
    expect(entry.compat).not.toHaveProperty('openRouterRouting')
  })

  it('declares non-reasoning models without efforts but keeps modalities', () => {
    const entry = generateEntry(beta1)
    expect(entry.reasoningEfforts).toBe(false)
    expect(entry.input).toEqual(['text', 'image'])
  })
})

describe('buildMirrorModels', () => {
  const latest = new Map([['alpha-1', alpha1], ['beta-1', beta1], ['gamma-1', { id: 'gamma-1', api: 'openai-completions', baseUrl: 'x', input: ['text'], contextWindow: 1000, maxTokens: 100 }]])

  it('keeps previous entries verbatim and appends only genuinely new models', () => {
    const previous: ModelEntry[] = [
      { id: 'alpha-1', name: 'Alpha One Customised', contextWindow: 999 },
      { id: 'custom-0', name: 'User Gateway Model', contextWindow: 4096, maxTokens: 1024 },
    ]
    const result = buildMirrorModels({ previous, latest, served: ['alpha-1', 'custom-0'] })
    expect(result.models[0]).toBe(previous[0])
    expect(result.models[1]).toBe(previous[1])
    expect(result.models.map(m => m.id)).toEqual(['alpha-1', 'custom-0', 'beta-1', 'gamma-1'])
    expect(result.added).toEqual(['beta-1', 'gamma-1'])
    expect(result.changed).toBe(true)
  })

  it('reports no change when new ids are already served', () => {
    const previous = [generateEntry(alpha1), generateEntry(beta1)]
    const result = buildMirrorModels({ previous, latest, served: ['alpha-1', 'beta-1'] })
    expect(result.changed).toBe(false)
    expect(result.added).toEqual([])
  })

  it('does not duplicate an id present in previous and latest', () => {
    const previous = [generateEntry(alpha1)]
    const result = buildMirrorModels({ previous, latest, served: ['alpha-1'] })
    expect(result.models.filter(m => m.id === 'alpha-1')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/merge.spec.ts`
Expected: FAIL — module not exported.

- [ ] **Step 3: Implement**

`plugins/dsh-model-sync/src/merge.ts`:

```ts
/**
 * Build the mirror route's `models:` list. Add-only semantics: every existing
 * entry is kept verbatim (it may carry a user's manual correction or a prior
 * sync's fields — rewriting it would lose that intent), and only ids present
 * in the latest catalog but absent from both the previous list and the
 * currently served set are appended as generated full-field entries.
 * @module dsh-model-sync/merge
 */

import type { PiAiModelJson } from './catalog-json.ts'
import { filterCompat, translateInput, translateThinkingLevelMap } from './translate.ts'

/** One entry of a llm-pi-ai `models:` list (PiAiModelProfile-compatible). */
export interface ModelEntry {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: readonly string[]
  reasoningEfforts?: false | Record<string, string>
  compat?: Record<string, unknown>
  [key: string]: unknown
}

/** Spell out a full llm-pi-ai entry for one pi-ai catalog model. */
export function generateEntry(model: PiAiModelJson): ModelEntry {
  const entry: ModelEntry = { id: model.id }
  if (model.name !== undefined) entry.name = model.name
  if (model.contextWindow !== undefined) entry.contextWindow = model.contextWindow
  if (model.maxTokens !== undefined) entry.maxTokens = model.maxTokens
  const input = translateInput(model.input)
  if (input !== undefined) entry.input = input
  const efforts = translateThinkingLevelMap(model.thinkingLevelMap)
  entry.reasoningEfforts = efforts ?? (model.reasoning === true ? undefined : false)
  const compat = filterCompat(model.compat)
  if (compat !== undefined) entry.compat = compat
  return entry
}

export interface BuildMirrorModelsArgs {
  /** Current mirror models list from the settings document. */
  previous: readonly ModelEntry[]
  /** Latest catalog for the source route, by model id. */
  latest: Map<string, PiAiModelJson>
  /** Model ids the mirror route currently serves (ctx.llm.listModels). */
  served: readonly string[]
}

export interface BuildMirrorModelsResult {
  /** The next models list (previous order, then new ids in catalog order). */
  models: ModelEntry[]
  /** New model ids appended by this build. */
  added: string[]
  /** Whether the list differs from `previous`. */
  changed: boolean
}

/** Build the next mirror models list (see module doc for semantics). */
export function buildMirrorModels(args: BuildMirrorModelsArgs): BuildMirrorModelsResult {
  const { previous, latest, served } = args
  const previousIds = new Set(previous.map(entry => entry.id))
  const servedIds = new Set(served)
  const models: ModelEntry[] = [...previous]
  const added: string[] = []
  for (const [id, model] of latest) {
    if (previousIds.has(id) || servedIds.has(id)) continue
    models.push(generateEntry(model))
    added.push(id)
  }
  const changed = JSON.stringify(models) !== JSON.stringify(previous)
  return { models, added, changed }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/merge.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /root/dsh-work
git add plugins/dsh-model-sync/src/merge.ts plugins/dsh-model-sync/tests/merge.spec.ts
git commit -m "feat(dsh-model-sync): merge latest catalog into mirror models list"
```

---

### Task 6: Registry client (fetch + cache + tarball extraction)

**Files:**
- Create: `plugins/dsh-model-sync/src/registry.ts`
- Test: `plugins/dsh-model-sync/tests/registry.spec.ts`
- Test data: no fixtures — the extract test builds a tarball on the fly with the `tar` package.

**Interfaces:**
- Consumes: `parsePiAiCatalog`, `PiAiModelJson` (Task 3).
- Produces:
  - `export interface LatestCatalog { version: string; route: string; models: Map<string, PiAiModelJson> }`
  - `export class NpmRegistryClient` with constructor `(opts: { cacheDir: string; pkg?: string; registry?: string; timeoutMs?: number; maxAgeMs?: number; now?: () => number; fetchImpl?: typeof fetch })` and method `async fetchCatalog(route: string): Promise<LatestCatalog | undefined>` (undefined only on fetch/parse failure).
  - `export function extractTarballEntry(bytes: Uint8Array, entryPath: string): Promise<string | undefined>`
  - Cache layout: `cacheDir/<route>.json` (parsed catalog) + `cacheDir/<route>.meta.json` (`{ version, cachedAt }`); valid while `now - cachedAt < maxAgeMs` (default 6h) — then no network at all; a still-current version also skips the tarball download.

- [ ] **Step 1: Write the failing tests**

`plugins/dsh-model-sync/tests/registry.spec.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as tar from 'tar'
import { extractTarballEntry, NpmRegistryClient } from '../src/registry.ts'
import { parsePiAiCatalog } from '../src/catalog-json.ts'

const sampleCatalog = {
  'openai-completions': {
    'alpha-1': { id: 'alpha-1', api: 'openai-completions', baseUrl: 'https://example.test/v1', input: ['text'], contextWindow: 1000, maxTokens: 100 },
  },
}

function fakeFetch(results: Map<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const body = results.get(url)
    if (body === undefined) throw new Error(`unexpected fetch: ${url}`)
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
}

describe('extractTarballEntry', () => {
  it('extracts a single entry from a gzipped tarball', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-model-sync-test-'))
    try {
      await tar.c({ gzip: true, file: join(dir, 'pkg.tgz'), cwd: dir }, ['package/dist/providers/data/opencode-go.json'])
      await writeFile(join(dir, 'package/dist/providers/data/opencode-go.json'), JSON.stringify(sampleCatalog))
      const bytes = await readFile(join(dir, 'pkg.tgz'))
      const out = await extractTarballEntry(new Uint8Array(bytes), 'package/dist/providers/data/opencode-go.json')
      expect(JSON.parse(out!)).toEqual(sampleCatalog)
      expect(await extractTarballEntry(new Uint8Array(bytes), 'package/not-there.json')).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('NpmRegistryClient', () => {
  const registry = 'https://registry.npmjs.org'
  const pkg = '@earendil-works/pi-ai'
  const metaUrl = `${registry}/@earendil-works%2Fpi-ai/latest` // encodeURIComponent('@earendil-works/pi-ai')
  const tgzUrl = `${registry}/@earendil-works/pi-ai/-/pi-ai-9.9.9.tgz`

  it('downloads on a cold cache and serves the parsed catalog', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'dsh-model-sync-cache-'))
    try {
      const bytes = await makeTgz()
      const results = new Map<string, unknown>([
        [metaUrl, { version: '9.9.9', dist: { tarball: tgzUrl } }],
        [String(tgzUrl), bytes],
      ])
      const client = new NpmRegistryClient({ cacheDir, pkg, registry, fetchImpl: fakeFetch(results) })
      const catalog = await client.fetchCatalog('opencode-go')
      expect(catalog?.version).toBe('9.9.9')
      expect(catalog?.models.get('alpha-1')?.contextWindow).toBe(1000)
      // Cache files landed.
      await expect(readFile(join(cacheDir, 'opencode-go.meta.json'), 'utf8')).resolves.toContain('9.9.9')
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('serves the cache without network while fresh', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'dsh-model-sync-cache-'))
    try {
      await writeFile(join(cacheDir, 'opencode-go.json'), JSON.stringify(Object.fromEntries(parsePiAiCatalog(sampleCatalog))))
      await writeFile(join(cacheDir, 'opencode-go.meta.json'), JSON.stringify({ version: '8.8.8', cachedAt: 5_000 }))
      let calls = 0
      const fetchImpl = (async (): Promise<Response> => {
        calls += 1
        throw new Error('network must not be used')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any as typeof fetch
      const client = new NpmRegistryClient({ cacheDir, pkg, registry, fetchImpl, now: () => 10_000, maxAgeMs: 60_000 })
      const catalog = await client.fetchCatalog('opencode-go')
      expect(calls).toBe(0)
      expect(catalog?.version).toBe('8.8.8')
      expect(catalog?.models.get('alpha-1')?.id).toBe('alpha-1')
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('returns undefined on network failure', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'dsh-model-sync-cache-'))
    try {
      const fetchImpl = (async (): Promise<Response> => {
        throw new Error('offline')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any as typeof fetch
      const client = new NpmRegistryClient({ cacheDir, pkg, registry, fetchImpl, maxAgeMs: 0 })
      expect(await client.fetchCatalog('opencode-go')).toBeUndefined()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })
})

async function makeTgz(): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-model-sync-tgz-'))
  try {
    const entry = 'package/dist/providers/data/opencode-go.json'
    await writeFile(join(dir, entry), JSON.stringify(sampleCatalog))
    await tar.c({ gzip: true, file: join(dir, 'pkg.tgz'), cwd: dir }, [entry])
    return new Uint8Array(await readFile(join(dir, 'pkg.tgz')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
```

Note: `makeTgz` writes the file path then packs only that entry; `tar.c` with `cwd` packs paths relative to `cwd`, so the entry lands at `package/dist/providers/data/opencode-go.json` inside the archive.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/registry.spec.ts`
Expected: FAIL — module not exported.

- [ ] **Step 3: Implement**

`plugins/dsh-model-sync/src/registry.ts`:

```ts
/**
 * Fetch the latest pi-ai catalog for one route from the npm registry, with a
 * disk cache keyed by version. A fresh cache (< maxAgeMs) skips the network
 * entirely; a still-current version skips the tarball download; otherwise the
 * tarball is fetched and the one `<route>.json` data file extracted.
 * @module dsh-model-sync/registry
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tar from 'tar'
import { parsePiAiCatalog, type PiAiModelJson } from './catalog-json.ts'

export interface LatestCatalog {
  version: string
  route: string
  models: Map<string, PiAiModelJson>
}

const DEFAULT_PKG = '@earendil-works/pi-ai'
const TARBALL_ENTRY_PREFIX = 'package/dist/providers/data/'

/**
 * Extract exactly one entry from a gzipped tarball into a string, without
 * touching anything else. Returns undefined when the entry is absent or the
 * archive is unreadable.
 */
export async function extractTarballEntry(bytes: Uint8Array, entryPath: string): Promise<string | undefined> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-model-sync-'))
  try {
    await writeFile(join(dir, 'pkg.tgz'), bytes)
    await tar.x({ file: join(dir, 'pkg.tgz'), cwd: dir, filter: (path) => path === entryPath, strict: false })
    return await readFile(join(dir, entryPath), 'utf8')
  } catch {
    return undefined
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export interface NpmRegistryClientOptions {
  /** Directory holding the per-route cache files (created on demand). */
  cacheDir: string
  /** npm package whose catalog is fetched. */
  pkg?: string
  /** Registry base URL. */
  registry?: string
  /** Timeout applied to every fetch. */
  timeoutMs?: number
  /** Cache freshness window; a fresh cache skips the network entirely. */
  maxAgeMs?: number
  /** Clock injection for tests. */
  now?: () => number
  /** Fetch injection for tests. */
  fetchImpl?: typeof fetch
}

/** Catalog source backed by the npm registry. */
export class NpmRegistryClient {
  private readonly cacheDirRoot: string
  private readonly pkg: string
  private readonly registry: string
  private readonly timeoutMs: number
  private readonly maxAgeMs: number
  private readonly now: () => number
  private readonly fetchImpl: typeof fetch

  constructor(opts: NpmRegistryClientOptions) {
    this.pkg = opts.pkg ?? DEFAULT_PKG
    this.cacheDirRoot = join(opts.cacheDir, this.pkg)
    this.registry = (opts.registry ?? 'https://registry.npmjs.org').replace(/\/+$/, '')
    this.timeoutMs = opts.timeoutMs ?? 15_000
    this.maxAgeMs = opts.maxAgeMs ?? 6 * 3_600_000
    this.now = opts.now ?? Date.now
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  /**
   * Latest catalog for one route, or undefined when the network fetch or the
   * extraction failed (the caller keeps its last-good state).
   */
  async fetchCatalog(route: string): Promise<LatestCatalog | undefined> {
    const metaPath = join(this.cacheDirRoot, `${route}.meta.json`)
    const dataPath = join(this.cacheDirRoot, `${route}.json`)
    const cache = await this.readMeta(metaPath)
    const now = this.now()
    if (cache !== undefined && now - cache.cachedAt < this.maxAgeMs) {
      return this.readCached(route, dataPath, cache.version)
    }
    const latest = await this.fetchLatestMetadata()
    if (latest === undefined) {
      if (cache !== undefined) return this.readCached(route, dataPath, cache.version)
      return undefined
    }
    if (cache !== undefined && cache.version === latest.version) {
      return this.readCached(route, dataPath, latest.version)
    }
    const tarball = await this.fetchBytes(latest.tarball)
    if (tarball === undefined) {
      if (cache !== undefined) return this.readCached(route, dataPath, cache.version)
      return undefined
    }
    const raw = await extractTarballEntry(tarball, `${TARBALL_ENTRY_PREFIX}${route}.json`)
    if (raw === undefined) return undefined
    await this.writeCache(route, latest.version, raw)
    return { version: latest.version, route, models: parsePiAiCatalog(JSON.parse(raw) as unknown) }
  }

  private async readMeta(path: string): Promise<{ version: string; cachedAt: number } | undefined> {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as { version?: unknown; cachedAt?: unknown }
      if (typeof parsed.version === 'string' && typeof parsed.cachedAt === 'number') {
        return { version: parsed.version, cachedAt: parsed.cachedAt }
      }
      return undefined
    } catch {
      return undefined
    }
  }

  private async readCached(route: string, dataPath: string, version: string): Promise<LatestCatalog | undefined> {
    try {
      const raw = await readFile(dataPath, 'utf8')
      return { version, route, models: parsePiAiCatalog(JSON.parse(raw) as unknown) }
    } catch {
      return undefined
    }
  }

  private async writeCache(route: string, version: string, raw: string): Promise<void> {
    const dir = this.cacheDirRoot
    await mkdir(dir, { recursive: true })
    const dataPath = join(dir, `${route}.json`)
    const metaPath = join(dir, `${route}.meta.json`)
    await writeFile(dataPath, raw)
    await writeFile(metaPath, JSON.stringify({ version, cachedAt: this.now() }))
  }

  private async fetchLatestMetadata(): Promise<{ version: string; tarball: string } | undefined> {
    try {
      const url = `${this.registry}/${encodeURIComponent(this.pkg)}/latest`
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) })
      if (!response.ok) return undefined
      const json = (await response.json()) as { version?: unknown; dist?: { tarball?: unknown } }
      if (typeof json.version !== 'string' || typeof json.dist?.tarball !== 'string') return undefined
      return { version: json.version, tarball: json.dist.tarball }
    } catch {
      return undefined
    }
  }

  private async fetchBytes(url: string): Promise<Uint8Array | undefined> {
    try {
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) })
      if (!response.ok) return undefined
      return new Uint8Array(await response.arrayBuffer())
    } catch {
      return undefined
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/registry.spec.ts`
Expected: PASS (3 tests). If `tar.c` fixture extraction differs on this platform, adjust only the test's pack step (paths), not the client logic.

- [ ] **Step 5: Commit**

```bash
cd /root/dsh-work
git add plugins/dsh-model-sync/src/registry.ts plugins/dsh-model-sync/tests/registry.spec.ts
git commit -m "feat(dsh-model-sync): cache-aware npm registry catalog client"
```

---

### Task 7: Live /models probe

**Files:**
- Create: `plugins/dsh-model-sync/src/live.ts`
- Test: `plugins/dsh-model-sync/tests/live.spec.ts`

**Interfaces:**
- Produces:
  - `export function resolveEnvKey(apiKeyEnv: string | undefined): string | undefined`
  - `export function buildLiveUrl(baseURL: string): string` — `${baseURL.replace(/\/+$/, '')}/models`
  - `export function parseLiveListing(raw: unknown): string[] | undefined` — OpenAI `/models` shape `{ data: [{ id }] }`; undefined when not parseable.
  - `export async function probeLiveModels(opts: { baseURL: string; apiKey?: string; timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<{ ok: true; ids: string[] } | { ok: false; reason: string }>` — used only for signal logging; never throws.

- [ ] **Step 1: Write the failing tests**

`plugins/dsh-model-sync/tests/live.spec.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { buildLiveUrl, parseLiveListing, probeLiveModels, resolveEnvKey } from '../src/live.ts'

describe('resolveEnvKey', () => {
  const before = process.env.MS_TEST_KEY
  afterEach(() => {
    if (before === undefined) delete process.env.MS_TEST_KEY
    else process.env.MS_TEST_KEY = before
  })

  it('resolves the referenced environment variable', () => {
    process.env.MS_TEST_KEY = 'sekret'
    expect(resolveEnvKey('MS_TEST_KEY')).toBe('sekret')
    expect(resolveEnvKey(undefined)).toBeUndefined()
    expect(resolveEnvKey('MISSING_MS_KEY')).toBeUndefined()
  })
})

describe('buildLiveUrl', () => {
  it('appends /models without doubling slashes', () => {
    expect(buildLiveUrl('https://opencode.ai/zen/go/v1')).toBe('https://opencode.ai/zen/go/v1/models')
    expect(buildLiveUrl('https://opencode.ai/zen/go/v1/')).toBe('https://opencode.ai/zen/go/v1/models')
  })
})

describe('parseLiveListing', () => {
  it('extracts ids from the OpenAI listing shape', () => {
    expect(parseLiveListing({ data: [{ id: 'a' }, { id: 'b' }] })).toEqual(['a', 'b'])
    expect(parseLiveListing({ data: [{ id: 'a' }, { name: 'b' }] })).toEqual(['a'])
  })

  it('returns undefined for unparseable bodies', () => {
    expect(parseLiveListing(null)).toBeUndefined()
    expect(parseLiveListing({ data: 'nope' })).toBeUndefined()
  })
})

describe('probeLiveModels', () => {
  it('returns ids on success', async () => {
    const probe = await probeLiveModels({
      baseURL: 'https://opencode.ai/zen/go/v1',
      apiKey: 'k',
      fetchImpl: (async () => new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 })) as typeof fetch,
    })
    expect(probe).toEqual({ ok: true, ids: ['m1'] })
  })

  it('reports refusal instead of throwing', async () => {
    const probe = await probeLiveModels({
      baseURL: 'https://opencode.ai/zen/go/v1',
      fetchImpl: (async () => { throw new Error('offline') }) as typeof fetch,
    })
    expect(probe.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/live.spec.ts`
Expected: FAIL — module not exported.

- [ ] **Step 3: Implement**

`plugins/dsh-model-sync/src/live.ts`:

```ts
/**
 * Optional live `/models` probe. Deliberately signal-only: the reply is
 * logged, never fed into the mirror list (the npm catalog carries capacities
 * and reasoning metadata the listing endpoint does not disclose). Never
 * throws — failures are reported to the caller for logging.
 * @module dsh-model-sync/live
 */

/** Resolve a llm-pi-ai `apiKeyEnv` credential reference in the environment. */
export function resolveEnvKey(apiKeyEnv: string | undefined): string | undefined {
  if (apiKeyEnv === undefined || apiKeyEnv.length === 0) return undefined
  return process.env[apiKeyEnv]
}

/** Join an endpoint base with the OpenAI-compatible listing path. */
export function buildLiveUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/models`
}

/** Parse an OpenAI-compatible `/models` listing body into model ids. */
export function parseLiveListing(raw: unknown): string[] | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const data = (raw as { data?: unknown }).data
  if (!Array.isArray(data)) return undefined
  const ids: string[] = []
  for (const entry of data) {
    if (typeof entry === 'object' && entry !== null && typeof (entry as { id?: unknown }).id === 'string') {
      ids.push((entry as { id: string }).id)
    }
  }
  return ids
}

export type LiveProbeResult = { ok: true; ids: string[] } | { ok: false; reason: string }

export interface LiveProbeOptions {
  baseURL: string
  apiKey?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

/** Probe one provider's live listing; never throws. */
export async function probeLiveModels(opts: LiveProbeOptions): Promise<LiveProbeResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000
  const fetchImpl = opts.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(buildLiveUrl(opts.baseURL), {
      headers: opts.apiKey === undefined ? {} : { Authorization: `Bearer ${opts.apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` }
    const ids = parseLiveListing(await response.json())
    if (ids === undefined) return { ok: false, reason: 'unparseable listing' }
    return { ok: true, ids }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/live.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /root/dsh-work
git add plugins/dsh-model-sync/src/live.ts plugins/dsh-model-sync/tests/live.spec.ts
git commit -m "feat(dsh-model-sync): live /models probe for signal logging"
```

---

### Task 8: Sync orchestration

**Files:**
- Create: `plugins/dsh-model-sync/src/sync.ts`
- Test: `plugins/dsh-model-sync/tests/sync.spec.ts`

**Interfaces:**
- Consumes: `MirrorSpec` (Task 2), `buildMirrorModels`/`generateEntry` (Task 5), `NpmRegistryClient` type (Task 6), `probeLiveModels`/`resolveEnvKey` (Task 7), `settingsNamespace` and `SettingsConflictError` from `@deepseek-ai/dsh-settings`.
- Produces:
  - `export const SETTINGS_NS = settingsNamespace('llm-pi-ai')`
  - Structural types for the seams:
    ```ts
    export interface SettingsLike {
      get(ns: unknown): unknown
      describe(): ReadonlyArray<{ ns: unknown; revision: number }>
      mutate(ns: unknown, ops: ReadonlyArray<{ op: 'set' | 'unset'; path: readonly string[]; value?: unknown }>, expectedRevision?: number): Promise<void>
    }
    export interface LlmLike {
      listProviders(): ReadonlyArray<{ id: string }>
      listModels(provider: string): Promise<readonly { id: string }[]>
    }
    export interface CatalogLike {
      fetchCatalog(route: string): Promise<{ version: string; models: Map<string, PiAiModelJson> } | undefined>
    }
    ```
  - `export interface SyncDeps { settings: SettingsLike; llm: LlmLike; catalog: CatalogLike; log: (message: string) => void; probe?: (spec: MirrorSpec, apiKeyEnv?: string) => Promise<unknown> }`
  - `export async function syncMirror(deps: SyncDeps, spec: MirrorSpec, opts: { fetchLive: boolean }): Promise<void>` — never throws (all failures logged); steps:
    1. read the `llm-pi-ai` section; missing source route → log and return.
    2. source route must be among `llm.listProviders()`; else log and return.
    3. `served` = ids from `llm.listModels(spec.id)` (catch → `[]`).
    4. `latest` = `catalog.fetchCatalog(spec.source)`; undefined → log and return.
    5. `previous` = mirror profile `models` (or `[]`).
    6. `result = buildMirrorModels({ previous, latest: latest.models, served })`.
    7. skip write when `!result.changed` AND the mirror profile already exists AND `spec.api === undefined` is false — i.e. write when `changed || mirror missing || mirror lacks api`:
       - build ops: always `set providers.<id>.api = spec.api`, `set providers.<id>.baseURL = spec.baseURL`, and when the mirror profile lacks `apiKeyEnv` and the source has one, `set providers.<id>.apiKeyEnv = source.apiKeyEnv`; then `set providers.<id>.models = result.models`.
    8. `mutate` with the current revision from `describe()`; on `SettingsConflictError`, re-read revision and retry once.
    9. when `opts.fetchLive` and `deps.probe` and a `baseURL` exists, probe and log the id count (or the failure reason).

- [ ] **Step 1: Write the failing tests**

`plugins/dsh-model-sync/tests/sync.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SettingsConflictError, syncMirror, SETTINGS_NS, type CatalogLike, type LlmLike, type SettingsLike } from '../src/sync.ts'

const spec = { source: 'opencode-go', id: 'opencode-go-live', api: 'openai-completions', baseURL: 'https://opencode.ai/zen/go/v1' }
const tarballModels = new Map<string, { id: string; api?: string; baseUrl?: string; input?: string[]; contextWindow?: number; maxTokens?: number }>([
  ['alpha-1', { id: 'alpha-1', api: 'openai-completions', baseUrl: spec.baseURL!, input: ['text'], contextWindow: 1000, maxTokens: 100 }],
  ['beta-1', { id: 'beta-1', api: 'openai-completions', baseUrl: spec.baseURL!, input: ['text'], contextWindow: 2000, maxTokens: 200 }],
])

function makeDeps(overrides: Partial<{
  section: unknown
  providers: string[]
  served: string[]
  previous: unknown[]
  catalog: unknown
}> = {}) {
  const state = {
    section: overrides.section ?? { providers: { [spec.source]: { apiKeyEnv: 'OPENCODE_GO_API_KEY' } } },
    providers: overrides.providers ?? [spec.source],
    served: overrides.served ?? [],
    previous: overrides.previous ?? [],
    ops: [] as { op: string; path: string[]; value?: unknown }[],
    revision: 1,
  }
  const settings: SettingsLike = {
    get: () => state.section,
    describe: () => [{ ns: SETTINGS_NS, revision: state.revision }],
    mutate: async (_ns, ops, expectedRevision) => {
      if (expectedRevision !== undefined && expectedRevision !== state.revision) {
        throw new SettingsConflictError('conflict')
      }
      for (const op of ops) {
        state.ops.push({ op: op.op, path: [...op.path], value: (op as { value?: unknown }).value })
        if (op.op === 'set' && op.path[0] === 'providers' && op.path[2] === 'models' && Array.isArray(op.value)) {
          state.previous = op.value
        }
      }
      state.revision += 1
    },
  }
  const llm: LlmLike = {
    listProviders: () => state.providers.map(id => ({ id })),
    listModels: async (provider) => (provider === spec.id ? state.served.map(id => ({ id })) : []),
  }
  const catalog: CatalogLike = { fetchCatalog: async () => ({ version: '9.9.9', models: tarballModels }) }
  const logs: string[] = []
  return { state, settings, llm, catalog, logs }
}

describe('syncMirror', () => {
  it('bootstraps a missing mirror route with skeleton + models', async () => {
    const { state, settings, llm, catalog, logs } = makeDeps()
    await syncMirror({ settings, llm, catalog, log: m => logs.push(m) }, spec, { fetchLive: false })
    const setOps = state.ops.filter(o => o.op === 'set')
    expect(setOps.map(o => o.path.join('.'))).toEqual([
      'providers.opencode-go-live.api',
      'providers.opencode-go-live.baseURL',
      'providers.opencode-go-live.apiKeyEnv',
      'providers.opencode-go-live.models',
    ])
    expect((setOps[3]!.value as { id: string }[]).map(m => m.id)).toEqual(['alpha-1', 'beta-1'])
  })

  it('skips when nothing changed and the mirror already exists', async () => {
    const { state, settings, llm, catalog, logs } = makeDeps({
      section: {
        providers: {
          [spec.source]: { apiKeyEnv: 'OPENCODE_GO_API_KEY' },
          [spec.id]: { api: spec.api, baseURL: spec.baseURL, apiKeyEnv: 'OPENCODE_GO_API_KEY', models: [
            { id: 'alpha-1', contextWindow: 1000 },
            { id: 'beta-1', contextWindow: 2000 },
          ] },
        },
      },
      served: ['alpha-1', 'beta-1'],
      previous: [{ id: 'alpha-1', contextWindow: 1000 }, { id: 'beta-1', contextWindow: 2000 }],
    })
    await syncMirror({ settings, llm, catalog, log: m => logs.push(m) }, spec, { fetchLive: false })
    expect(state.ops).toHaveLength(0)
  })

  it('skips when the source route is not serving', async () => {
    const { state, settings, llm, catalog, logs } = makeDeps({ providers: [] })
    await syncMirror({ settings, llm, catalog, log: m => logs.push(m) }, spec, { fetchLive: false })
    expect(state.ops).toHaveLength(0)
    expect(logs.join('\n')).toContain('not serving')
  })

  it('appends only genuinely new models', async () => {
    const { state, settings, llm, catalog, logs } = makeDeps({
      section: {
        providers: {
          [spec.source]: { apiKeyEnv: 'OPENCODE_GO_API_KEY' },
          [spec.id]: { api: spec.api, baseURL: spec.baseURL, apiKeyEnv: 'OPENCODE_GO_API_KEY', models: [{ id: 'alpha-1', contextWindow: 1000 }] },
        },
      },
      served: ['alpha-1'],
      previous: [{ id: 'alpha-1', contextWindow: 1000 }],
    })
    await syncMirror({ settings, llm, catalog, log: m => logs.push(m) }, spec, { fetchLive: false })
    const modelsOp = state.ops.find(o => o.path.join('.').endsWith('models') && o.op === 'set')
    expect((modelsOp!.value as { id: string }[]).map(m => m.id)).toEqual(['alpha-1', 'beta-1'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/sync.spec.ts`
Expected: FAIL — module not exported (and `SettingsConflictError` is defined locally in the test; see Step 3's import note).

- [ ] **Step 3: Implement**

`plugins/dsh-model-sync/src/sync.ts`:

```ts
/**
 * Sync orchestration for one mirror route. Reads the current settings
 * section, fetches the latest source-route catalog, merges new models into
 * the mirror's models list and writes it back through the settings seam —
 * llm-pi-ai's reactive section then re-materializes the route and the GUI
 * refreshes on `settings/document-updated`. Never throws: every failure is
 * logged and the previous state (and every live route) stays untouched.
 * @module dsh-model-sync/sync
 */

import { SettingsConflictError, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { PiAiModelJson } from './catalog-json.ts'
import { buildMirrorModels, type ModelEntry } from './merge.ts'
import type { MirrorSpec } from './config.ts'

/** The settings namespace llm-pi-ai owns. */
export const SETTINGS_NS = settingsNamespace('llm-pi-ai')

/** Minimal settings-seam surface the sync needs. */
export interface SettingsLike {
  get(ns: unknown): unknown
  describe(): ReadonlyArray<{ ns: unknown; revision: number }>
  mutate(ns: unknown, ops: ReadonlyArray<{ op: 'set' | 'unset'; path: readonly string[]; value?: unknown }>, expectedRevision?: number): Promise<void>
}

/** Minimal llm-registry surface the sync needs. */
export interface LlmLike {
  listProviders(): ReadonlyArray<{ id: string }>
  listModels(provider: string): Promise<readonly { id: string }[]>
}

/** Minimal catalog-source surface the sync needs. */
export interface CatalogLike {
  fetchCatalog(route: string): Promise<{ version: string; models: Map<string, PiAiModelJson> } | undefined>
}

export interface SyncDeps {
  settings: SettingsLike
  llm: LlmLike
  catalog: CatalogLike
  log: (message: string) => void
  /** Optional live probe; result is logged only. */
  probe?: (spec: MirrorSpec, apiKeyEnv?: string) => Promise<unknown>
}

interface Op { op: 'set' | 'unset'; path: readonly string[]; value?: unknown }

interface MirrorProfile {
  apiKeyEnv?: string
  api?: string
  baseURL?: string
  models?: readonly ModelEntry[]
  [key: string]: unknown
}

/** Read the current revision of the llm-pi-ai section, for conflict detection. */
function currentRevision(settings: SettingsLike): number {
  for (const entry of settings.describe()) {
    if (entry.ns === SETTINGS_NS) return entry.revision
  }
  return 0
}

/** Write ops with one conflict retry. */
async function writeOps(settings: SettingsLike, ops: Op[]): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await settings.mutate(SETTINGS_NS, ops, currentRevision(settings))
      return true
    } catch (error) {
      if (error instanceof SettingsConflictError) continue
      throw error
    }
  }
  return false
}

/** Sync one mirror route (see module doc). */
export async function syncMirror(deps: SyncDeps, spec: MirrorSpec, opts: { fetchLive: boolean }): Promise<void> {
  const log = deps.log
  const section = deps.settings.get(SETTINGS_NS) as { providers?: Record<string, MirrorProfile> } | undefined
  const source = section?.providers?.[spec.source]
  if (source === undefined) {
    log(`source route "${spec.source}" is not configured in llm-pi-ai; skipping`)
    return
  }
  const serving = new Set(deps.llm.listProviders().map(provider => provider.id))
  if (!serving.has(spec.source)) {
    log(`source route "${spec.source}" is not currently serving; skipping`)
    return
  }
  let served: string[] = []
  try {
    served = (await deps.llm.listModels(spec.id)).map(model => model.id)
  } catch {
    served = []
  }
  const latest = await deps.catalog.fetchCatalog(spec.source)
  if (latest === undefined) {
    log(`catalog fetch for "${spec.source}" failed; keeping last-good state`)
    return
  }
  const mirror = section?.providers?.[spec.id]
  const previous: readonly ModelEntry[] = mirror?.models ?? []
  const result = buildMirrorModels({ previous, latest: latest.models, served })

  const needsBootstrap = mirror === undefined || mirror.api === undefined || mirror.baseURL === undefined
  if (!result.changed && !needsBootstrap) {
    log(`mirror "${spec.id}" is current (${served.length} models, ${latest.version})`)
    await maybeProbe(deps, spec, source, opts)
    return
  }
  const ops: Op[] = []
  if (spec.api !== undefined) ops.push({ op: 'set', path: ['providers', spec.id, 'api'], value: spec.api })
  if (spec.baseURL !== undefined) ops.push({ op: 'set', path: ['providers', spec.id, 'baseURL'], value: spec.baseURL })
  if (mirror?.apiKeyEnv === undefined && source.apiKeyEnv !== undefined) {
    ops.push({ op: 'set', path: ['providers', spec.id, 'apiKeyEnv'], value: source.apiKeyEnv })
  }
  ops.push({ op: 'set', path: ['providers', spec.id, 'models'], value: result.models })
  const written = await writeOps(deps.settings, ops)
  if (!written) {
    log(`settings write for "${spec.id}" conflicted twice; keeping last-good state`)
    return
  }
  log(`mirror "${spec.id}" updated: ${result.added.length > 0 ? `+${result.added.join(', ')}` : 'no new models'} (catalog ${latest.version})`)
  await maybeProbe(deps, spec, source, opts)
}

async function maybeProbe(
  deps: SyncDeps,
  spec: MirrorSpec,
  _source: MirrorProfile,
  opts: { fetchLive: boolean },
): Promise<void> {
  if (!opts.fetchLive || deps.probe === undefined) return
  if (spec.baseURL === undefined) return
  const result = await deps.probe(spec, _source.apiKeyEnv)
  if (result !== undefined && typeof result === 'object' && 'ok' in result) {
    const probe = result as { ok: boolean; ids?: string[]; reason?: string }
    deps.log(probe.ok
      ? `live /models probe: ${probe.ids?.length ?? 0} models advertised`
      : `live /models probe failed: ${probe.reason ?? 'unknown'}`)
  }
}

// Re-export the conflict type so callers and tests share the same class.
export { SettingsConflictError }
```

(The `probe` function supplied by Task 9's entry point implements live probing with `probeLiveModels`/`resolveEnvKey` from `./live.ts`; `syncMirror` itself only receives it through `deps.probe` and never imports those helpers.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/sync.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /root/dsh-work
git add plugins/dsh-model-sync/src/sync.ts plugins/dsh-model-sync/tests/sync.spec.ts
git commit -m "feat(dsh-model-sync): sync one mirror route through the settings seam"
```

---

### Task 9: Plugin entry point wiring

**Files:**
- Modify: `plugins/dsh-model-sync/src/index.ts`
- Test: `plugins/dsh-model-sync/tests/sync.spec.ts` (unchanged) — this task validates via typecheck + build + host-load; no new unit tests.

**Interfaces:**
- Consumes: `resolveModelSyncConfig`/`ModelSyncConfig` (Task 2), `NpmRegistryClient` (Task 6), `syncMirror`/`SyncDeps` (Task 8), `probeLiveModels`/`resolveEnvKey` (Task 7).
- Produces: cordis plugin `model-sync` whose `apply(ctx, config?)` runs one sync per mirror on startup and then every `intervalMs` via `ctx.setInterval`, all inside `ctx.inject(['settings', 'llm'], …)`.

- [ ] **Step 1: Implement the entry point**

Replace `plugins/dsh-model-sync/src/index.ts`:

```ts
/**
 * dsh-model-sync host half. On startup and then every `intervalMs`, each
 * configured mirror is synced: the latest pi-ai catalog for the source route
 * is fetched (disk-cached by version), new models are appended to the mirror
 * route's `models:` list in the `llm-pi-ai:` settings section, and llm-pi-ai's
 * reactive section re-materializes the route so the GUI model picker updates
 * without a restart. Failures are logged and never touch live routes.
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Config, resolveModelSyncConfig, type MirrorSpec, type ModelSyncConfig } from './config.ts'
import { NpmRegistryClient } from './registry.ts'
import { probeLiveModels, resolveEnvKey } from './live.ts'
import { syncMirror, type SyncDeps } from './sync.ts'

/** Stable cordis plugin name. */
export const name = 'model-sync'

export { Config, resolveModelSyncConfig, type ModelSyncConfig, type MirrorSpec }

export function apply(ctx: Context, config?: ModelSyncConfig): void {
  const resolved = resolveModelSyncConfig(config)
  ctx.inject(['settings', 'llm'], (sctx) => {
    const settings = sctx.get('settings')
    if (settings === undefined) {
      sctx.logger.error('[model-sync] settings service is absent; mirror sync disabled')
      return
    }
    const llm = sctx.llm
    const catalog = new NpmRegistryClient({
      cacheDir: join(sctx.baseDir, 'storages', 'dsh-model-sync'),
      timeoutMs: resolved.timeoutMs,
    })
    const deps: SyncDeps = {
      settings,
      llm,
      catalog,
      log: (message) => sctx.logger.info(`[model-sync] ${message}`),
      probe: resolved.fetchLive
        ? async (spec: MirrorSpec, apiKeyEnv?: string) => {
            if (spec.baseURL === undefined) return undefined
            return probeLiveModels({
              baseURL: spec.baseURL,
              apiKey: resolveEnvKey(apiKeyEnv),
              timeoutMs: resolved.timeoutMs,
            })
          }
        : undefined,
    }
    const run = (): void => {
      for (const spec of resolved.mirrors) {
        sctx.logger.info(`[model-sync] syncing mirror "${spec.id}" from "${spec.source}"`)
        void syncMirror(deps, spec, { fetchLive: resolved.fetchLive })
      }
    }
    void run()
    sctx.setInterval(run, resolved.intervalMs)
  })
}
```

Notes: `ctx.inject` waits for the `settings` and `llm` services; `sctx.baseDir` is cordis's data directory (`~/.dsh` on this deployment); `Config` is the schemastery schema exported by `src/config.ts` (Task 2), re-exported here for the loader.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. Fix stragglers:
- `sctx.llm` typing comes from `@deepseek-ai/dsh-llm`'s Context augmentation (devDependency); if the augmentation is missing, add `import type {} from '@deepseek-ai/dsh-llm'` at the top of `src/index.ts`.
- If the schemastery `Config` schema's defaults do not match `resolveModelSyncConfig`'s, align them (the loader applies schema defaults; `resolveModelSyncConfig` covers direct callers).

- [ ] **Step 3: Build + host-load**

Run:

```bash
pnpm build
node -e "import('./lib/index.js').then(m => console.log(m.name))"
```

Expected: build succeeds; prints `model-sync`.

- [ ] **Step 4: Commit**

```bash
cd /root/dsh-work
git add plugins/dsh-model-sync/src/index.ts plugins/dsh-model-sync/src/sync.ts
git commit -m "feat(dsh-model-sync): wire sync scheduling into the plugin entry"
```

---

### Task 10: README, wiki wiring, and full verification

**Files:**
- Create: `plugins/dsh-model-sync/README.md`
- Modify: `/root/.dsh/profiles/web/package.json` (runtime wiring, outside the repo — do it manually, not via git)
- Modify: `/root/.dsh/profiles/web/pnpm-lock.yaml` (via `pnpm install` in the profile directory)

**Interfaces:**
- Consumes: the finished package from Tasks 1–9.
- Produces: installable documentation; the profile bundle gains `dsh-model-sync`.

- [ ] **Step 1: Write README.md**

`plugins/dsh-model-sync/README.md`:

```markdown
# dsh-model-sync

让 GUI 模型选择器的模型列表保持最新，无需重启、不改内核。

## 原理

内核的 `dsh-llm-pi-ai`（pi-ai 适配器）为 catalog 路由（如 `opencode-go`）提供的是
**pi-ai 发版日的静态模型快照**，且明确不做运行时刷新。本插件维护一条**手写声明镜像
路由**（默认 `opencode-go-live`）：定时（默认 1h）拉取最新 `@earendil-works/pi-ai`
npm 包里的 `<source>.json` 目录（按版本磁盘缓存），把其中「镜像当前尚未服务」的新模型
以全字段条目标加到镜像路由的 `models:` 列表，经 `llm-pi-ai:` 设置段写回。llm-pi-ai
对设置段是响应式的，`settings/document-updated` 会让 GUI 选择器自动刷新——写入即生效。
现有条目永不重写、只增不删；任何一步失败保留 last-good，不影响任何在用路由。

## 配置（cordis.patch.yml 的 insert.config）

```yaml
config:
  mirrors:
    - source: opencode-go
      id: opencode-go-live
      api: openai-completions
      baseURL: https://opencode.ai/zen/go/v1
  intervalMs: 3600000
  fetchLive: true
  timeoutMs: 15000
```

- `mirrors[].source`：llm-pi-ai 已服务的 catalog 路由（模型数据源）。
- `mirrors[].id`：镜像路由 id（写入 settings 的路由键）。
- `mirrors[].api` / `baseURL`：镜像路由的协议与端点。源路由为混合协议时必须显式
  给出（llm-pi-ai 的 model 条目不能携带 api/baseURL）。
- `intervalMs`：同步间隔（默认 1h）；启动时先同步一次。
- `fetchLive`：额外探测 `GET {baseURL}/models`，仅记日志（不上生产）。

## 注意

- 镜像路由统一走配置的 `api`（默认 `openai-completions`）。原目录中少数走
  anthropic/responses 协议的模型经镜像路由被重排到 completions：若网关不接受会
  报错，其余模型不受影响——首次使用请先实测。
- 原路由（`opencode-go`）保持原样，供既有会话与默认模型继续使用；新模型出现在
  镜像分组。默认模型可在「设置 → 模型」里切到镜像路由。
- 写入的 `models:` 列表由插件托管；卸载插件后列表保留、镜像路由继续可用。
- 需要 dsh 重启才加载插件本体（profile bundle 在启动时组装）；生效后同步无需
  重启。

## 验证

`pnpm build` + `pnpm test`；`node -e "import('./lib/index.js')"` 可加载。
```

- [ ] **Step 2: Wire into the profile**

Edit `/root/.dsh/profiles/web/package.json`:

- dependencies: add `"dsh-model-sync": "link:../../../dsh-work/plugins/dsh-model-sync"`
- `dsh.profile.bundles`: add `"dsh-model-sync"` after `"dsh-ui-tweaks"`

Then run in the profile directory:

```bash
cd /root/.dsh/profiles/web && pnpm install
```

Expected: `node_modules/dsh-model-sync` appears as a symlink; lockfile updated; no errors.

- [ ] **Step 3: Full verification**

Run:

```bash
cd /root/dsh-work/plugins/dsh-model-sync && pnpm test
cd /root/dsh-work/plugins/dsh-model-sync && pnpm build
node -e "require('/root/dsh-work/plugins/dsh-model-sync/lib/index.js')"   # ESM: use import() if this fails
dsh --profile web --dump-config
cd /root/dsh-work && git status --short
```

Expected: tests pass; build clean; lib loads; `--dump-config` shows the layer stack without errors (read-only, no service restart); `git status --short` lists only intended files (no `node_modules/`, no `*.tsbuildinfo`).

- [ ] **Step 4: Commit**

```bash
cd /root/dsh-work
git add plugins/dsh-model-sync/README.md
git status --short   # confirm clean beyond README
git commit -m "docs(dsh-model-sync): add usage and maintenance README"
```

- [ ] **Step 5: Delivery note**

In the final report, state: profile wiring (`link:` dep + bundle entry) is done; the plugin takes effect only after the user restarts the dsh service; functional verification (new models appearing in the picker under `opencode-go-live`, a test turn on a synced model) is the user's after-restart step. Do NOT restart dsh yourself.