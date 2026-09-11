# dsh 插件本地化维护仓库

本目录是 DeepSeek Harness web profile（`~/.dsh/profiles/web`）使用的全部第三方插件的
**冻结本地源码**。目标：版本永远不自动漂移（不再跟随上游），遇到问题直接改这里的源码，
改完重启 dsh 即生效。

整个 `plugins/` 由**一个统一 git 仓库管理**（仓库根在 `~/dsh-work/`）。

## 目录与对应关系（冻结溯源）

| 目录 | 包名 | 上游仓库 | 冻结 commit | 说明 |
|---|---|---|---|---|
| `dsh-remote-web-ui/` | `dsh-remote-web-ui` | https://github.com/zhu1090093659/dsh-web-ui | `a3b44d9`（tag v0.3.2） | 手机远程控制。**已裁剪**：从原 19 子包全家桶中单独提取并扁平化为单包（见下） |
| `dsh-better-sidebar/` | `dsh-better-sidebar` | https://github.com/omdsh-dev/DSH-better-sidebar | `754974a`（tag v0.19.0） | 增强侧边栏。**v0.19.0 为官方 DSH 0.1.5-rc.1 适配版**（原生右栏 `dsh-client-ui-sidebar-right` 表面，own right panel 已退役），**需内核 ≥0.1.5-rc.1**，见「已知本地改动」 |
| `dsh-usage-stats/` | `dsh-usage-stats` | https://github.com/Ychris12138/dsh-usage-stats | `8373659`（v0.2.5） | 用量统计，lib/ 已入库，无需构建 |
| `dsh-archive-manager/` | `dsh-archive-manager` | https://github.com/z953218350/dsh-archive-manager | `9e611af`（= 已发布的 npm 1.0.7） | 会话归档管理（设置页归档卡片），lib/ 已入库，无需构建 |
| `dsh-ui-tweaks/` | `dsh-ui-tweaks` | 本仓库自研（无上游） | — | 窄屏移动端适配：手机侧栏抽屉（≤767px 悬浮鲸鱼图标展开覆盖式抽屉）+ 输入区单行。**折叠功能已移除**（DSH 0.1.5 原生「对话显示:紧凑」同效且默认开启，见「已知本地改动」） |
| `dsh-model-sync/` | `dsh-model-sync` | 本仓库自研（无上游） | — | 模型列表**实时保鲜**：把 pi-ai 静态目录路由就地接管为自维护路由，定时同步最新模型列表（见 `dsh-model-sync/README.md`） |
| `dsh-work-all/` | `dsh-work-all` | 本仓库自研（无上游） | — | 全家桶**聚合载具包**：汇总其余 6 款插件的挂载行，一条命令装齐全部（见「聚合包」章节） |

> 已移除：**dshmarket**（插件市场，与"冻结"策略冲突——唯一的用途就是发现/安装新插件，
> 冻结后不再需要）。如需恢复，从 `~/.dsh/work` 的 `.git-backup/dsh-market.bundle`（含本地
> 修复 commit）或上游 tag `v1.14.1` 还原，并在 profile 依赖里加回即可。
>
> 历史背景：旧 profile 用的 `@linxin666/dsh-web-ui-all` 全家桶（^0.2.4 semver 自动漂移）、
> `dshmarket`（^1.9.0 → 漂到 1.14.1）、`github:` 浮动引用，每次更新都可能 break。
> 现已全部改为本地 `link:` 依赖，锁死版本，源码自持。

## 接线方式（已配置好，一般不用动）

profile 依赖指向本地目录（symlink，改源码即生效）。路径用**相对形式**（相对
`~/.dsh/profiles/web/` 解析，依赖 `~/dsh-work` 与 `~/.dsh` 同在 `$HOME` 下）：

```json
// ~/.dsh/profiles/web/package.json
"dependencies": {
  "dsh-remote-web-ui": "link:../../../dsh-work/plugins/dsh-remote-web-ui",
  "dsh-better-sidebar":      "link:../../../dsh-work/plugins/dsh-better-sidebar",
  "dsh-usage-stats":         "link:../../../dsh-work/plugins/dsh-usage-stats",
  "dsh-archive-manager":     "link:../../../dsh-work/plugins/dsh-archive-manager",
  "dsh-ui-tweaks":           "link:../../../dsh-work/plugins/dsh-ui-tweaks",
  "dsh-model-sync":         "link:../../../dsh-work/plugins/dsh-model-sync"
}
```

