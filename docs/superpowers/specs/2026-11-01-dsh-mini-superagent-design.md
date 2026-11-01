# dsh-mini-superagent 最小内核设计文档（票据 + 隔离会话 + 入口面板）

日期：2026-11-01
状态：已获用户批准（v2，2026-11-01）
修订：v2（2026-11-01）加入「SuperAgent 入口面板」「独立工作区分组」「终态回推」；
v1 的「工具注册到所有非 worker 会话」作废，改为只注册到 hub 会话。

## 背景与目标

`deepseek-ai/dsh-superagent-prototype` 的价值不在"多 agent 协作"——它的 worker 之间
互不通信，也没有共享任务板；它真正的结构是**一个中心会话 + 一圈并列的 worker 会话，
由 SQLite 里的票据（Ticket）把它们绑在一起**。worker 是顶层会话
（`sessionController.create`，无 `parentSession`），不是 `ctx.subagents` 的子 agent，
因为父子激活模型撑不住"主会话已经结束、进程重启、票还要继续跑"。

本设计把这个内核剥出来，只保留三条不变量：

1. **工作项是持久的**：票在库里，不在会话里。
2. **执行是隔离的**：每张票一个独立会话，上下文只有 mandate。
3. **重启可恢复**：进程死了再起来，知道自己刚才在跑什么。

目标：一个约 750 行的 DSH 插件（host ~600 + client ~150），在现有 web profile 里
提供一个 **SuperAgent 入口**，在那里派活、看票、看结果，并在 `kill -9` 之后自己接上。

## 非目标（本版明确不做）

- **不接任何外部事件源**：没有 GitHub、飞书、webhook、轮询。人是唯一的 Source。
- **不做授权**：没有 Policy、Mandate 版本、允许名单。所有票据等价于"操作者本人批准"。
- **不做评估**：没有 LLM 判定"这活该不该接"。`request_work` 即接受。
- **不自绘聊天界面**：入口面板只做票据列表与跳转，聊天复用 DSH 原生会话界面。
- **不做多用户、多实例、跨进程协调**：单进程 + stateDir 文件锁。
- **不做安全隔离**：worker 以操作者身份、`danger-full-access` 运行，这是已知边界。

## 已确认的决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 执行载体 | `sessionController.create` 建并列会话，不用 `ctx.subagents` | 需要独立 preset、独立 cwd、独立于父会话的生命周期 |
| 入口形态 | Launcher：侧边栏 SuperAgent 面板 + 打开 hub 会话 | 复用原生聊天 UI，client 代码 ~150 行；自绘聊天要 +500 行 |
| 列表隔离 | 所有会话归入专属 workspace，侧边栏显示为可折叠分组 | 内核没有"隐藏会话"的公开开关（见下） |
| 能力激活范围 | 只有 hub 会话注册 `request_work`/`list_tickets`/`ticket_control` | 普通会话零污染 |
| 终态回推 | 票终态时给 hub 会话发一条单行消息 | 否则用户必须手动 `list_tickets` |
| 派发方式 | 事件驱动 + 1s 兜底 tick | 不引入 superagent 的 2s passes 轮询成本 |
| 并发 | 默认 1 个 worker，可配 `maxWorkers` | 先串行，多 worker 是纯加法 |
| worker preset | M1 用内核 `standard`；后续再收窄 | 省掉一整个 preset 面 |
| 代码落点 | `plugins/dsh-mini-superagent` | 复用现有 link/构建/发布流程 |
| 仓库章程 | `AGENTS.md` 目录布局补一行"自研实验插件（非冻结上游）" | 本仓库首次出现自研插件，需显式标注 |

### 为什么是"工作区分组"而不是"隐藏"

内核（0.2.1-rc.2）里唯一能让会话不出现在侧边栏的硬开关是
`session.origin === 'subagent'`（`dsh-client-ui-workspace/lib/client.js` 的
`sessionVisible`）。但 subagent 会话**必须通过父会话的投递通道**收发
（`session/agent-busy ... use subagent delivery for this child session`），等于把执行
绑回父子模型——与本设计的第 3 条不变量冲突。另一条路是归档，但 Host 拒绝归档
"仍在工作"的会话，且归档后侧边栏不能直接打开。

所以本版接受：**会话仍在列表里，但只出现在 `superagent` 这一组下**，不与日常项目混排。

