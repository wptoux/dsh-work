# dsh-remote-web-ui — 仓库规则

本仓库是 DeepSeek Harness 的外部插件包，开发只能基于官方 NPM SDK
（`@deepseek-ai/*` devDependencies，类型从 node_modules 解析，不引用任何
DSH 源码 checkout）。

- 所有产品文案遵循 harness 的 i18n 惯例：`zh` 字典为 key 源，`en` 完整对照，
  通过 `ctx.locale.register` 注册。
- 客户端 bundle 的跨包 value import 受纯度门禁约束（平台模块表 + inline-safe
  wire 层之外一律禁止）——跨插件协作走 cordis 服务或 slot。
- 安全语义（一次性令牌、撤销、gate 策略）修改时必须同步更新 README 与本仓库
  测试。
- **DSH 0.2.0 配置模型（本地自持，已不跟随上游）**：宿主 `Config` 用
  `@deepseek-ai/schemastery` 声明，每个可编辑字段必须 `.volatile()`；Loader 交给
  `apply` 的是冻结引用，读值走 `Volatile.get()`（见 `src/index.ts` 的 `readConfig`）。
  只有 volatile 变化的设置编辑**不会重挂载**插件，结构性反应（启停路由/隧道）靠
  `settings/document-updated` 事件触发 `sync()`；宿主调用
  `settings.configure({ auto: false }, ctx.fiber)` 抑制自动表单页。
- **客户端设置卡走 `plugins.item` + `ctx.configForms`**：`settings.plugins.tab` 与
  `settingsScope` 服务在 0.2.0 已删除。卡片在 `configForms.whileServed([entryId], …)`
  内注册，并同时实现 `view: 'summary'`（一行文案）与 `view: 'page'`（表单）。
- 版本边界：`dsh.engines.dsh` 与 `peerDependencies["@deepseek-ai/dsh"]` 固定为
  `>=0.2.0-rc.1 <0.3.0-0`，延续冻结策略。
- 图标来自 `@deepseek-ai/dsh-client-ui-primitives`，0.2.0 起命名为
  `…Regular`/`…Medium`（旧的 `…16` 后缀已删除）。
