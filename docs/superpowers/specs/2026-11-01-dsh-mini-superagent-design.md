# dsh-mini-superagent 最小内核设计文档（票据 + 隔离会话 + 重启恢复）

日期：2026-11-01
状态：待用户审阅

## 背景与目标

`deepseek-ai/dsh-superagent-prototype` 的价值不在"多 agent 协作"——它的 worker 之间
互不通信，也没有共享任务板；它真正的结构是**一个中心会话 + 一圈并列的 worker 会话，
由 SQLite 里的票据（Ticket）把它们绑在一起**。worker 是顶层会话（`sessionController.create`，
无 `parentSession`），不是 `ctx.subagents` 的子 agent，因为父子激活模型撑不住
"主会话已经结束、进程重启、票还要继续跑"。

本设计把这个内核剥出来，只保留三条不变量：

1. **工作项是持久的**：票在库里，不在会话里。
2. **执行是隔离的**：每张票一个独立会话，上下文只有 mandate。
3. **重启可恢复**：进程死了再起来，知道自己刚才在跑什么。

目标：一个 ~550 行的 DSH 插件，能在现有 profile 里用一句话派活、看到结果，并在
`kill -9` 之后自己接上。

## 非目标（本版明确不做）

- **不接任何外部事件源**：没有 GitHub、飞书、webhook、轮询。人是唯一的 Source。
- **不做授权**：没有 Policy、Mandate 版本、允许名单。所有票据等价于"操作者本人批准"。
- **不做评估**：没有 LLM 判定"这活该不该接"。`request_work` 即接受。
- **不做面板 / HTTP / 客户端**：状态通过工具查询和 DSH 自带会话列表查看。
- **不做多用户、多实例、跨进程协调**：单进程 + stateDir 文件锁。
- **不做安全隔离**：worker 以操作者身份、`danger-full-access` 运行，这是已知边界。

## 已确认的决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 执行载体 | `ctx.sessionController.create` 建并列会话，不用 `ctx.subagents` | 需要独立 preset、独立 cwd、独立于父会话的生命周期 |
| 派发方式 | 事件驱动 + 1s 兜底 tick | 不引入 superagent 的 2s passes 轮询成本 |
| 并发 | 默认 1 个 worker，可配 `maxWorkers` | 先串行，多 worker 是纯加法 |
| worker preset | M1 用内核 `standard`；M2 再引入专用 preset | 省掉一整个 patch 面，先验证内核 |
| 代码落点 | `plugins/dsh-mini-superagent` | 复用现有 link/构建/发布流程 |
| 仓库章程 | `AGENTS.md` 目录布局补一行"自研实验插件（非冻结上游）" | 本仓库首次出现自研插件，需显式标注 |

## 架构

```
┌──────────────────────────────────────────────────────────────────┐
│                           DSH 进程                                │
│                                                                  │
│  [任意非 worker 会话]                                             │
│      │ tool: request_work(title, request)                        │
│      ▼                                                           │
│  ┌───────────┐   单事务    ┌─────────────────────────────────┐   │
│  │  Engine   │───────────▶│ Store (node:sqlite, WAL)        │   │
│  │ 唯一写入口 │◀───────────│ tickets / assignments / meta    │   │
│  └─────┬─────┘   读 queued └─────────────────────────────────┘   │
│        │                                                         │
│        ▼                                                         │
│  ┌───────────┐  workspaceRegistry.create(workRoot/<ticket>)      │
│  │ Dispatcher│  sessionController.create(mini-worker-<id>)       │
│  │ 单飞 tick  │  prompt(mandate)                                  │
│  └─────┬─────┘                                                   │
│        ▼                                                         │
│  ┌────────────────────┐  tool: report(state, summary)           │
│  │ Worker Session      │──────────────────────────┐              │
│  │ 每票一个，上下文只有  │                          ▼              │
│  │ mandate + 工具       │                   Engine.report        │
│  └────────────────────┘                   → 票状态 + assignment   │
│                                                                  │
│  启动：running assignment → interrupted → 票回 queued → 带说明重派 │
└──────────────────────────────────────────────────────────────────┘
```

组件职责（六个文件，互不越界）：

| 组件 | 文件 | 职责 | 不做什么 |
|---|---|---|---|
| `Store` | `src/store.ts` | 打开库、迁移、提供票据/作业的读写与事务包装 | 不含业务规则 |
| `Engine` | `src/engine.ts` | 状态机唯一写入口；每个命令一个事务 | 不建会话、不发消息 |
| `Dispatcher` | `src/dispatcher.ts` | 取 queued → 建 workspace/会话 → 投喂 mandate；单飞 | 不改票状态（除失败上报） |
| `Sessions` | `src/session.ts` | 会话创建、mandate 模板、session→ticket 查询 | 不决定调度 |
| `Tools` | `src/tools.ts` | `request_work` / `list_tickets` / `ticket_control` / `report` | 不直接写库，全部走 Engine |
| `Runtime` | `src/index.ts` | 组合根：配置、锁、启动恢复、事件接线、退出清理 | 不含业务规则 |

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
  value TEXT NOT NULL              -- 'schema_version' = '1'
);