## 架构

```
┌────────────────────────────────────────────────────────────────────────┐
│                              DSH 进程                                   │
│                                                                        │
│  Web 客户端                                                            │
│  ┌──────────────────────────┐                                          │
│  │ 侧边栏 [SuperAgent] 入口   │──GET /mini-superagent/api/hub──────────┐  │
│  │ 面板：票据列表 + 打开主会话 │◀──{ hubSessionId, tickets }───────────┤  │
│  └────────────┬─────────────┘                                         │  │
│               │ uiWorkspace.openSession(hubSessionId)                 │  │
│               ▼                                                       │  │
│  ┌──────────────────────────┐   工具调用    ┌─────────────────────┐   │  │
│  │ hub 会话（原生聊天 UI）    │─────────────▶│ Engine（唯一写入口） │   │  │
│  │ 只它有 request_work 等     │              └──────────┬──────────┘   │  │
│  └──────────────────────────┘                         │ 单事务        │  │
│                                                       ▼              │  │
│                                            ┌─────────────────────┐   │  │
│                                            │ Store (node:sqlite) │◀──┘  │
│                                            │ tickets/assignments │      │
│                                            └──────────┬──────────┘      │
│                                                       │ 读 queued       │
│  ┌────────────┐  create(worker-<id>) + mandate        ▼                 │
│  │ Dispatcher │────────────────────────────▶ ┌──────────────────┐      │
│  │ 单飞 tick  │                              │ worker 会话       │      │
│  └────────────┘                              │ 只有 report 工具   │      │
│         ▲                                    └────────┬─────────┘      │
│         │ queueMicrotask(tick)                         │ report         │
│         └──────────────────────────────────────────────┘                │
│                                                                        │
│  终态 report → Store 更新 → 给 hub 会话发一条单行消息                     │
│  启动：running assignment → interrupted → 票回 queued → 带说明重派        │
└────────────────────────────────────────────────────────────────────────┘
```

组件职责（host 六个文件 + client 一个入口）：

| 组件 | 文件 | 职责 | 不做什么 |
|---|---|---|---|
| `Store` | `src/store.ts` | 打开库、迁移、票据/作业读写与事务包装 | 不含业务规则 |
| `Engine` | `src/engine.ts` | 状态机唯一写入口；每个命令一个事务 | 不建会话、不发消息 |
| `Dispatcher` | `src/dispatcher.ts` | 取 queued → 建会话 → 投喂 mandate；单飞 | 不改票状态（除失败上报） |
| `Sessions` | `src/session.ts` | workspace/hub/worker 会话创建、mandate 模板、session→ticket 查询 | 不决定调度 |
| `Tools` | `src/tools.ts` | 四个工具 | 不直接写库，全部走 Engine |
| `Runtime` | `src/index.ts` | 配置、锁、恢复、HTTP 路由、事件接线、退出清理 | 不含业务规则 |
| `Panel` | `src/client/index.tsx` | 侧边栏入口 + 票据面板 + 打开 hub | 不自己渲染聊天 |

## 数据模型

SQLite，`node:sqlite` 的 `DatabaseSync`，启动时设置：

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

```sql
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL              -- 'schema_version'='1'；'hub_session'=<SessionId>
);

CREATE TABLE IF NOT EXISTS tickets (
  id                TEXT PRIMARY KEY,   -- 't-<8 hex>'
  title             TEXT NOT NULL,
  request           TEXT NOT NULL,      -- 用户原话，进入 mandate
  state             TEXT NOT NULL CHECK (state IN ('queued','working','waiting','blocked','failed','ended')),
  outcome           TEXT CHECK (outcome IN ('completed','stopped','failed')),  -- 仅 ended
  summary           TEXT,               -- 最近一次 report 的摘要
  work_dir          TEXT NOT NULL,      -- 相对 workspace 的票据目录，如 'work/t-3f2a9c1b'
  origin_session_id TEXT NOT NULL,      -- 发起票的会话（本版恒为 hub）
  revision          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,      -- ISO 8601 UTC
  updated_at        TEXT NOT NULL,
  ended_at          TEXT
);

CREATE INDEX IF NOT EXISTS tickets_dispatch ON tickets(created_at) WHERE state = 'queued';

CREATE TABLE IF NOT EXISTS assignments (
  id            TEXT PRIMARY KEY,   -- 'a-<8 hex>'
  ticket_id     TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  attempt       INTEGER NOT NULL,   -- 从 1 开始
  state         TEXT NOT NULL CHECK (state IN ('running','ended','interrupted')),
  session_id    TEXT NOT NULL,      -- 'worker-<ticket id>-a<attempt>'
  recovery_note TEXT,               -- 本次尝试为什么被拉起
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  UNIQUE (ticket_id, attempt)
);

-- 一张票同一时刻最多一个 running 作业；并发正确性的兜底
CREATE UNIQUE INDEX IF NOT EXISTS assignments_one_running
  ON assignments(ticket_id) WHERE state = 'running';
```