> 换机器 / 换用户名都不需要动这几行（两目录都挂在 `$HOME` 下）。唯一的约束：
> 若把 `~/dsh-work` 挪到 `$HOME` 之外，或不再与 `~/.dsh` 平级，改这里几行即可
> （`cd ~/.dsh/profiles/web && pnpm install` 更新 lockfile）。
>
> **本地接线不用聚合包**：`dsh-work-all`（见下）只用于对外分发——它的 dependencies
> 是 git 子目录引用，link 进 profile 不会安装子包（link: 语义），会破坏"改源码即生效"。
> 本地开发永远走上面这 6 条直连 `link:`。

`dsh.profile.bundles` 同步列出这 6 个包（+ 内核自带的 `dsh-base`、`dsh-web-app`）。

**依赖模型（重要）**：pnpm 对 `link:` 依赖采用"插件目录自管依赖"——profile 的 lockfile
只记录 link 本身，**每个插件目录必须自带完整 node_modules**（含原生二进制）。所以：
`dsh-remote-web-ui/`、`dsh-better-sidebar/` 各自 `pnpm install` 过，cloudflared /
node-pty 等二进制都在各自的 node_modules 里；改完依赖声明记得在对应目录重装。

## GitHub 安装（对外分发）

除本地 `link:` 外，本仓库支持直接以 GitHub 子目录依赖安装（pnpm ≥9.5），版本固定，
适合换机器 / 分享给他人。两条路线：

- **方式 A（推荐）：整合包一条命令**——装 `dsh-work-all`，6 款插件一次全部就位
  （机制见「聚合包（dsh-work-all）」章节）；
- **方式 B：按需逐插件**——只装需要的子包，profile 保持默认布局（无需额外配置）。

两种方式都推荐走官方 CLI：`dsh plugin` 把参数转发给 profile 目录里的 pnpm 执行，装完后
**自动把声明了 `dsh.bundle` 的依赖同步进 `dsh.profile.bundles`**（免手动维护 layer
列表），profile 不存在时自动初始化（内核 `apps/cli/src/plugin.ts`：`pnpm <args>` in
profile dir + reconcile 安装态）。

### 方式 A：整合包一条命令（推荐）

1. （一次性）配置 profile 的 `pnpm-workspace.yaml`。整合包路线需要**三件事**：放行原生
   二进制构建、放行 git 传递依赖、把子包提升到 profile 顶层供 loader 解析：

   ```sh
   mkdir -p ~/.dsh/profiles/web
   cat > ~/.dsh/profiles/web/pnpm-workspace.yaml <<'EOF'
   allowBuilds:
     cloudflared: true
     node-pty: true
   blockExoticSubdeps: false
   nodeLinker: hoisted
   EOF
   ```

   > 为什么（pnpm 11 实测量得的硬约束，缺一不可）：
   > - `allowBuilds`：pnpm ≥10 默认拦截依赖构建脚本，不放行会报
   >   `ERR_PNPM_IGNORED_BUILDS`（依赖已写入，补后重跑幂等）；
   > - `blockExoticSubdeps: false`：pnpm 的供应链硬化默认**禁止 git（exotic）依赖出现在
   >   子依赖位置**，聚合包的子包正是子依赖，不放开会报 `ERR_PNPM_EXOTIC_SUBDEP`；
   > - `nodeLinker: hoisted`：pnpm 默认 isolated 布局**不会把 git 子包的传递依赖提升到
   >   profile 顶层**，而 loader 按行 `name:` 从 profile 根解析包——不提升则启动即
   >   `Cannot find package '<子包>'`。扁平布局才保证子包出现在顶层 node_modules。
   >
   > 若 profile 已有该文件，手动合并这几组键即可。

2. 安装整合包（spec 里含 `&`，记得加引号）：

   ```sh
   dsh plugin --profile web add 'github:wptoux/dsh-work#plugins-2026.09.1&path:plugins/dsh-work-all'
   ```

3. 重启 dsh。

**升级**：把命令里的 tag 换成新 tag 重跑。
**回滚**：`dsh plugin --profile web remove dsh-work-all`（一次移出全部 6 款并自动从
`bundles` 移除）；或换回旧 tag 重装。

### 方式 B：按需逐插件安装

只放行原生二进制，其余保持默认（直接 git 依赖在顶层合法，且直接依赖必在 profile 顶层）：