CREATE TABLE IF NOT EXISTS tickets (
  id         TEXT PRIMARY KEY,     -- 't-<8 hex>'
  title      TEXT NOT NULL,
  request    TEXT NOT NULL,        -- 用户原话，进入 mandate
  state      TEXT NOT NULL CHECK (state IN ('queued','working','waiting','blocked','failed','ended')),
  outcome    TEXT CHECK (outcome IN ('completed','stopped','failed')),  -- 仅 ended
  summary    TEXT,                 -- 最近一次 report 的摘要
  revision   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,        -- ISO 8601 UTC
  updated_at TEXT NOT NULL,
  ended_at   TEXT
);

CREATE INDEX IF NOT EXISTS tickets_dispatch ON tickets(created_at) WHERE state = 'queued';

CREATE TABLE IF NOT EXISTS assignments (
  id            TEXT PRIMARY KEY,  -- 'a-<8 hex>'
  ticket_id     TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  attempt       INTEGER NOT NULL,  -- 从 1 开始
  state         TEXT NOT NULL CHECK (state IN ('running','ended','interrupted')),
  session_id    TEXT NOT NULL,     -- 'mini-worker-<ticket id>'
  recovery_note TEXT,              -- 本次尝试为什么被拉起（恢复说明）
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  UNIQUE (ticket_id, attempt)
);

-- 一张票同一时刻最多一个 running 作业；这是并发正确性的兜底
CREATE UNIQUE INDEX IF NOT EXISTS assignments_one_running
  ON assignments(ticket_id) WHERE state = 'running';
```

不变量：

- `tickets.state = 'working'` ⇔ 存在且仅存在一个 `assignments.state = 'running'`。
- 票的 `revision` 每次状态变更 +1，只用于审计与面板排序；本版单用户，`ticket_control`
  不做乐观锁校验，用 `state` 守卫即可。
- 数据库是唯一事实源；会话历史不是。删掉会话不影响票，反过来不行。

## 状态机

票（Ticket）：

| 起始 | 事件 | 目标 | 守卫 / 副作用 |
|---|---|---|---|
| `queued` | dispatcher 领取 | `working` | 建 assignment(running)、会话、workspace |
| `working` | `report(progress)` | `working` | 只更新 summary，作业继续 running |
| `working` | `report(waiting)` | `waiting` | 作业结束（ended），本次尝试到此为止 |
| `working` | `report(blocked)` | `blocked` | 作业结束；等 `retry` |
| `working` | `report(failed)` | `failed` | 作业结束；等 `retry` |
| `working` | `report(ended)` | `ended(completed)` | 作业结束 |
| `blocked`/`failed`/`waiting` | `ticket_control(retry)` | `queued` | 清 summary，attempt +1 |
| 任意未结束 | `ticket_control(stop)` | `ended(stopped)` | 有 running 作业则中断会话并置 interrupted |
| `working` | 进程启动恢复 | `queued` | assignment → interrupted，带恢复说明 |

作业（Assignment）：`running → ended`（report 终态或 graceful shutdown）、
`running → interrupted`（崩溃恢复 / 用户 stop）。
**没有从 ended/interrupted 回到 running 的路径**——重试永远是新 attempt。

`waiting` 的含义是"worker 主动收工、票还开着"：本版没有向 worker 投递新消息的通道，
所以它只能由人 `retry` 唤起（新 attempt）。不想保留这个语义时可以把它并进 `blocked`，
但状态机与测试要一起改。`waiting`、`blocked`、`failed`、`ended` 都是**本次尝试的终态**：
`report` 返回后该作业即结束，模型不应在同一回合里再调一次；工具响应里要明确写出这一点。

## 命令契约（Engine）

全部同步方法，内部 `db.exec('BEGIN IMMEDIATE')` / `COMMIT`；失败回滚并把错误抛给调用方。

| 命令 | 输入 | 返回 | 事务内做的事 | 幂等性 |
|---|---|---|---|---|
| `createTicket` | `title, request` | `Ticket` | 插 ticket(queued) | 不幂等（每次新建） |
| `dispatchNext` | — | `{ticket, assignment} \| undefined` | 取最老 queued → working + 插 assignment(running)；若该票上一次作业是 interrupted，把说明写入新作业的 `recovery_note` | 靠 `one_running` 唯一索引兜底；调用方保证单飞 |
| `report` | `sessionId, state, summary` | `Ticket` | 按 session 找 running assignment → 更新票与作业 | 终态只接受一次：第二次抛 `report/terminal-twice` |
| `retry` | `ticketId` | `Ticket` | blocked/failed/waiting → queued | 其余状态抛 `ticket/not-retryable` |
| `stop` | `ticketId` | `{ ticket, sessionId? }` | 未结束 → ended(stopped)；有 running 作业则置 interrupted 并返回其 `session_id` 供调用方中断会话 | 已结束抛 `ticket/not-open` |
| `failDispatch` | `ticketId, error` | `Ticket` | 票 → failed，running 作业 → interrupted，summary 写错误 | 仅由 Dispatcher 在派发失败时调用 |
| `recover` | — | `number` | 所有 running → interrupted；对应票回 queued | 只在启动调用一次 |
| `interruptAll` | — | `number` | 退出路径：所有 running → interrupted，票回 queued | 幂等 |

错误是带 code 的类型化错误：`ticket/not-found`、`ticket/not-open`、`ticket/not-retryable`、
`assignment/not-running`、`report/terminal-twice`、`report/unknown-state`。

## 会话与工具

### 会话

```
id        : mini-worker-<ticket id>          （例：mini-worker-t-3f2a9c1b）
preset    : standard（M1）
cwd       : <workRoot>/<ticket id>           （默认 <stateDir>/work）
权限      : danger-full-access（与 superagent 一致，见安全边界）
```

派发成功 = `create` + `prompt(mandate)` 都成功。任一步失败：assignment → interrupted，
票 → failed，summary 写错误文本；用户可 `retry`。**失败不自动重试**（避免错误风暴）。

### mandate 模板（写入 system prompt 外的首条 user 消息）

```text
你是 mini-superagent 的 worker，只负责票据 <id>。

