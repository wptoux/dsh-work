# dsh-model-sync 设计文档（模型列表实时保鲜）

日期：2026-08-29
状态：已获用户批准（决策见下）

## 背景与目标

`dsh` 内核通过 `@deepseek-ai/dsh-llm-pi-ai`（`@earendil-works/pi-ai` 适配器）为
`opencode-go`（OpenCode Zen Go）等路由提供模型列表，但该列表是 **pi-ai 发版日的静态
快照**：已核实本机内核锁 pi-ai 0.82.1（2026-07-25），npm 最新 0.84.4（2026-08-28），
opencode-go 目录 16 → 25 个模型，缺 `glm-5.3`、`qwen3.8-max`、`grok-4.6`、
`deepseek-v4-flash-vision-exp` 等至少 9 个新模型。内核侧无任何运行时刷新
（`llm-pi-ai/src/provider.ts` 明确丢弃 pi-ai 的动态 refresh；`discovery.ts` 对 catalog
路由不走网络）。

目标：**不修改内核**的前提下，让 GUI 模型选择器展示的列表保持最新——定时把「最新
pi-ai 目录中、当前尚未安装」的模型写回 settings，利用现成的响应式链路自动生效。

用户已确认的决策：

1. **方案**：写回式保鲜（方案 A），不做真·每次展示实时查（方案 B 留作升级项）。
2. **触发器**：启动即同步 + 定时（默认 1 小时）；不做手动入口（本版）。
3. **落点**：独立新包 `plugins/dsh-model-sync`（不放 `dsh-ui-tweaks`，理由：
   ui-tweaks 是纯客户端 UI 包、host 半边刻意 no-op、零 runtime 依赖、职责与依赖面
   都会被打脏）。
4. **数据源**：最新 pi-ai npm 包为准（可认领模型）；live `/models` 端点仅作感知
   信号记日志，不生产模型数据。

## 实证约束（决定设计的六个事实）

| 事实 | 证据 | 结论 |
|---|---|---|
| `modelOverrides` 拒绝未入目录的模型 | `llm-pi-ai/src/catalog.ts` `if (!defaults.has(id)) invalid(...'modelOverrides names X, which the installed catalog does not describe')` | 新模型只能写 **`models:` 全量列表** |
| `models:` 列表条目 `{id}` 即可继承已装条目 | `catalog.ts` 物化时 `...base` spread 打底，条目字段逐个覆盖 | 已装模型条目写成 `{id}` 最小形态 |
| opencode-go 路由跨 3 种 wire 协议、provider 无 baseUrl | 0.82.1 数据：`openai-completions`/`openai-responses`/`anthropic-messages` 混布，模型各自带 `baseUrl: https://opencode.ai/zen/go/v1` | 新模型条目**必须自带 `api` 与 `baseURL`**（路由级 default 无法推导） |
| llm-pi-ai 的 models 条目无 `thinkingLevelMap` 直通 | `PiAiModelProfile` 只收 `reasoningEfforts`（level→wire 字典） | 需把 pi-ai JSON 的 `thinkingLevelMap` 翻译成 `reasoningEfforts`（null 项剔除） |
| settings 服务可编程写 | `ctx.get('settings')`（`dsh-settings` `SettingsProvider`）暴露 `get` / `mutate(ns, pathOps)` / `describe`(revision)；llm-pi-ai 已 `installSettingsSection('llm-pi-ai', …)` 响应式监听 | host 插件可安全写入并触发联动刷新，无需重启 |
| 「当前服务模型」可从公共 seam 读取 | `buildModelCatalog` → `ctx.llm.listModels(route)` 每次现查 | 同步前读它作事实源，不依赖插件自身 pi-ai 版本 |

附带结论：npm registry 可达（本会话已实测 `npm pack @earendil-works/pi-ai@0.84.4`
成功）；内核 pi-ai 0.82.1 的 opencode-go 数据 JSON 已逐条核对。

## 目标形态

插件配置（`cordis.patch.yml` 的 `insert.config`，可缺省）：

```yaml
- insert:
    - id: model-sync
      name: 'dsh-model-sync'
      config:
        routes: ['opencode-go']   # llm-pi-ai catalog 路由白名单
        intervalMs: 3600000       # 定时同步间隔
        fetchLive: true           # 探测 live /models，仅记日志
        timeoutMs: 15000          # 单次网络操作超时
```

## 数据流（每次同步）

1. **读现状**：`settings.get('llm-pi-ai')` 取 `providers.<route>` 段（保留
   `apiKeyEnv`、用户手写条目等未触及字段）。