不变量：

- `tickets.state = 'working'` ⇔ 存在且仅存在一个 `assignments.state = 'running'`。
- 所有会话的 `cwd` 都是同一个 workspace 目录；票据目录是它下面的子目录（见下）。
- 数据库是唯一事实源；会话历史不是。删掉会话不影响票，反过来不行。

## 会话与工作区

```
workspace 目录 : <stateDir>/superagent
hub 会话 id    : mini-hub-<8 hex>        （首次打开入口时创建，写入 meta.hub_session）
worker 会话 id : worker-<ticket id>-a<attempt>  （例：worker-t-3f2a9c1b-a1；每次尝试新建）
所有会话 cwd   : <stateDir>/superagent      （同一 workspace → 侧边栏只有一组）
票据工作目录   : <stateDir>/superagent/work/<ticket id>   （由 mandate 指定，见下）
preset         : hub 与 worker 都用内核 standard（M1）
权限           : danger-full-access（与 superagent 一致）
```

为什么让所有会话共用一个 cwd：DSH 的 workspace 由 cwd 决定，每个 ticket 一个 cwd 就会
在侧边栏生成一组工作区，等于把列表刷满。所以工作目录靠 **mandate 指定相对子目录**
实现隔离，而不是靠会话 cwd——这也正好符合"工作目录靠上下文和记忆"的取舍。代价是
文件工具的相对路径都相对 workspace 根，模型要么用 `work/<ticket>/...` 前缀，要么 `cd`。

### hub 会话

- 首次点击入口时创建；id 存 `meta.hub_session`，之后复用。
- 只有它的 agent 作用域注册 `request_work` / `list_tickets` / `ticket_control`。
- 追加一段 system prompt 角色说明（约 10 行）：你是 SuperAgent 的调度员；接活前先判断
  是否该拆；派活后只回一句"已派发 t-xxxx"；收到 `[minisuperagent]` 开头的回推时只做
  一句话转述，不展开分析。
- 终态回推以一条 user 消息写进这个会话（见「回推」）。

### worker 会话

- 只注册 `report`。
- 上下文从零开始：首条消息是 mandate。
- 每次尝试都是新会话（id 带 attempt），重试不继承上一次的历史。
- 失败不自动重试（避免错误风暴），由人 `retry`。

### mandate 模板

```text
你是 mini-superagent 的 worker，只负责票据 <id>。

请求：
<request>

工作目录：<work_dir>（相对当前目录，每条命令都带上该前缀）

规则：
- 只在该子目录内改动；不要创建或管理工作项。
- 有结论时调用 report({ state: "ended", summary: "做了什么、验证了什么" })。
- 需要人拍板时调用 report({ state: "blocked", summary: "卡在哪、需要什么" })。
- 失败时调用 report({ state: "failed", summary: "错误与已尝试的动作" })。
- 这一轮先收工时调用 report({ state: "waiting", summary: "下一步" })。
- 不要向用户提问（没有问答通道），把问题写进 blocked 的 summary。
- 终态 report 之后不要再调用 report。

<恢复说明，如有>
```

## 入口面板（client）

- 注册 `sidebar.panellist` 图标 + `main` 面板（键 `dsh-mini-superagent`），与
  superagent 的做法一致。
- 面板内容：票据列表（id / 标题 / 状态 / 最近摘要 / 时间）+ 一个「打开主会话」按钮。
- 数据来自 `GET /mini-superagent/api/hub`；面板可见时每 3 秒刷新一次，离开即停。
- 「打开主会话」→ 取 `hubSessionId` → `ctx.uiWorkspace.openSession(target)`。
- 面板自身不渲染聊天；聊天发生在 DSH 原生会话界面里。

