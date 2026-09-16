# DSH Remote Web UI

[English](README.md) | 中文

> 手机与电脑远程访问：扫码配对后用手机远程使用当前 dsh web 工作区，同一枚令牌也可配对电脑浏览器、在其他设备上运行完整 Web GUI。

> **设置卡片**：远程控制配置（启用开关、令牌有效期、设备数量上限、隧道）位于官方 设置 → 插件 → 插件配置 列表的 `remote-web-ui` 标签页，不是独立的导航项。

本仓库是 DeepSeek Harness（DSH）的外部插件包：为 dsh web GUI 提供基于配对的手机与电脑远程访问。它是单一双半区包——host 半区持有配对令牌、设备会话与 `/api/pair` 路由族（已配对设备凭 cookie 被*识别*）；浏览器半区渲染侧边栏底部入口（设置按钮旁的手机图标入口）、带二维码的配对面板、实时设备状态、已授权设备列表，以及停止/刷新/复制操作。

> **本 fork 已移除 `/m/` 独立移动端界面**：手机与电脑使用同一条配对链接（`/api/pair/open?token=...` 引导链接），配对后都运行完整 Web GUI（小屏布局由 `dsh-ui-tweaks` 适配——左侧边栏收起为左上角鲸鱼 logo 抽屉）。

## 功能

- **入口**：设置按钮旁始终显示手机图标；悬停时显示“远程访问”提示。
- **面板**：「远程访问」标题、「通过手机或另一台电脑配对，远程访问当前工作区」副标题、「设备配对」卡片（含状态区「等待设备连接」+ 状态徽标）、大号二维码、一条**统一配对链接**（`/api/pair/open?token=...` 引导 URL，带复制按钮）、停止 / 刷新二维码操作，以及已授权设备列表（根据 User-Agent 推断的设备名称、在线/离线、最近活动时间、单台取消配对）。界面不渲染作为会话凭据的设备 id 或原始 User-Agent。该链接携带一枚一次性令牌，任意一台设备配对成功后立即失效。
- **设备侧（手机与电脑同一条路径）**：扫码或打开复制的链接会跑一轮两跳引导——`/api/pair/open` 这跳消费一次性、限时令牌并种下 HttpOnly 设备 cookie，然后重定向到 harness 原生的 launch-token URL（`/?token=...`），由原生 index 鉴权换出浏览器会话 cookie，设备最终落在**完整 Web GUI**——工作区、会话、聊天、切模型。全新设备不再收到 `workspace` 查询参数（原生 index 交换会重定向到干净的根路径）；已授权浏览器直接打开 `/?workspace=<id>` 链接仍可深链到目标工作区。手机小屏下的布局由 `dsh-ui-tweaks` 适配（左侧边栏自动隐藏，左上角只留一枚小鲸鱼 logo，点击展开为抽屉覆层）。
- **安全**：一个有效的一次性令牌（刷新会使旧链接失效；已接受的令牌不可复用；令牌会过期）。停止会撤销每一台已配对设备与当前令牌——被撤销的设备不再被本插件的配对面识别，必须重新扫码。**DSH 0.1.5 适配**：harness 的 `/api` 信任围栏是声明式的（`Connection` 配置 `trustedHosts` + 全接口绑定下自动信任的局域网字面量），其 index 还要求浏览器会话 cookie（由进程级 launch token 换出）；0.1.1 的 `api/gate` 逐请求 veto 环缝已不存在。配对因此是*身份/识别*而非对 harness 自身 `/api` 分发的访问控制：本插件拥有自己的 `/api/pair` 面，向兄弟插件暴露在线配对 cookie 谓词（`remoteWebUiPairing`），并管理令牌/会话生命周期——其引导跳会驱动设备走原生 launch-token 交换，并把当前公网主机在运行时镜像进 SDK 的 `/api` 信任列表（隧道主机在启动时不可知，无法经 `--trusted-host` 预先声明）；它不会否决 SDK 自身信任的 `/api` 流量。DSH ≥0.1.5 以 `0.0.0.0` 绑定时局域网 origin 默认被 SDK 信任；需要 `/api` 对局域网关闭时就绑定 loopback。
- **实时状态**：桌面面板经 SSE 流实时镜像配对状态（等待 → 已连接 → 已断开），并展示已授权设备名单。
- **远程更新**：本冻结 fork 已移除（侧边栏下载触发按钮、`/api/update` 端点与 npm registry 探测一并删除；本 fork 不从 npm 更新插件）。

