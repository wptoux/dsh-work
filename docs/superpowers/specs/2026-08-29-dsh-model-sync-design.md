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

> **修订（v2，2026-08-29 编码前核查）**：初版设计假设「在原路由上写 `models:` 全量列表、
> 新模型条目自带 `api`/`baseURL`」。此假设**不成立**——`llm-pi-ai/catalog.ts` 的
> `PiAiModelProfile` 没有条目级 `api`/`baseURL` 字段，新模型的协议与端点只能来自**路由级**
> `api`/`baseURL`，而 opencode-go 是混合 `openai-completions`/`openai-responses`/
> `anthropic-messages` 三种协议的目录路由（`sharedCatalogApi` 推导不出唯一协议），在原路由
> 上直接写 `models:` 会让新模型报 "needs an api / needs a baseURL"。v2 改为**镜像路由**方案
> （详见「目标形态」），原路由保持原封不动。

## 实证约束（决定设计的六个事实）

| 事实 | 证据 | 结论 |
|---|---|---|
| `modelOverrides` 拒绝未入目录的模型 | `llm-pi-ai/src/catalog.ts` `if (!defaults.has(id)) invalid(...'modelOverrides names X, which the installed catalog does not describe')` | 新模型只能写 **`models:` 全量列表** |
| `models:` 列表条目无 `api`/`baseURL` | `PiAiModelProfile` 仅 id/name/contextWindow/maxTokens/input/reasoningEfforts/compat；`catalog.ts` 从 `request.api`/`request.baseURL`（路由级）解析 | **新模型只能在统一协议的手写路由上声明**——镜像路由方案（见「目标形态」） |
| opencode-go 路由跨 3 种 wire 协议、provider 无 baseUrl | 0.82.1 数据：`openai-completions`/`openai-responses`/`anthropic-messages` 混布，模型各自带 `baseUrl: https://opencode.ai/zen/go/v1` | 原路由不可动；镜像路由统一走 `openai-completions`（20/25 模型本是该协议；端点即 `…/v1` OpenAI 兼容形态） |
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
        mirrors:
          - source: opencode-go        # 事实源：llm-pi-ai 已服务的 catalog 路由
            id: opencode-go-live       # 镜像路由：插件托管其 models 列表
            api: openai-completions    # 镜像统一协议（源路由为混合协议时必填）
            baseURL: https://opencode.ai/zen/go/v1   # 端点；缺省取源路由/目录条目
        intervalMs: 3600000            # 定时同步间隔
        fetchLive: true                # 探测 live /models，仅记日志
        timeoutMs: 15000               # 单次网络操作超时
```

「镜像路由」语义：插件在 `llm-pi-ai:` 设置段维护一个**手写声明路由**（acme-gateway
同款形态，schema 完全支持），其 `models:` 列表 = 最新 pi-ai 目录中 `source` 路由的
**全量模型**（每条带 contextWindow/maxTokens/input/reasoningEfforts/compat 全字段）。
镜像路由的 `apiKeyEnv` 从 `source` 路由复制；源路由及其余字段一律不动。原路由继续
服务老会话与默认模型；选择器新增镜像分组，列表保持最新。注意：原本走
anthropic/responses 协议的少数模型在镜像路由统一走 `openai-completions`，若网关不
接受会报错（其余模型不受影响）——写入 README 与交付说明，由用户实测确认。

## 数据流（每次同步）

1. **读现状**：`settings.get('llm-pi-ai')` 取 `providers.<source>` 与 `providers.<mirror>`
   段；源段只读（复制 `apiKeyEnv`），镜像段可写（`models`），其余字段不触碰。
2. **读事实**：`ctx.llm.listProviders()` 确认源路由在服务中；`ctx.llm.listModels(mirror)`
   取镜像当前实际服务的模型 id 集合（事实源，不依赖插件自身 pi-ai 版本）。
3. **取最新目录**：`npm pack` 最新 `@earendil-works/pi-ai`（带本地缓存：版本 +
   目录 hash + 时间戳，避免高频打 npm registry），解包读
   `package/dist/providers/data/<source>.json`，按 api 分组展平为 `Map<id, 条目>`。
4. **diff**：`new = latest ∖ served`（镜像当前未服务的新模型）。
5. **拼装**：`merged = [镜像现有条目原样保留（含用户手写修正）] + [new 的全字段条目]`
   （条目 id 去重；现有条目永不重写——只增不删、尊重用户编辑）。
6. **引导**：镜像路由不存在时，先写入骨架（`apiKeyEnv` 复制自源路由 + `api` + `baseURL`）
   再写 `models`；同一组 `settings.mutate` ops 完成。
7. **写入**：与现有 `models:` 深度对比（`deepEqualJson`），有变化才
   `settings.mutate('llm-pi-ai', [ops…], expectedRevision)`；
   `SettingsConflictError` 冲突则重读重试一次。
8. **失败策略**：任何一步失败只记日志、保留 last-good，绝不触碰现有路由。

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
├── tsdown.config.ts      # host 包（无 client bundle）：entry src/index.ts → lib/index.js
├── .gitignore            # node_modules/、*.tsbuildinfo（lib/ 入库）
├── src/
│   ├── index.ts          # cordis 插件入口：name='model-sync'；首同步 + ctx.setInterval
│   ├── config.ts         # schemastery schema：mirrors/intervalMs/fetchLive/timeoutMs
│   ├── sync.ts           # 编排：读 settings → listModels → tarball → diff → 拼装 → mutate（含镜像引导）
│   ├── catalog-json.ts   # 展平 <source>.json（纯函数）+ npm registry/tarball 获取（带缓存）
│   ├── merge.ts          # buildMergedModels：现有条目保留 + 新条目拼装（纯函数）
│   ├── translate.ts      # thinkingLevelMap→reasoningEfforts；compat 字段过滤（纯函数）
│   └── live.ts           # 可选 live /models 探测（信号日志，无 key 则跳过）
├── tests/                # 纯函数单测（vitest，无网络）：parse/merge/translate/live URL 拼接
└── README.md             # 用法/原理/边界/卸载说明（含镜像协议统一 caveat）
```

依赖：runtime 仅 `tar`（解包 npm tarball）；网络用全局 fetch；settings 经 `ctx.get`
注入，类型走 devDependencies（`@deepseek-ai/dsh-settings`、`@deepseek-ai/dsh-llm`、
`@deepseek-ai/cordis`）。镜像路由 `models:` 全量由插件托管；卸载插件后已写入的列表
保留、路由继续可用。

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
- 不改动源路由（`opencode-go` 原样保留），不做删除同步：目录/镜像中消失的模型只要
  镜像列表里还有就保留（只增不删、现有条目永不重写）。
- 不上 live 端点生产模型数据（只作信号日志）。