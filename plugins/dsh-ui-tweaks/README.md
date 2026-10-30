# dsh-ui-tweaks

桌面端 dsh web GUI 的**窄屏移动端**适配插件，当前适配 **DSH 0.2.1-rc.2**。功能：

- **手机侧栏抽屉**（`mobile-sidebar.tsx`）：<768px 视口下宿主左侧栏（含 56px 图标轨）
  收成悬浮鲸鱼图标，点击展开为覆盖式抽屉；
- **窄屏顶栏收敛**（`mobile-sidebar.css`）：隐藏会话标题/模式/工具菜单/ Chat ·
  Trajectory 标签，只保留原生右栏开关；顶栏收到 40px，给消息流让出高度；
- **窄屏输入区单行**（`composer-toolbar.css`）：<768px 时 composer 底部工具行
  （附件 / 访问 / 模型 / 发送）强制单行，避免窄屏换行撑高卡片；
- **手机噪音收敛**：隐藏 composer 上方 dock 的轮次/速度/上下文统计，以及消息行动区
  的悬停时间信息（触屏没有 hover，且窄屏会溢出）。

> **0.1.0 的「已完成回合折叠（已处理）」已移除**：DSH 0.1.5 原生「对话显示 › 紧凑」
> （默认开启）在渲染层折叠已完成回合的过程内容，与本插件 DOM 层折叠目标行重叠、
> 同时启用会冲突。已按"用原生、删折叠"决定将 `fold-*` 模块整体删除（见 git 历史）。

## 功能

### 手机侧栏抽屉

窄屏下宿主左侧栏整体隐藏，左上角出现漂浮的 DeepSeek 鲸鱼图标；点击后经布局服务的
官方动作（`layout.toggleSidebar`）展开侧栏，CSS 将其变成覆盖在会话上的抽屉，带全屏
遮罩。抽屉开合状态通过属性观察器镜像宿主真实状态（任何入口触发的展开都保持同步），
≥768px 时触发按钮与遮罩隐藏，宿主原生行为不受影响。0.2.x 的抽屉自带品牌行与右上角
「Collapse sidebar」按钮，抽屉打开时插件隐藏悬浮触发按钮，避免盖住品牌，关闭走原生
按钮或遮罩。

### DSH 0.2.x 的 DOM 适配点

0.2.1-rc.2 重排了外壳与 composer，插件改为锚定稳定的 data 属性：

| 用途 | 0.2.x 事实 | 旧版 |
|---|---|---|
| 布局帧 | `data-sidebar-collapsed` / `data-rightbar-collapsed` | `data-details-collapsed` |
| 三列标记 | 右栏带 `data-rightbar-col`（帧子节点依次为 sidebar / center / rightbar） | 同序但无右栏标记 |
| 滚动内容 | `[data-conversation-content]`（旧 `data-chat-flow` 已不存在） | `data-chat-flow` |
| 顶栏 | `conversation.session.header` 内 titleRow + `[data-conversation-tabs]`；corner 是原生右栏开关 | 整块 header 可直接隐藏 |
| composer 工具行 | hash 类 `uV2eYG_*` 未变 | 同 |
| composer dock 统计 | `[data-composer-dock]`（部分 pill 无 `data-composer-stat`，故整块隐藏） | `.FJxK0a_root` |
| 消息悬停时间 | hash 前缀变 `xzv4MW_*`，按 `_timeStart` / `_timeEnd` 后缀匹配 | `p-xYUq_*` |

### 窄屏输入区单行

宿主 composer 底部工具行在窄屏仍会换行；插件在 <768px 视口强制单行：收紧间距、固定
首组（附件/访问）、尾组（模型/发送）可收缩（模型选择器省略号截断、发送按钮
`flex-shrink: 0` 恒可见）。选择器为 composer 卡的 hash 类（`uV2eYG_*`），在本冻结
内核上稳定。

## 构建 / 测试

```bash
pnpm install          # 首次
pnpm test             # vitest（mobile-sidebar + client-entry 冒烟）
pnpm typecheck
pnpm build            # lib/index.js（host 半，空挂载）+ lib/client.js（浏览器半）
```

## 生效

本插件是 profile bundle 的一员：`~/.dsh/profiles/web/package.json` 的
`dsh.profile.bundles` 必须包含 `dsh-ui-tweaks`，否则 client 半不会被加载。新插件挂载
需要**重启一次 `dsh web`**（profile bundles 在启动时读取）；之后改 `src/client` 代码
热加载（仅 client 半），host 半改动需重启。重启后刷新页面，窄屏场景即出现抽屉触发
按钮、收敛后的顶栏与单行输入区。