HTTP 路由（host，挂在 `ctx.webServer` 下）：

| 方法 | 路径 | 返回 |
|---|---|---|
| GET | `/mini-superagent/api/hub` | `{ hubSessionId, tickets: TicketView[] }`，必要时先创建 hub 会话与 workspace |
| GET | `/mini-superagent/api/health` | `{ ok, schemaVersion, running, queued }` |

路由自带 `Host` / 代理栅栏：处理器在做事之前检查 `Host` 头，必须是 `127.0.0.1`、
`localhost` 或 `[::1]`（可带端口），并拒绝带 `Forwarded`、`X-Forwarded-For`、
`X-Forwarded-Host`、`X-Forwarded-Proto` 或 `CF-Connecting-IP` 的请求（cloudflared
快隧道会把 `Host` 改写成源站），任一命中一律 403。这两条路由位于 web server 的 `/api` 连接栅栏之外，profile 开着 tunnel
时也不会被远程读取；除此之外不做令牌鉴权。

## 回推

票进入终态（`ended` / `blocked` / `failed` / `waiting`）时，Engine 返回后由 Runtime 向
`origin_session_id` 发送一条单行消息：

```
[minisuperagent] t-3f2a9c1b 完成：改了 3 处命令，跑过 pnpm install 验证
[minisuperagent] t-3f2a9c1b 已停止（用户）
[minisuperagent] t-3f2a9c1b 卡住：需要确认是否删除旧分支
[minisuperagent] t-3f2a9c1b 挂起：等下一步指示（retry 继续）
```

- `progress` 不发（避免噪音）；其余终态都发，因为之后不会自己继续。
- 发送失败先重试一次 `meta.hub_session`（origin 会话被删时的兜底）；两者都失败才记日志，
  不影响票据状态。
- 消息会唤醒 hub 会话的一个回合——这是有意的，等价于 superagent 的 notice。

## 状态机

票（Ticket）：

| 起始 | 事件 | 目标 | 守卫 / 副作用 |
|---|---|---|---|
| `queued` | dispatcher 领取 | `working` | 建 assignment(running)、会话 |
| `working` | `report(progress)` | `working` | 只更新 summary，作业继续 running |
| `working` | `report(waiting)` | `waiting` | 作业结束，本次尝试到此为止 |
| `working` | `report(blocked)` | `blocked` | 作业结束；等 `retry` |
| `working` | `report(failed)` | `failed` | 作业结束；等 `retry` |
| `working` | `report(ended)` | `ended(completed)` | 作业结束 |
| `blocked`/`failed`/`waiting` | `ticket_control(retry)` | `queued` | 清 summary，attempt +1 |
| 任意未结束 | `ticket_control(stop)` | `ended(stopped)` | 只标记票与作业结束，**不强制中断回合**；要立刻停手由人在 worker 会话里按 DSH 的停止按钮 |
| `working` | 进程启动恢复 | `queued` | assignment → interrupted，带恢复说明 |

作业（Assignment）：`running → ended`（report 终态或 graceful shutdown）、
`running → interrupted`（崩溃恢复 / 用户 stop）。
**没有从 ended/interrupted 回到 running 的路径**——重试永远是新 attempt。

`waiting` 的含义是"worker 主动收工、票还开着"：本版没有向 worker 投递新消息的通道，
只能由人 `retry` 唤起。`waiting`、`blocked`、`failed`、`ended` 都是**本次尝试的终态**，
工具响应里要明确写出"不要再调用 report"。

## 命令契约（Engine）

全部同步方法，内部 `BEGIN IMMEDIATE` / `COMMIT`；失败回滚并把错误抛给调用方。