## 需求

- 其 `dsh` CLI 支持 profile（`dsh --profile`、`dsh plugin`）的 DSH 安装——本包所依托的 profile/bundle 机制。
- 局域网使用必须手机可到达服务器：用 `dsh web --host 0.0.0.0` 启动。默认 `127.0.0.1` 绑定时，面板会显示明确说明而不是死二维码——除非配置了公网 base URL（见下文「通过互联网远程访问」），那会让二维码在无需重新绑定即可从任意位置访问。面板的 mint/stop 端点设计上仅限 loopback：在局域网 URL 打开的桌面浏览器只会看到「配对面板仅限本机使用」横幅——请在 `http://127.0.0.1` 打开面板，让手机使用配对链接。
- 一键公网隧道（`autoTunnel`）需要 `cloudflared` 平台二进制随包分发（其 postinstall 会下载它；运行时下载覆盖跳过 postinstall 脚本的安装器）。无需用户侧工具、账号或域名——Cloudflare quick tunnel 免费且匿名。
- 手机端不需要额外安装任何东西：它直接打开本插件的配对链接，在浏览器里运行完整 Web GUI（窄屏布局由 `dsh-ui-tweaks` 适配）。

## 安装

推荐直接安装全家桶聚合包 `@linxin666/dsh-web-ui-all`（一个包装齐全部功能插件与皮肤），或单独安装本插件：

```sh
### 从 npm 安装（推荐）
dsh plugin --profile web add dsh-remote-web-ui@latest

### 从仓库安装（开发调试）
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-remote-web-ui

```

重启 profile（`dsh web`），然后打开侧边栏底部的手机图标。插件的 `cordis.patch.yml` 插入装载两个半区的单条插件行。

> 本包经 GitHub 子目录渠道安装：`github:wptoux/dsh-work#<tag>&path:plugins/dsh-remote-web-ui`（pnpm ≥9.5），或用本地 `link:` 接线。本包随仓提交 `lib/`、无 `prepare` 构建，git 安装不会构建任何东西；仅原生二进制的安装脚本需 `allowBuilds` 放行（规范安装块见 `plugins/README.md` 的「GitHub 安装」章节）。

## 使用

1. `dsh web --host 0.0.0.0`（打印的局域网 URL 确认可达性）。
2. 点击手机图标 → 面板铸一枚新的二维码。
3. 用手机扫码（或打开复制的链接）：手机消费令牌、经原生 launch-token 交换一次跳转，落在**完整 Web GUI**。小屏下由 `dsh-ui-tweaks` 适配布局——左侧边栏自动隐藏，左上角只留一枚小鲸鱼 logo，点击展开为抽屉覆层；工作区、会话、聊天、模型切换与桌面完全一致。
4. **配对另一台设备（电脑或手机都一样）**：复制同一份链接，在另一台设备的浏览器打开（局域网 URL 或隧道 URL 均可）。接受往返后，完整 Web GUI 在那台设备上运行。一枚有效令牌配对一台设备；给下一台设备配对请刷新出新的二维码。
5. 桌面徽标实时翻到 已连接；设备离开时回落到离线/断开。
6. 刷新二维码 使旧链接失效并铸一枚新的。停止 撤销远程访问：被撤销的设备不再被识别，必须重新扫码。

配对链接跑一轮两跳引导直达完整 Web GUI：`/api/pair/open`（本插件）消费一次性令牌并种下设备 cookie，然后重定向到 harness 原生的 launch-token URL，由原生 index 鉴权换出浏览器会话 cookie 并落在 `/`。DSH ≥0.1.5 下 SDK 直接信任局域网字面量（以及任何配置的 `trustedHosts`）访问 `/api`，因此已配对的手机或电脑原生运行 GUI——**无需任何 harness 源码改动，也无需请求改写**。插件拥有 `/api/pair` 面（令牌 mint/accept/open/revoke/heartbeat/status/events）与 `remoteWebUiPairing` 服务：兄弟插件凭已配对设备的 cookie 识别它。

### 行为说明

