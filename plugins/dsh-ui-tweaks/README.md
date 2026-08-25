# dsh-ui-tweaks

桌面端 dsh web GUI 的 UI 整洁插件（将来其它桌面 UI 调整统一收纳于此）。当前功能：
**已完成回合折叠**。

## 功能：已完成回合折叠（已处理）

任务处理完成（会话流里收到 `turn/end`）后，该回合（turn）的 agent 消息折叠成一个
可点击的「已处理」块，只显示最后一条回复：

```
› 已处理  2 条
  已完成修改          ← 只有该回合的最后一条回复可见，完整 markdown 渲染
```

- 点击「已处理」展开全部（箭头 `›` 旋转成 `v`），再次点击收起；头部位于折叠块
  **最顶端**（紧跟在用户提问之后），中间消息在头部**下方向下展开**、收起时向上
  收拢，带淡入/滑入动画；头部在展开/收起过程中保持在视口内；
- 计数显示**该回合被隐藏的总行数**（中间消息 + 工具/推理/上下文行），并显示该回合
  **耗时**（如 `已处理 3m16s ›`，与回合尾部的 "Ran for …" 一致）；
- 折叠态只显示最后一条回复的**正文**（其思考/Think 摘要行隐藏，展开后恢复显示）；
- 用户自己的提问、回合中的 steering 提问、回合尾部的交付物/操作行保持可见；
- 失败的回合同样折叠（失败提示行留在最后一条回复之后）；
- 流式进行中不折叠、不跳动，`turn/end` 到达才折叠；
- 旧历史中已完成的回合也折叠（点开可看全部过程）；
- 折叠块内最后一条回复若是会话最新消息，长文本仍不截断（沿用内核行为）。

### 半个回合（分页）的处理

桌面会话窗口是**连续的一段**：`turn/start` 与 `turn/end` 都在窗口内才算"整回合"。
窗口被切在回合中间（只加载了后半截）的旧回合**绝不误折叠**——保持原样展开；插件会
自动调用 `loadOlder()` 补拉更早历史（同一残缺回合最多连拉 5 页），补全后自动折叠。
上拉加载更早历史同样按此逻辑。

### 实现

- 纯 DOM + 内核公开 API（`ctx.sessions` 的会话快照 `getSnapshot()/subscribe()` 与
  `loadOlder()`），**不改内核、不占 node slot、不重写消息渲染**（markdown / 推理 /
  工具卡片保持内核原样）。
- 流水线：`ConversationSnapshot → windowFromSnapshot → planFolds（纯函数）→
  applyFoldPlan（DOM）`，由 `fold-chrome`（MutationObserver + 点击委托）与
  `fold-driver`（会话订阅 + 自动补全 + 展开状态）驱动；任何 DOM/快照变化都幂等重算，自愈。
- 样式消费 `--dsw-*` 令牌（缺失时有中性回退），i18n `zh`（key 源）/`en` 对照。

## 构建 / 测试

```bash
pnpm install          # 首次
pnpm test             # vitest（34 个用例：fold-plan / fold-dom / fold-chrome / fold-driver）
pnpm typecheck
pnpm build            # lib/index.js（host 半，空挂载）+ lib/client.js（浏览器半）
```

## 生效

新插件挂载需要**重启一次 `dsh web`**（profile bundles 在启动时读取）；之后改
`src/client` 代码热加载（仅 client 半），host 半改动需重启。重启后刷新页面，已完成的
回合即出现「已处理」折叠。