请求：
<request>

规则：
- 只在该票据的工作目录内改动；不要创建或管理工作项。
- 有结论时调用 report({ state: "ended", summary: "做了什么、验证了什么" })。
- 需要人拍板时调用 report({ state: "blocked", summary: "卡在哪、需要什么" })。
- 失败时调用 report({ state: "failed", summary: "错误与已尝试的动作" })。
- 仍在推进、但这一轮先停下时调用 report({ state: "waiting", summary: "下一步" })。
- 不要向用户提问（没有问答通道），把问题写进 blocked 的 summary。

<恢复说明，如有>
```

### 工具

| 工具 | 注册范围 | schema | 行为 |
|---|---|---|---|
| `request_work` | 非 worker 会话 | `{ title: string(1..120), request: string(1..8000) }` | 建票，返回 `ticket id` 与当前队列位置 |
| `list_tickets` | 非 worker 会话 | `{ limit?: 1..50 }` | 列出未结束票 + 最近 10 张已结束票 |
| `ticket_control` | 非 worker 会话 | `{ action: "retry"\|"stop", ticket_id }` | 调 Engine.retry / stop |
| `report` | 仅 `mini-worker-*` 会话 | `{ state: "progress"\|"waiting"\|"blocked"\|"failed"\|"ended", summary: string(1..4000) }` | 调 Engine.report；返回票的新状态 |

注册方式：`ctx.on('agent/created', …)`，按会话 id 前缀判断角色；worker 的 report 工具
注册在 `agent.ctx` 作用域内，随 agent 释放自动注销（对齐 superagent 的 `decorate` 模式）。
插件挂载时先遍历已加载的 agent 补一次注册，避免重启前就打开的会话没有工具。

两个必须处理的时序问题：

1. **工具先于消息**：`agent/created` 的处理是异步的，Dispatcher 在 `create` 之后不能立刻
   `prompt`，否则首条消息可能早于 `report` 注册。Dispatcher 为每个新会话等待一个
   `decorated` promise 再投喂 mandate（带 5s 超时；超时按派发失败处理）。
2. **递归防护**：worker 会话里不注册 `request_work`；即便模型硬调，handler 也按会话 id
   前缀拒绝，避免"worker 给自己派活"。

## 调度与恢复

```
createTicket / retry / report(waiting|blocked|failed|ended) ──▶ queueMicrotask(tick)
report(progress)                                          ──▶ 不触发（槽位没释放）
tick():
  if (inflight) return; inflight = true
  while (runningCount < maxWorkers):
    claim = engine.dispatchNext(); if (!claim) break
    await sessions.launch(claim)       // 失败走 engine.failDispatch
  inflight = false