- 配对是身份/识别（DSH ≥0.1.5）：插件在自己的 `/api/pair` 面上管理令牌、设备会话与撤销，并通过 `remoteWebUiPairing` 服务提供在线配对 cookie 谓词。它既不改写也不否决 harness 自身的 `/api` 流量——SDK 信任围栏（`trustedHosts` + 局域网字面量自动信任）是 harness 的接缝。需要 `/api` 对局域网关闭时就绑定 loopback（或收紧 `trustedHosts`）。
- `/api` 之外的兄弟 host 路由（`/pet/*`、`/git/*`、右侧面板的 `/aionui-panel/*`）可查询本插件的 `remoteWebUiPairing` 服务：有效的已配对设备 cookie 是放行路径，`stop()` 会停止识别这些 cookie；未安装本插件时该服务不存在。
- 二维码链接基于机器的非内部 IPv4 字面量构建；多宿主主机（Wi-Fi + 有线，或代理/VPN 虚拟适配器）会显示单选器供你发布手机实际可达的网络。第一个字面量是默认值。设 `publicBaseUrl` 后，单选器在顶部额外加一项 公网地址——默认二维码改用公网 base，选中局域网字面量会重新铸一枚网内链接。
- 配置的 `publicBaseUrl` 本身满足可达绑定需求：`dsh web` 绑定 `127.0.0.1`（不带 `--host 0.0.0.0`）仍能经隧道铸出可用的公网二维码链接。

## 通过互联网远程访问（隧道）

### 一键公网隧道（推荐）

在插件设置卡片打开 `autoTunnel`（或设 profile patch `autoTunnel: true`）。插件随后运行自己的 Cloudflare quick tunnel——`cloudflared` 二进制随包分发，无需安装、账号或域名——并自动接通一切：

- 铸出的 `https://xxx.trycloudflare.com` URL 成为二维码 base，因此任意地点的手机都能配对。面板显示隧道状态（starting / running / failed 带原因），崩溃按退避自动重启。

二维码在隧道报告其 URL 前保持仅局域网，且隧道重启会铸一枚**新的** hostname——插件清除旧链接并铸一枚新的，用户永远不必触碰配置。注意 quick tunnel 是公网的：任何拿到 URL 的人都能加载静态页；插件的边界在配对面自己的围栏上（`/api/pair` 控制端点仅限 loopback，面向手机的端点接受配置的公网主机）。隧道化 Host 不在连接信任围栏内，因此仅 loopback 绑定时隧道是唯一入口；`0.0.0.0` 绑定时 SDK 本就信任局域网 origin。

### 手动隧道（自带）

二维码链接通常是局域网 URL，所以家外的手机无法使用。把隧道指向 dsh web 端口，并告知插件其公网地址——二维码随后由隧道 URL 构建。涉及一个钮；`--trusted-host` 是独立的 SDK flag，不属于这条配对流：

- **`publicBaseUrl`**（插件配置，在 profile patch 或设置卡片里）：公网 origin，如 `https://foo.trycloudflare.com`。二维码链接由它构建，`accept`/`heartbeat`/`status` 接受它的主机。未配对调用方的 `status` 只看到配对相关字段（phase / 局域网地址）；token 过期时间、设备列表与隧道 URL 需要有效设备 cookie。accept 限速按客户端可见的 `X-Forwarded-For` 跳点分桶，避免隧道背后的单个来源耗尽共享桶。
- **`--trusted-host <隧道域名>`**（可选的 dsh web flag，不建议用于本插件）：该 flag 会让主机被 SDK 信任访问 `/api`——但浏览器会话 cookie 仍会门控每个请求，因此对本插件自己的隧道并不增加任何东西。插件会把当前公网主机在运行时镜像进 SDK 的 `/api` 信任列表（quick tunnel 的 hostname 启动时不可知，无法预先声明），这正是已配对手机所需的信任，而配对面继续守住身份围栏。SDK 没有给第三方插件留下逐请求 veto 的接缝（0.1.1 的 `api/gate` 已不存在），所以配对只覆盖插件自己的面；更收敛的姿态是依赖插件的镜像 + 浏览器 cookie，让设备走配对。

### Cloudflare 隧道（quick tunnel——无账号、无域名）

先安装一次客户端（macOS：`brew install cloudflared`；其他系统：从官方 GitHub releases 拿 `cloudflared-darwin-{arm64,amd64}` 二进制）。然后：

```sh
# 1. 暴露本地端口（dsh web 监听的任何端口）：
cloudflared tunnel --url http://127.0.0.1:3080
#    打印类似：https://xxxx-xxxx-xxxx.trycloudflare.com

# 2. 照常启动 dsh web。不必为隧道域名加 --trusted-host：插件会把当前
#    公网主机在运行时镜像进 SDK 的 /api 信任列表，浏览器会话 cookie 仍
#    门控每个请求。
#    仅需保留局域网访问时才加 --host 0.0.0.0：
dsh web
```

