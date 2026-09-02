# dsh-model-sync

让 GUI 模型选择器的模型列表保持最新，无需重启、不改内核。

## 原理

内核的 `dsh-llm-pi-ai`（pi-ai 适配器）为 catalog 路由（如 `opencode-go`）提供的是
**pi-ai 发版日的静态模型快照**，且明确不做运行时刷新。本插件把该路由**就地接管**为
一条**手写声明路由**（默认 `source === id === opencode-go`，即镜像替身同名替换原路由）：
定时（默认 1h）拉取最新 `@earendil-works/pi-ai` npm 包里的 `<source>.json` 目录（按
版本磁盘缓存），生成「目录中所有模型」的全字段 `models:` 列表，经 `llm-pi-ai:` 设置段
写回——原路由的静态 16 个模型被替换为目录最新版本（如 0.84.4 的 25 个）。llm-pi-ai
对设置段是响应式的，`settings/document-updated` 会让 GUI 选择器自动刷新——写入即生效。
现有 `models:` 条目永不重写、只增不删；任何一步失败保留 last-good，不影响在用路由。

同名接管的收益：选择器里只有一个 `opencode-go` 分组、`agent-default-model` 无需改动、
**既有会话照常工作**（路由名与模型 id 都没变）。首次启动时若原路由只剩
`apiKeyEnv`（无 models），插件会在原条目上补齐 `api`/`baseURL`/`models`，原地升级。

## 配置（cordis.patch.yml 的 insert.config）

```yaml
config:
  mirrors:
    - source: opencode-go
      id: opencode-go
      api: openai-completions
      baseURL: https://opencode.ai/zen/go/v1
      apiKeyEnv: OPENCODE_GO_API_KEY
  intervalMs: 3600000
  fetchLive: true
  timeoutMs: 15000
```

- `mirrors[].source`：pi-ai 目录数据源（其 `<source>.json` 文件是模型来源）。
- `mirrors[].id`：写回 settings 的路由键。**`source === id` 为默认替换模式**（路由
  由插件维护）；也可配置 `source` 与 `id` 不同（双路由模式，旧行为）。
- `mirrors[].api` / `baseURL`：路由协议与端点。源目录为混合协议时必须显式给出
  （llm-pi-ai 的 model 条目不能携带 api/baseURL）。
- `mirrors[].apiKeyEnv`：路由凭据引用。替换模式下这是唯一凭据来源；双路由模式缺省
  时复制源路由的。
- `intervalMs`：同步间隔（默认 1h）；启动时先同步一次，3s/15s/60s 各有一次保底重试
  （覆盖启动时序竞态）。
- `fetchLive`：额外探测 `GET {baseURL}/models`，仅记日志（不上生产）。

## 注意

- 路由统一走配置的 `api`（默认 `openai-completions`）。目录中少数走
  anthropic/responses 协议的模型经本路由被重排到 completions：若网关不接受会
  报错，其余模型不受影响——首次使用请先实测。
- 写入的 `models:` 列表由插件托管；卸载插件后列表保留、路由继续可用（不再自动更新）。
- 活体 `/models` 探测只从 `apiKeyEnv` 指定的环境变量读取密钥：只存在凭据库里
  的密钥不会被使用，探测将以未认证身份进行（失败仅记日志）；该探测仅为信号，
  永不改动模型列表。
- 每次同步的日志写入 `~/.dsh/storages/dsh-model-sync/status.json`
  （`DSH_HOME` 设置时在其下），可随时查看同步结果。
- 需要 dsh 重启才加载插件本体（profile bundle 在启动时组装）；生效后同步无需
  重启。

## 验证

`pnpm build` + `pnpm test`；`node -e "import('./lib/index.js')"` 可加载。