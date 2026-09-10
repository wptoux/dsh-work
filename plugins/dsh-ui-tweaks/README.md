# dsh-ui-tweaks

桌面端 dsh web GUI 的**窄屏移动端**适配插件。当前功能：

- **手机侧栏抽屉**（`mobile-sidebar.tsx`）：<768px 视口下宿主左侧栏（含 56px 图标轨）
  收成悬浮鲸鱼图标，点击展开为覆盖式抽屉；
- **窄屏输入区单行**（`composer-toolbar.css`）：<768px 时 composer 底部工具行
  （附件 / 访问 / 模型 / 发送）强制单行，避免 320px 宽度下换行撑高卡片。

> **0.1.0 的「已完成回合折叠（已处理）」已移除**：DSH 0.1.5 原生「对话显示 › 紧凑」
> （默认开启）在渲染层折叠已完成回合的过程内容，与本插件 DOM 层折叠目标行重叠、
> 同时启用会冲突。已按"用原生、删折叠"决定将 `fold-*` 模块整体删除（见 git 历史）。

## 功能

### 手机侧栏抽屉

窄屏下宿主左侧栏整体隐藏，左上角出现漂浮的 DeepSeek 鲸鱼图标；点击后经布局服务的
官方动作（`layout.toggleSidebar`）展开侧栏，CSS 将其变成覆盖在会话上的抽屉，带全屏
遮罩。抽屉开合状态通过属性观察器镜像宿主真实状态（任何入口触发的展开都保持同步），
≥768px 时触发按钮与遮罩隐藏，宿主原生行为不受影响。

### 窄屏输入区单行

宿主 composer 底部工具行在 320px 宽度下会换行（卡片 42px → 82px）；插件在
<768px 视口强制单行：收紧间距、固定首组（附件/访问）、尾组（模型/发送）可收缩
（模型选择器省略号截断、发送按钮 `flex-shrink: 0` 恒可见）。选择器为 composer 卡的
hash 类（`uV2eYG_*`），在本冻结内核上稳定。

## 构建 / 测试

```bash
pnpm install          # 首次
pnpm test             # vitest（mobile-sidebar + client-entry 冒烟）
pnpm typecheck
pnpm build            # lib/index.js（host 半，空挂载）+ lib/client.js（浏览器半）
```

## 生效

新插件挂载需要**重启一次 `dsh web`**（profile bundles 在启动时读取）；之后改
`src/client` 代码热加载（仅 client 半），host 半改动需重启。重启后刷新页面，窄屏场景
即出现抽屉触发按钮与单行输入区。