| 命令 | 输入 | 返回 | 事务内做的事 | 幂等性 |
|---|---|---|---|---|
| `createTicket` | `title, request, originSessionId, workDir` | `Ticket` | 插 ticket(queued) | 不幂等（每次新建） |
| `dispatchNext` | — | `{ticket, assignment} \| undefined` | 取最老 queued → working + 插 assignment(running)；上一次作业是 interrupted 时把说明写入 `recovery_note` | 靠 `one_running` 兜底；调用方单飞 |
| `report` | `sessionId, state, summary` | `{ticket, notify}` | 按 session 找 running assignment → 更新票与作业；返回是否需要回推 | 终态只接受一次：第二次抛 `report/terminal-twice` |
| `retry` | `ticketId` | `Ticket` | blocked/failed/waiting → queued | 其余状态抛 `ticket/not-retryable` |
| `stop` | `ticketId` | `{ticket, sessionId?}` | 未结束 → ended(stopped)；有 running 作业则置 interrupted 并返回 sessionId（仅用于提示人去停） | 已结束抛 `ticket/not-open` |
| `failDispatch` | `ticketId, error` | `Ticket` | 票 → failed，running 作业 → interrupted，summary 写错误 | 仅 Dispatcher 调用 |
| `recover` | — | `number` | 所有 running → interrupted；对应票回 queued | 只在启动调用一次 |
| `interruptAll` | — | `number` | 退出路径：所有 running → interrupted，票回 queued | 幂等 |
| `listTickets` | `limit?` | `TicketView[]` | 最多 `limit` 张：未结束票优先，剩余名额给最近已结束票（至多 10 张） | 只读 |

错误是带 code 的类型化错误：`ticket/not-found`、`ticket/not-open`、`ticket/not-retryable`、
`assignment/not-running`、`report/terminal-twice`、`report/unknown-state`。

## 工具

| 工具 | 注册范围 | schema | 行为 |
|---|---|---|---|
| `request_work` | 仅 hub | `{ title: string(1..120), request: string(1..8000) }` | 建票，返回 ticket id、work_dir 与队列位置 |
| `list_tickets` | 仅 hub | `{ limit?: 1..50 }` | 列出未结束票 + 最近已结束票（总数为 limit，未结束优先） |
| `ticket_control` | 仅 hub | `{ action: "retry"\|"stop", ticket_id }` | 调 Engine.retry / stop；stop 后中断对应会话 |
| `report` | 仅 worker | `{ state: "progress"\|"waiting"\|"blocked"\|"failed"\|"ended", summary: string(1..4000) }` | 调 Engine.report；返回票状态与"不要再 report"提示 |

注册方式：`ctx.on('agent/created', …)`，按 `agent.id === meta.hub_session` 或
`sessionId` 前缀 `worker-` 判断角色；工具注册在 `agent.ctx` 作用域内，随 agent 释放注销。
插件挂载时遍历已加载的 agent 补一次注册。

两个必须处理的时序问题：

1. **工具先于消息**：`agent/created` 的处理是异步的，Dispatcher 在 `create` 之后不能立刻
   `prompt`；为每个新 worker 等一个 `decorated` promise（5s 超时，超时按派发失败处理）。
2. **作用域隔离**：hub 的 `request_work` 在 worker 会话里不存在；handler 仍按会话 id
   再校验一次，防止意外的全局注册。

## 调度与恢复

```
createTicket / retry / report(waiting|blocked|failed|ended) ──▶ queueMicrotask(tick)
report(progress)                                          ──▶ 不触发（槽位没释放）

tick():
  if (inflight) return; inflight = true
  while (runningCount() < maxWorkers):
    claim = engine.dispatchNext(); if (!claim) break
    await sessions.launch(claim)       // 失败走 engine.failDispatch
  inflight = false

兜底：setInterval(tick, 1000)，无 queued 时是纯读
```

启动序列（`src/index.ts`）：

1. 校验 `stateDir`（绝对路径），`mkdir -p`，`proper-lockfile` 上锁（stale 30s）。
2. 打开库、建表、校验 `schema_version`。
3. `engine.recover()` → `ctx.logger.info` 记录回收数量。
4. 注册 HTTP 路由、工具与 `agent/created` 订阅。
5. `tick()`；启动 1s 兜底定时器。
6. 退出：清定时器 → `engine.interruptAll()`（票回 queued）→ 释放锁。**不 kill 会话。**

崩溃（`kill -9`）后锁 30s 过期，下次启动 `recover()` 把 running 收掉。

## 错误处理

| 场景 | 处理 |
|---|---|
| 会话创建 / prompt 失败 | assignment interrupted，票 failed，summary 带错误；`retry` 可重来 |
| worker 调 `report` 但没有 running assignment | `assignment/not-running`，工具报错 |
| 同一 assignment 第二次终态 report | `report/terminal-twice`，工具报错（不静默） |
| 票已 ended 后 worker 仍在跑（stop 后） | report 被拒；`stop` 返回 sessionId，回推里提示"去该会话按停止" |
| 回推失败（hub 会话被删） | 只记日志，票据状态不变 |
| 数据库损坏 / schema 更新 | 启动失败并打印原因；不自动重建 |
| 重复实例 | 文件锁失败，插件挂载报错，不降级运行 |