然后在 profile patch（或插件设置卡片——它会热重载）里设 `publicBaseUrl: https://xxxx-xxxx-xxxx.trycloudflare.com`。在 `http://127.0.0.1` 打开手机图标，从任意处扫码：手机消费令牌、经 launch-token 交换一次跳转、落在完整 Web GUI，心跳保持其在线。在另一台电脑浏览器打开同一隧道 URL 以同样方式配对，随后运行完整 Web GUI。

说明：

- Quick tunnel 免费无需登录，但 hostname 每次运行随机：每次 `cloudflared` 重启都变，所以 `publicBaseUrl` 要随之更新。Cloudflare 不保证 uptime；在途请求并发受限（超过返回 HTTP 429）。**Quick Tunnels 不转发 Server-Sent Events 但可以转发 WebSocket upgrade**——完整 Web GUI 的实时事件流正好走 WebSocket（`/api/events.mux` 升级），所以手机与远程电脑经由 quick tunnel 都能实时收消息；普通 HTTP 请求任何时候都可转发。
- Quick tunnel 是公网的：任何拿到 URL 的人都能加载静态页。插件的边界在配对面自己的围栏上（`/api/pair` 控制端点仅限 loopback；手机面端点接受配置的公网主机）外加 harness 的浏览器会话 cookie。插件会把公网主机镜像进 SDK 的 `/api` 信任列表，让已配对手机的 GUI 原生 API 调用通过 Host 围栏——cookie 仍门控每个请求；你不用也不应自己把隧道域名加进 `--trusted-host`。
- 稳定 hostname 可从 Cloudflare 控制台创建 named tunnel（Networking → Tunnels；域名必须托管在 Cloudflare），其 hostname 只用作 `publicBaseUrl`。Cloudflare 不保证中国大陆可达性；请本地验证。
- Tailscale 是无需任何插件改动的个人替代：其虚拟接口地址（`100.x.y.z`）自动出现在二维码的地址选择器中，同一 tailnet 的手机像局域网主机一样到达它。

## 开发

从这个仓库工作（无需 sibling checkout）：

```sh
cd ~/code/dsh-web-ui
export NPM_TOKEN='<token>'   # 仅当私有 @deepseek-ai 认证仍需要时
pnpm install
pnpm --filter dsh-remote-web-ui run build
pnpm --filter dsh-remote-web-ui test
pnpm --filter dsh-remote-web-ui run typecheck
```

peer APIs 来自官方 NPM SDK：这里用到的每个 `@deepseek-ai/*` 包都声明在 devDependencies（rc.6）里，TypeScript/Vitest 直接从 node_modules 解析类型——无需 DSH 源码 checkout。本包随仓提交 `lib/`（发版时由 `src` 构建）、无 `prepare` 构建，因此 git 安装同样无需任何 harness checkout。

## 检查

```sh
pnpm run typecheck
pnpm test
pnpm run build
```

## Harness 契约依赖

本插件依托的 harness seam（0.1.5 线）：

- **`/api` 信任围栏的声明式模型**（connection 配置 `trustedHosts` + 全接口绑定时自动信任局域网字面量）：0.1.1 的 `api/gate` 逐请求瀑布已被移除，SDK 也没有给第三方插件留下逐请求 veto 的接缝——因此配对是身份/识别（`/api/pair` 面 + `remoteWebUiPairing` 服务），不改写也不否决 harness 自身的 `/api` 分发。
- **`sidebar.footer.action` 底部列表座位**（packages/client/ui-sidebar）：侧边栏声明并渲染手机入口占据的座位（0.1.1 的 `sidebar.remote` 座位已删除）。
- **`settings.plugins.tab` 标签页座位**（packages/client/ui-settings）：设置 → 插件 → 插件配置 部分按命名空间派发本插件的配置卡片（0.1.1 的 `settings.plugin.item` keyed 座位已删除）。

围栏辅助（`isTrustedApiRequest` / `isLoopbackHostname`）在 `src/gate.ts` / `src/routes.ts` 本地重实现：SDK 从 20260810 起把信任围栏移进连接插件并停止导出它们，因此配对路由携带自己限定到二维码链接广告的字面量的副本。浏览器侧 `ctx.slots` 由本插件以结构类型自述（0.1.5 的 UI 包不在 cordis Context 上声明它；better-sidebar 采用同样的结构镜像）。