1. （一次性）`~/.dsh/profiles/web/pnpm-workspace.yaml`：

   ```sh
   mkdir -p ~/.dsh/profiles/web
   cat > ~/.dsh/profiles/web/pnpm-workspace.yaml <<'EOF'
   allowBuilds:
     cloudflared: true
     node-pty: true
   EOF
   ```

2. 安装（spec 里含 `&`，记得加引号）：

   ```sh
   dsh plugin --profile web add 'github:wptoux/dsh-work#plugins-2026.09.1&path:plugins/dsh-remote-web-ui'
   dsh plugin --profile web add 'github:wptoux/dsh-work#plugins-2026.09.1&path:plugins/dsh-better-sidebar'
   dsh plugin --profile web add 'github:wptoux/dsh-work#plugins-2026.09.1&path:plugins/dsh-usage-stats'
   dsh plugin --profile web add 'github:wptoux/dsh-work#plugins-2026.09.1&path:plugins/dsh-archive-manager'
   dsh plugin --profile web add 'github:wptoux/dsh-work#plugins-2026.09.1&path:plugins/dsh-ui-tweaks'
   dsh plugin --profile web add 'github:wptoux/dsh-work#plugins-2026.09.1&path:plugins/dsh-model-sync'
   ```

3. 重启 dsh。

**升级 / 回滚**：把 tag 换成新 tag 重跑 / `dsh plugin --profile web remove <包名>`（移出依赖
并自动从 `bundles` 移除），或换回旧 tag 重装。

> 手写 package.json 的等价方式（profile 已存在时）：
>
> ```json
> // ~/.dsh/profiles/web/package.json
> "dependencies": {
>   "dsh-remote-web-ui":   "github:wptoux/dsh-work#plugins-2026.09.1&path:plugins/dsh-remote-web-ui",
>   "dsh-better-sidebar":  "github:wptoux/dsh-work#plugins-2026.09.1&path:plugins/dsh-better-sidebar",
>   "dsh-usage-stats":     "github:wptoux/dsh-work#plugins-2026.09.1&path:plugins/dsh-usage-stats",
>   "dsh-archive-manager": "github:wptoux/dsh-work#plugins-2026.09.1&path:plugins/dsh-archive-manager",
>   "dsh-ui-tweaks":       "github:wptoux/dsh-work#plugins-2026.09.1&path:plugins/dsh-ui-tweaks",
>   "dsh-model-sync":     "github:wptoux/dsh-work#plugins-2026.09.1&path:plugins/dsh-model-sync"
> }
> ```
>
> 然后 `cd ~/.dsh/profiles/web && pnpm install`。注意手写方式**不会**自动更新
> `dsh.profile.bundles`，需自行保证列表里有对应包名——这是推荐 `dsh plugin` 的原因。

> 说明与约束：
> - 本仓库是**个人冻结 fork**（裁剪/定制版），与 npm registry 上同名包/上游仓库无关；
>   版本号沿用上游但内容以本仓库为准。
> - 使用 pnpm 安装（npm 不支持 git 子目录依赖）；npm 用户可整仓 clone 后改用
>   `file:` 依赖（等价于本机 `link:` 模式）。
> - 发版 = 构建 lib/ 并提交 + 打整仓 tag（`plugins-YYYY.MM.N`），见 AGENTS.md。

## 聚合包（dsh-work-all）

全家桶**聚合载具包**：本包没有自有插件逻辑（无 src / lib / 构建步骤），`dependencies`
以 git 子目录引用（与整仓 tag 同源，版本固定不漂移）拉入全部 6 款子插件，
`cordis.patch.yml` 汇总各子包的挂载行。装它 = 6 款插件一次全部就位；`dsh plugin` 会自动
把它加进 `dsh.profile.bundles`。

- **行 id 命名空间**：6 行挂载 id 统一带 `dsh-work-` 前缀（`dsh-work-remote-web-ui` 等），
  与同名插件的独立安装**共存**不冲突——host/client 半区按包名去重，只挂载一次。代价：
  按 id 写的 profile 配置行要改用带前缀的 id（如 remote-web-ui 的 `autoTunnel` 行写成
  `dsh-work-remote-web-ui`）。
- **better-sidebar 双挂载守卫**：它注册 `/sidebar/api` 路由，双挂载会直接启动失败。
  聚合包行**不带守卫**，由独立包自带的行守卫负责：聚合包排在独立包之前（标准安装顺序，
  独立包后装、追加在 bundles 末尾）时，独立行自动退让、聚合包生效；反向（先独立后聚合）
  是上游已知限制，会双挂载启动失败。聚合行若也加守卫，两个 disabled 表达式会互相递归
  评估导致 loader 栈溢出（实测）。其余 5 款无此问题（loader 容忍同名多来源，第二个为
  空操作）。两来源并存无额外收益，建议只保留一个。