兜底：setInterval(tick, 1000)，tick 无 queued 时是纯读，成本可忽略
```

启动序列（`src/index.ts`）：

1. 校验 `stateDir`（绝对路径），`mkdir -p`，`proper-lockfile` 上锁（stale 30s）。
2. 打开库、迁移、校验 `schema_version`。
3. `engine.recover()` → 打印 `recovered N interrupted assignments`。
4. 注册工具与 `agent/created` 订阅。
5. `tick()`；启动 1s 兜底定时器。
6. 退出（plugin dispose）：清定时器 → 对每个 running assignment 调 `engine.interruptAll()`
   （票回 queued）→ 释放锁。**不 kill 会话**，会话由 DSH 自己处理。

崩溃（`kill -9`）但不重启：锁在 30s 后过期，下次启动 `recover()` 把 running 收掉。

## 错误处理

| 场景 | 处理 |
|---|---|
| 会话创建 / prompt 失败 | assignment interrupted，票 failed，summary 带错误；`retry` 可重来 |
| worker 调 `report` 但没有 running assignment | `assignment/not-running`，工具报错 |
| 同一 assignment 第二次终态 report | `report/terminal-twice`，工具报错（不静默） |
| 票已 ended 后 worker 仍在跑（stop 后） | report 被拒；`ticket_control(stop)` 拿到 `sessionId` 后由工具层中断该会话 |
| 数据库损坏 / schema 更新 | 启动失败并打印原因；不自动重建 |
| 重复实例 | 文件锁失败，插件挂载报错，不降级运行 |

## 配置与打包

包 `dsh-mini-superagent`（`type: module`，`main: lib/index.js`，tsdown 构建），
`schema` 用 `@deepseek-ai/schemastery`：

```yaml
- id: dsh-mini-superagent
  config:
    stateDir: /root/.dsh/state/mini-superagent   # 必填，绝对路径
    maxWorkers: 1                                 # 可选，1..4
    workRoot: /root/dsh-worktrees                 # 可选，默认 <stateDir>/work
    workerPreset: standard                        # 可选，M2 换成专用 preset
```

`cordis.patch.yml` 只插入一个 entry；profile 通过 `dsh plugin --profile <name> add link:<path>`
安装，并把包名加入 `dsh.profile.bundles`。

运行时依赖只有两个：`proper-lockfile`（stateDir 锁）与 `zod`（工具 schema）；
`@deepseek-ai/schemastery` 走 peerDependencies（由 profile 提供），SQLite 用 Node 内置
`node:sqlite`，不引入原生模块。

## 安全边界

worker 以操作者的 OS 用户、`danger-full-access` 运行，能读写整台机器。本插件的
`workRoot` 只是约定，不是沙箱；`report` 的校验只防误用，不防恶意。需要真隔离时，
把整个 DSH 跑在独立 OS 账户里——这与 superagent 的结论一致。

## 测试点

单元（不依赖 DSH，用 fake session 后端）：

1. 状态机：每条合法迁移走通；非法迁移抛对应 code。
2. 幂等：同一 assignment 二次 `ended` 抛 `report/terminal-twice`；票状态不变。
3. 恢复：插入 running assignment + working 票 → `recover()` → interrupted + queued
   + 下一次 dispatch 的 mandate 含恢复说明。
4. 并发：`dispatchNext` 在只剩一张票时被并发调用两次，第二次返回 `undefined`
   （`one_running` 兜底）。

集成（手工，真 DSH）：

1. `request_work` → 1s 内出现 `mini-worker-*` 会话，首条消息是 mandate。
2. worker `report(ended)` → 票 ended，主会话查 `list_tickets` 看到结果。
3. 跑到一半 `kill -9` 进程 → 重启后同一票 attempt=2，mandate 带"上次被中断"。
4. 上下文：worker 会话里看不到派活会话的任何历史。

## 里程碑

| 阶段 | 内容 | 预估 |
|---|---|---|
| M1 | Store + Engine + Tools + 串行 Dispatcher，无恢复 | ~350 行 |
| M2 | `recover()` + 锁 + 失败路径 + 单元测试 | ~150 行 |
| M3 | 专用 worker preset（工具白名单、5s 后台规则） | 一个 patch 段 |
| M4（可选） | `maxWorkers > 1`、队列公平性 | ~60 行 |

## 未来扩展（按需，不预埋）

- 授权：加 `policy` 表 + 票上 `mandate` 字段，`request_work` 前查允许名单。
- 外部源：加 Source 抽象与读位置，`createTicket` 变成幂等 upsert。
- 回写：加 outbox 表与 Channel 适配。
- 面板：读 `tickets` 的只读视图，不需要改内核。

以上任何一项都不改动本设计的三个不变量。