## 手动 E2E：局域网配对往返

单元/组件 spec 覆盖路由族、门与面板，但配对循环涉及非 loopback origin 上的真实浏览器。任何 wire 契约或连接循环改动后重复：

1. 用测试工作区根在所有接口上启动服务器：`dsh web --host 0.0.0.0 --port 3190 --workspace-root /tmp/remote-e2e`。
2. 在浏览器打开 **loopback** URL（`http://127.0.0.1:3190`）：手机图标在侧边栏底部；面板立即铸一枚二维码。
3. 在第二个 tab（或手机）打开带配对令牌的 **局域网** URL（如 `http://192.168.1.7:3190/api/pair/open?token=<token>`）：页面接受、设置 HttpOnly `dsh_pair` cookie、经原生 launch-token 交换一次跳转并启动完整 UI——无 console 错误，并且完成一次 generation 往返。
4. 桌面徽标实时翻到 已连接；局域网 origin 的桌面页则显示 配对面板仅限本机使用 横幅且不打开状态流。
5. 桌面 停止 切断手机：其下一个 `/api` 请求 403（重连循环重试直到新二维码重新配对）。

公网路径是经隧道的同一往返（见「通过互联网远程访问」）：loopback mint → 手机或 PC 打开公网二维码 URL → open 引导跳 + 原生 launch-token 交换 → UI。只有 `publicBaseUrl`（插件配置）命名隧道主机；`--trusted-host` 不属于这条配对流（插件的运行时信任镜像会处理公网主机）。桌面面板仍在 `http://127.0.0.1` 打开。

## 安全模型

- 插件的配对面按有效会话识别设备：`/api/pair` 的 stop/revoke 与 loopback 面板端点是 loopback-only 的，接受/打开/心跳/状态端点接受局域网字面量或配置的公网主机；`remoteWebUiPairing` 服务把"在线已配对 cookie"谓词交给兄弟插件。撤销是即时的：被撤销的设备不再被识别，必须重新扫码。harness 自身的 `/api` 信任（`trustedHosts` + 局域网自动信任）是 SDK 的接缝，本插件不否决它——它只把自身当前公网主机在运行时镜像进 SDK 信任列表（隧道主机启动时不可知），并驱动全新设备走原生 launch-token 交换，因此浏览器 cookie 始终门控 harness 自身的 `/api`。

## 已知限制与待办

- **撤销是逐请求的**：已配对设备的请求已在 停止 落地时在途，完成该请求；下一个 403。
- **已配对设备会话默认落盘**：设备会话（不含一次性二维码 token）写入 `$DSH_HOME/remote-web-ui-devices.json`（0600，临时文件加原子 rename）。已配对 cookie 在重启 `dsh web` 后仍然有效。刷新二维码仍会签发新 token；重启不会恢复当前二维码。点「停止」或单台「取消配对」会立即撤销并同步落盘。超过 `idleExpireMs`（默认 7 天，无心跳或配对请求）的会话会被删除，必须重新扫码。设备 id 即会话凭证（配对面按凭据中的设备 id 识别请求）。需要时可用 `devicesFile` 覆盖为其他绝对路径。变更 `cookieName` 会使旧设备失效（预期行为）。
- **设备名单仅本机可见**：配对面板根据 User-Agent 显示精简设备名称（例如 `Windows · Chrome`）、在线/离线状态与最近活动时间，并可单台取消配对。界面不渲染作为会话凭据的设备 id 或原始 User-Agent。`/api/pair/status` 即使对已配对设备也不返回设备 id 名单。
- **Quick-tunnel hostname 每次运行变化**：`trycloudflare.com` URL 每次 `cloudflared` 启动随机，所以隧道重启时 `publicBaseUrl` 必须随之更新。named tunnel（固定 hostname）避免这种抖动。
- **开发 HMR**：`dsh web --dev` 按路径轮询每个 roster bundle，因此重建本包（其自己的 `tsdown --watch`）会热重载 client bundle；无 harness 侧 watcher。

## 依赖理由

`qrcode.react`（MIT，活跃维护，React 16–19 支持）将二维码渲染为无依赖的 SVG 组件——无 canvas、无服务端图片生成。它在构建时内联进 client bundle（与官方 skin/turtle-ui 插件内联其非共享依赖相同），profile 安装无需超出 dsh peer closure 之外的额外运行时依赖。`schemastery` 是 DSH 标准配置 schema 校验器。