- **client 半区**：Web client bundle 注册表按 **loader 已挂载的行**（`ctx.loader.entries()`，
  而非 bundles 列表）扫描 `dsh.client` 声明（内核 `packages/client/modules`），因此子包
  不必出现在 `dsh.profile.bundles` 里，client 半区照常被发现、bundle 照常下发。
- **手写维护（无生成器）**：新增/移除插件时，必须**同步**更新本包的 `cordis.patch.yml`
  （增删挂载行）与 `package.json`（增删依赖），避免聚合包与子包漂移。
- **发版联动**：本包 dependencies 里的 tag 与整仓 tag 同源——每次发版（打新
  `plugins-YYYY.MM.N`）时，把 6 条依赖的 tag 一并升到新 tag 并提交（`dsh-model-sync` 自首个
  包含它的新 tag 起才可从聚合包安装）。
- **本地接线不参与**：本地 profile 保持 6 条 `link:` 直连（见「接线方式」）；不要把本包
  link 进本地 profile——link: 语义不安装子包，等于拿到一个空壳。

## 日常维护流程

### 改代码（最常见）

1. 编辑对应目录下的源码（改完 **不要** 动 `lib/`，那是构建产物；目录里带
   "Generated by scripts/sync-shared.mjs" 头注释的文件现在也可以直接改——本 fork 已删除
   同步工具，src 就是事实源）。
2. 重新构建：
   - `dsh-remote-web-ui`：`cd ~/dsh-work/plugins/dsh-remote-web-ui && pnpm build`
   - `dsh-better-sidebar`：`cd ~/dsh-work/plugins/dsh-better-sidebar && pnpm build`
   - `dsh-usage-stats`：无构建步骤（lib/ 已入库）
   - `dsh-archive-manager`：无构建步骤（lib/ 已入库）
   - `dsh-model-sync`：`cd ~/dsh-work/plugins/dsh-model-sync && pnpm build`（测试：`pnpm test`）
3. **重启 dsh 服务**（`Ctrl+C` 后重新 `dsh web`，或退出后 `dsh web`）使改动生效。
   临时验证可以用 `dsh --profile web --dump-config`（只读，不打扰运行中的服务）。
4. 提交（Conventional Commits，无 emoji）——**在统一仓库根提交**：
   `cd ~/dsh-work && git add plugins/<目录> && git commit -m "fix(scope): what"`。
   *不要* `git fetch/push` 上游——本 fork 是冻结的。

### 验证

- 快速自检：`node -e "require('<目录>/lib/index.js')"`（host 半区能加载即可）。
- 完整验证：重启 dsh 后确认对应功能正常（remote-web-ui：手机扫码配对 + 自动隧道；
  better-sidebar：侧边栏渲染；usage-stats：面板数据更新）。
- 崩溃回溯：`~/.dsh/sessions/` 下最近会话的日志。

### 回滚（改坏了怎么办）

- **单个插件**：`cd ~/dsh-work && git revert HEAD` 或 `git checkout <上一个好的 commit> -- plugins/<目录>`，重建后重启。
- **全部还原到升级前状态**：把 `~/dsh-work/plugins/profile-package.json.original` 拷回
  `~/.dsh/profiles/web/package.json`，然后 `cd ~/.dsh/profiles/web && pnpm install`（会安装回
  旧的 npm/github 版本），重启 dsh。

### 更新上游（慎用，违背冻结策略）

只有当确认需要上游新功能时：
1. 在临时目录 `git clone <上游 URL>`，checkout 到上表冻结 commit 或目标 commit。
2. 对比/挑选改动（`git diff` 两个 checkout，或直接拷文件），合入 `plugins/` 对应目录。
3. 构建、验证（`pnpm build` + 重启 dsh）、在统一仓库提交。
4. 如全家桶需要新增子包（当前已裁掉），从 `zhu1090093659/dsh-web-ui` 全量 clone 后
   单独提取，或重新评估裁剪。

## 已知本地改动（相对上游）