## 配置与打包

包 `dsh-mini-superagent`（`type: module`，`main: lib/index.js`，tsdown 构建 host 与
client 两个 entry，与 superagent 的 `dsh.client` 声明一致）：

```yaml
- id: dsh-mini-superagent
  config:
    stateDir: /root/.dsh/state/mini-superagent   # 必填，绝对路径
    maxWorkers: 1                                 # 可选，1..4
    workerPreset: standard                        # 可选
```

workspace 固定在 `<stateDir>/superagent`，票据目录 `<stateDir>/superagent/work/<id>`；
`cordis.patch.yml` 只插入一个 entry。profile 通过
`dsh plugin --profile web add link:<path>` 安装并加入 `dsh.profile.bundles`。

包声明与 superagent 同构：

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    "inject": [
      "@deepseek-ai/dsh-client-ui-layout",
      "@deepseek-ai/dsh-client-ui-sidebar",
      "@deepseek-ai/dsh-client-ui-workspace"
    ]
  }
}
```

`inject` 只列面板真正调用的三个客户端包：`sidebar.panellist` 席位来自 sidebar，
`main` 面板与 `uiWorkspace.openSession` 来自 layout / workspace。

运行时依赖：`proper-lockfile`、`zod`；`@deepseek-ai/schemastery` 走 peerDependencies；
SQLite 用 Node 内置 `node:sqlite`，不引入原生模块。client 侧只依赖
`@deepseek-ai/dsh-client-ui-layout` / `-sidebar` / `-workspace` 的类型。

## 安全边界

worker 以操作者的 OS 用户、`danger-full-access` 运行，能读写整台机器。workspace 与
`work_dir` 只是约定，不是沙箱；`report` 的校验只防误用，不防恶意。需要真隔离时，
把整个 DSH 跑在独立 OS 账户里。

## 测试点

单元（不依赖 DSH，fake session 后端 + 真 SQLite 临时库）：

1. 状态机：每条合法迁移走通；非法迁移抛对应 code。
2. 幂等：同一 assignment 二次 `ended` 抛 `report/terminal-twice`；票状态不变。
3. 恢复：插入 running assignment + working 票 → `recover()` → interrupted + queued，
   下一次 dispatch 的 `recovery_note` 非空。
4. 并发：`dispatchNext` 只剩一张票时被调用两次，第二次返回 `undefined`。
5. 回推：终态 report 返回 `notify: true`；`progress` 返回 `false`。
6. 鉴权面：`request_work` 在非 hub 会话 id 上调用被拒。

集成（手工，真 DSH）：

1. 侧边栏出现 SuperAgent 入口；点击后主区域打开 hub 会话，普通会话里没有
   `request_work` 工具。
2. 在 hub 里说"派个活"，1s 内 `worker-*` 会话出现在 `superagent` 分组下。
3. worker `report(ended)` → 票变 ended → hub 会话收到一行回推。
4. 跑到一半 `kill -9` → 重启后同一票 attempt=2，mandate 带恢复说明。
5. worker 会话里看不到 hub 的对话历史。

## 里程碑

| 阶段 | 内容 | 预估 |
|---|---|---|
| M1 | Store + Engine + Tools + 串行 Dispatcher + hub/worker 会话管理，无 UI、无恢复 | ~420 行 |
| M2 | 入口面板（client）+ HTTP 路由 + 终态回推 | ~180 行 |
| M3 | `recover()` + 锁 + 失败路径 + 单元测试 | ~150 行 |
| M4（可选） | 专用 worker preset、`maxWorkers > 1` | ~80 行 |

## 未来扩展（按需，不预埋）

- 授权：加 `policy` 表 + 票上 `mandate` 字段。
- 外部源：加 Source 抽象与读位置，`createTicket` 变成幂等 upsert。
- 回写：加 outbox 表与 Channel 适配（GitHub 评论、飞书消息）。
- 自绘面板：把 hub 的聊天搬到面板里，需要自己实现消息流与输入。

以上任何一项都不改动本设计的三个不变量。
