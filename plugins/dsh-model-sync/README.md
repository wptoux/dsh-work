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