- `dsh-remote-web-ui`：
  - 从 `dsh-web-ui` 全家桶 monorepo 中**扁平化提取**：删除 19 个无关子包、skins、market
    站点、aggregate 聚合包、docs/gallery/tests 脚手架、sync-shared 工具链；保留包自身
    源码 + `shared/` 构建预设（tsdown config 的 import 路径已从 `../../shared` 改为
    `./shared`）。
  - package.json 补 `lightningcss` devDep（上游由 monorepo 根提供，单包后缺失）；
    tsdown 版本对齐 `^0.22.14`。
  - **设置卡片改注册官方槽位**：上游把远程控制设置卡注册进被裁掉的
    `dsh-web-ui-settings`「Web UI 插件组」子槽 `web-ui.plugin.item`（该组随裁剪移除，
    卡片因此不渲染）。改为注册官方 `settings.plugin.item`（按 `remote-web-ui` 命名空间
    keyed），卡片出现在 设置 → 插件 → 插件配置 列表。
  - 新增 `pnpm-workspace.yaml`（allowBuilds: cloudflared）保证自管依赖含隧道二进制。
  - **移除 `/m/` 独立移动端**（本 fork 定制）：删除 `src/mobile/` 应用、`mobile-routes` /
    `mobile-api` / `mobile-pending` / `mobile-pwa`、PWA 资源、`mobileBundle` 构建与
    `mobileEnterToSend` 配置。二维码/配对链接统一为 `/?pair=...`（单一链接，手机与电脑
    共用），面板「手机链接 / 电脑链接」两行合并为「配对链接」一行；手机配对后运行完整
    Web GUI（非 loopback 走 `/remote` 门控通道），小屏布局由 `dsh-ui-tweaks` 适配。
  - **DSH 0.1.5 适配**（本地大改）：host settings 迁移到 `ctx.settings.installSection`
    （`installSettingsSection`/`settingsNamespace` 已删，命名空间改裸字符串）；`inject`
    收窄为 `['webServer','settings']`。**按用户决策退役三组 0.1.1 时代的控制面**：
    ① 全局配对门禁（`api/gate` 环缝在 0.1.5 全树消失，0.1.5 的 /api 信任是声明式的
    `Connection.trustedHosts` + LAN 字面量自动信任）——`gate.ts` 仅剩 cookie/回环工具，
    `posture.ts`、`remote-api.ts`、`loopback-proxy.ts`、`remote-methods.ts`、
    `remote-channel-boot.ts`、`remote-channel-rules.ts`、client `remote-channel.ts`、
    `FenceNotice` 与其测试全部删除；配对回归"令牌+设备识别"（`remoteWebUiPairing`
    服务与 `/api/pair` 面保留），`requirePairingForLan` 字段/文案/卡片项删除；
    ② **配对模型目录**（`paired-model-catalog.ts` 及其测试）删除——apiProxy 无 1:1
    替代物，本期移除；③ QR 铸造去掉 workspace 目标（0.1.5 无 recentWorkspaceId），
    `deep-link` 改走 `sessions.create({workspaceId})+open`。client 半边：`ClientContext`
    → cordis `Context`，`SettingsScope*` → `dsh-client-ui-settings/client`，
    `createSnapshotStore/SnapshotStore` → 种子表新成员 `dsh-client-store`（web-platform
    同步加、tsdown 的 runtime 豁免删除），`WorkspaceId` → `dsh-api-workspace-controller/client`；
    侧边栏座位 `sidebar.remote` 已删 → 仅注册 `sidebar.footer.action`；设置卡 `settings.plugin.item`
    → 0.1.5 的 `settings.plugins.tab`（list 槽，id/order/label）；settings-form 的 batch
    bridge 删除（0.1.5 `SettingsScope.mutate` 签名不同，fork 从不装 bridge）。devDeps 全量
    `^0.1.5-rc.1`，`dsh.client.inject` 换掉 runtime 条目，`dsh.engines.dsh` 改
    `>=0.1.1-rc.1 <0.2.0-0`。**激活前提：内核 ≥0.1.5**。