2. **读事实**：`ctx.llm.listModels(route)` 取选择器当前实际服务的模型 id 集合。
3. **取最新目录**：`npm pack` 最新 `@earendil-works/pi-ai`（带本地缓存：版本 +
   目录 hash + 时间戳，避免高频打 npm registry），解包读
   `package/dist/providers/data/<route>.json`，按 api 分组展平为 `Map<id, 条目>`。
4. **diff**：`new = latest ∖ installed`。
5. **拼装**：`merged = [{id} for installed] + [新模型全字段条目] + [用户手写且两源
   都没有的条目原样保留]`。新模型条目字段：`id`、`name`、`api`、`baseURL`、
   `contextWindow`、`maxTokens`、`input`、`reasoningEfforts`（由 `thinkingLevelMap`
   翻译、null 剔除）、`compat`（仅透传 llm-pi-ai 接受字段，防
   `assertOfferedCompatFields` 拒绝）。缺 `api`/`baseURL` 的目录条目跳过并记日志。
6. **写入**：与现有 `models:` 深度对比（`deepEqualJson`），有变化才
   `settings.mutate('llm-pi-ai', [{op:'set', path:['providers',route,'models'],
   value: merged}], expectedRevision)`；`SettingsConflictError` 冲突则重读重试一次。
7. **失败策略**：任何一步失败只记日志、保留 last-good，绝不触碰现有路由。

联动链路（已核实）：`settings.mutate` → llm-pi-ai `installSettingsSection.onChange`
→ 重物化路由与目录 → `settings/document-updated` → GUI `ModelDirectory` 自动刷新。
**无需重启。**

## 组件与文件清单

```
plugins/dsh-model-sync/
├── package.json          # name=dsh-model-sync；scripts: build(typecheck+tsdown)/test
│                         # dsh.bundle.patch 指向 cordis.patch.yml
├── cordis.patch.yml      # dsh.bundle.patch：insert model-sync 行（含 config 缺省）
├── tsconfig.json / tsconfig.build.json   # 仿 dsh-ui-tweaks（tsc -b）
├── tsdown.config.ts      # host 包（无 client bundle）
├── .gitignore            # node_modules/、*.tsbuildinfo（lib/ 入库）
├── src/
│   ├── index.ts          # cordis 插件入口：name='model-sync'；首同步 + ctx.setInterval
│   ├── config.ts         # schemastery schema：routes/intervalMs/fetchLive/timeoutMs
│   ├── sync.ts           # 编排：读 settings → listModels → tarball → diff → 拼装 → mutate
│   ├── catalog-json.ts   # npm registry/tarball 获取、解包、<route>.json 展平（带缓存）
│   ├── translate.ts      # thinkingLevelMap→reasoningEfforts；compat 字段过滤
│   └── live.ts           # 可选 live /models 探测（信号日志，无 key 则跳过）
├── tests/                # diff/merge/翻译/条目拼装/缓存 单测（vitest）
└── README.md             # 用法/原理/边界/卸载说明
```

依赖：runtime 零新增依赖（网络用全局 fetch；settings 经 `ctx.get` 注入，类型走
devDependencies `@deepseek-ai/dsh-settings`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-llm`）。

## 验证清单

1. `cd plugins/dsh-model-sync && pnpm build` 成功；`node -e "require('./lib/index.js')"`
   可加载。
2. `pnpm test`（vitest）通过。
3. `dsh --profile web --dump-config`（只读）确认 layer 栈正常、无报错。
4. `git status --short` 干净（仅预期文件；`*.tsbuildinfo` 不入库）；仓库根提交
   Conventional Commits。
5. profile 接线（运行配置在外，但需落地）：`~/.dsh/profiles/web/package.json` 的
   dependencies 加 `dsh-model-sync: link:../../../dsh-work/plugins/dsh-model-sync`、
   bundles 加 `dsh-model-sync`；profile 目录 `pnpm install`。**报告标注「需用户重启
   DSH 服务后生效」，由用户重启验证。**
6. 功能级验证（新模型出现在选择器、可发起一次对话、定时刷新不炸现有路由）以用户
   重启后的反馈为准，不依据构建成功断言 UI 正常。

## 明确不做

- 不改官方 `@deepseek-ai/*` 内核包、不改 `~/deepseek-harness` checkout；不 fetch/push
  上游。
- 不做方案 B（动态路由真·实时），不做手动触发入口（后续可加 dsh 命令）。
- 不做删除同步：上游 pi-ai 删除的模型，只要已装 catalog 仍服务就保留（只增不删）；
  卸载插件后已写入的 `models:` 列表保留、路由继续可用。
- 不上 live 端点生产模型数据（只作信号日志）。