- `dsh-ui-tweaks`（本仓库自研）：
  - **窄屏侧边栏抽屉**（本 fork 定制，保留）：视口 ≤767px 时把宿主左侧边栏（含 56px 图标栏）
    彻底隐藏，左上角浮出 DeepSeek 小鲸鱼 logo 按钮，点击经官方 `ctx.layout.toggleSidebar()`
    把侧边栏展开为覆盖式抽屉（带遮罩）；≥768px 保持宿主原生行为。纯 DOM + CSS（自有
    `data-dsh-mobile-*` 标记 + 宿主 `data-sidebar-collapsed` 状态），不动内核。
  - **窄屏输入区单行**（保留）：≤767px 时 composer 底部工具行强制单行（选择器为宿主
    composer 卡 hash 类 `uV2eYG_*`，0.1.5 下验证仍匹配）。
  - **已完成回合折叠已移除**（0.1.5 迁移）：0.1.0 的「已处理」DOM 折叠与 DSH 0.1.5 原生
    「对话显示 › 紧凑」（`ui-chat.transcriptView`，默认 `compact`，渲染层折叠已完成回合
    过程内容）目标行重叠、同时启用冲突；按"用原生、删折叠"决定整体删除 `fold-*` 模块
    （含 `session-source` 与 6 个折叠测试）。该折叠若日后要加回，可从 git 历史恢复并
    处理与原生 transcriptView 的共存。**激活前提：内核 ≥0.1.5-rc.1**。
- `dsh-better-sidebar`：**整体接回官方 v0.19.0**（0.15.2 → 0.19.0，含 DSH 0.1.5-rc.1 适配：host 半边 settings 走
  `ctx.settings.register/describe/update`、客户端改用原生 `ctx.sidebarRight` / `ctx.sidebarRightTabs` 表面并退役自有右栏）。
  本地改动仅恢复 **lib/ 入库惯例**（上游 .gitignore 忽略 lib/，本仓库发版需要 lib 现构建入库，已删该行）；
  挂载行 `cordis.patch.yml` 与 0.15.2 逐字一致（`better-sidebar` 行 id + 双挂载守卫不变）。**激活前提：DSH 内核
  ≥0.1.5-rc.1**（0.1.1-rc.2 无原生右栏服务，v0.19.0 无自有面板可退化）。
- `dsh-usage-stats`：**本地适配 DSH 0.1.3+ 持久化 API**：`readFrom` → `open('read')`+`SessionHandle.read`（语义等价，
  含 inclusive-seq/游标/contiguity 判定），`list()` 回退按 0.1.5 `SessionPersistenceSnapshot{header,revision}` 形状映射。
  上游 v0.3.2 仍调 `readFrom` 且改用 `@ychris12138/` scope（与 fork 裸名冲突），故保持冻结 0.2.5 基座打补丁。
  **激活前提：内核 ≥0.1.3+（0.1.3-alpha.2 起持久化 API 变更）**。
   另：**DSH 0.1.5 活跃会话折叠适配**（本地补丁）：0.1.5 起 host `Session` 不再暴露公开 `events` 数组
   （耐久日志私有，只经 `snapshotEvents(fromSeq, toSeqExclusive)` + `seq` 读取），live 折叠原先直读
   `session.events.length` 在 0.1.5 下 TypeError → `/api/usage-stats/usage` HTTP 500。现改经
   `snapshotEvents` 读取（其它形状 warn+skip，永不 500），回归测试见 `scripts/test-live-fold.mjs`
   （`npm run test:livefold`）。**激活前提：内核 ≥0.1.5**。
- `dsh-archive-manager`：去掉 `@mlgbnb/` 上游 scope 改名 `dsh-archive-manager`（package.json、
  cordis patch、预构建 lib 里的 client bundle id 一并替换）；README 安装说明为上游文档，
  本 fork 内不适用（本地 link 安装）。
  **DSH 0.1.3+ 会话日志名适配**（本地补丁）：新增 `resolveSessionLog()` 优先最高
  `session.vN.jsonl[.zstd]`、回退 legacy `session.jsonl[.zstd]`；预览/元数据/`hasDataFile` 全面走它。
  上游 1.0.8-1.0.10 仅补 DSH_HOME 支持、未适配版本化文件名，故保持冻结 1.0.7 基座打补丁。
  **激活前提：内核 ≥0.1.3+**。

## 备注

- **统一仓库**：插件源码由 `~/dsh-work` 这一个 git 仓库管理（提交 70881db 起步）。
  迁移前的 4 个独立仓库完整历史打包在 `~/dsh-work/.git-backup/*.bundle`（不入库，仅本地
  保险；`dsh-web-ui.bundle` 较大约 430MB，不需要可删）。
- 构建产物处理：`dsh-usage-stats` 的 `lib/` 随仓库入库（上游即如此，开箱即用）；
  其余两者的 `lib/`、`node_modules/` 一律忽略（各目录 .gitignore），改源码后需重新构建。
- 被裁掉的组件在 `~/.dsh/settings.yaml` 里的残留配置（pet / skin-custom-theme 等）是
  惰性配置，无害；如想清理，删掉对应小节即可。