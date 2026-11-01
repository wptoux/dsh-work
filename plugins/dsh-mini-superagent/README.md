# dsh-mini-superagent

最小可用的「票据 + 隔离会话」SuperAgent 内核，跑在 DSH web profile 里：
在侧边栏点 **SuperAgent** 看票、派活、跳回主会话，聊天仍用 DSH 原生界面。

本插件是仓库自研实验插件，不属于上游冻结范围（无溯源 commit，不参与上游同步）。

## 三条不变量

1. **工作项是持久的**：票在 SQLite 里，不在会话里。进程重启后票还在。
2. **执行是隔离的**：每张票一个独立 `worker-<id>` 顶层会话，上下文只有 mandate。
3. **重启可恢复**：进程死了再起来，知道刚才在跑什么；运行中的作业标记为
   interrupted、票回到 `queued`，下一次派发带恢复说明。

## 工作方式

- **hub 会话**：`mini-hub-*`。只有它注册 `request_work` / `list_tickets` /
  `ticket_control` 三个工具，普通会话零污染。派活 = 在 hub 里说一句，模型调用
  `request_work` 建票。
- **worker 会话**：`worker-*`，只注册 `report` 工具；由 Dispatcher 单飞领取
  `queued` 票后创建（默认并发 1，可配 `maxWorkers`），投喂 mandate 后开跑。
- **终态回推**：`ended` / `blocked` / `failed` / `waiting` 时向 hub 发一行
  `[minisuperagent] <ticket> <摘要>`；`progress` 不发。
- **入口面板**：侧边栏 `sidebar.panellist` 图标 + 主区 `main` 面板（键
  `dsh-mini-superagent`）。面板每 3 秒轮询 `GET /mini-superagent/api/hub`，
  离开面板即停；「打开主会话」通过 `ctx.uiWorkspace.openSession(hubSessionId)`
  跳转到原生聊天界面。面板自身不渲染聊天。

HTTP（只读）：

| 方法 | 路径 | 返回 |
|---|---|---|
| GET | `/mini-superagent/api/hub` | `{ hubSessionId, tickets }`，首次访问会先建 hub 会话 |
| GET | `/mini-superagent/api/health` | `{ ok, running, queued }` |

鉴权沿用 DSH 的本地访问栅栏（Host 为 127.0.0.1/localhost），不加额外令牌。

## 安装（profile 内）

```bash
cd plugins/dsh-mini-superagent   # 或消费者自己的安装目录
pnpm install
pnpm build                       # 生成 lib/index.js 与 lib/client.js

# 在 web profile 里注册 link 依赖
dsh plugin --profile web add "link:$PWD"
```

`dsh plugin add` 会写入 profile 依赖，并把包名追加到
`~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles`（bundle 层由它组装）。
若是手工搬配置，务必确认 `dsh.profile.bundles` 里也有本包，否则启动时不会加载。

在 `~/.dsh/profiles/web/cordis.patch.yml` 给 bundle 层补配置（按 id 覆盖）：

```yaml
- id: mini-superagent
  config:
    stateDir: /root/.dsh/state/mini-superagent   # 必填，绝对路径
    # maxWorkers: 1          # 可选，1..4，默认 1
    # workerPreset: standard # 可选，worker 会话使用的 agent preset
```

改完配置需要**重启 DSH 服务**才生效（bundle 在启动时组装）。

## 状态目录与会话

- 数据库 `<stateDir>/state.sqlite`（WAL），票据文件目录
  `<stateDir>/superagent/work/<id>`。
- 专属 workspace 固定在 `<stateDir>/superagent`；hub 与 worker 会话都归入它，
  在侧边栏显示为**一个可折叠分组**，不与日常项目混排。这是本版能做到的列表隔离：
  内核没有「隐藏会话」开关，而 `origin === 'subagent'` 会把执行绑回父子模型，
  与「重启可恢复的顶层会话」不变量冲突。
- 同一 `stateDir` 只允许一个实例（`proper-lockfile`），重复启动会直接报错。

## 安全边界（重要）

worker 会话以**操作者本人身份**、按 profile 的默认权限运行（当前 web profile 的
`permission.defaultPreset` 是 `danger-full-access`），能读写整台机器。
workspace 与 `workDir` 只是约定，**不是沙箱**；`report` 的参数校验只防误用，不防
恶意。需要真隔离时，把整个 DSH 进程跑在独立 OS 账户/容器里。

## 运行运维

- **锁的 30s 过期窗口**：`stateDir` 用 30 秒 stale 锁。`kill -9` 之后若在约 30 秒
  内重启，可能因残留 `<stateDir>.lock` 报 `ELOCKED`（插件挂载失败）。等窗口过去，
  或确认没有实例后删除 `<stateDir>.lock` 再启动。
- 正常退出会把运行中的作业标记为 interrupted、票回 `queued` 并释放锁；直接
  `kill -9` 则靠下次启动的 `recover()` 接上。
- 回推失败（hub 会话被删等）只记日志，不影响票据状态。

## 开发与验证

```bash
cd plugins/dsh-mini-superagent
pnpm test        # vitest：状态机/存储/调度/路由/会话/面板
pnpm typecheck   # tsc --noEmit
pnpm build       # tsdown：lib/index.js + lib/client.js（CJS，__ModuleLoader__ 载入）
```

只读组合检查（不重启服务）：

```bash
dsh --profile web --dump-config | grep -n "mini-superagent"
```

重启 DSH 后的手工验收：

1. 侧边栏出现 SuperAgent 入口，点开是票据面板与「打开主会话」。
2. hub 会话里有 `request_work`；普通会话里没有。
3. 派活后约 1 秒出现 `worker-<ticket>` 会话，位于 `superagent` 分组。
4. worker 上下文只有 mandate，看不到 hub 的对话历史。
5. 终态 `report` 后 hub 收到一行 `[minisuperagent] …`。
6. worker 回合中 `kill -9` → 重启后该票回到 `queued`，第 2 次尝试带恢复说明。
7. `git status --short` 干净。

## 发布 staging

`lib/` 是发布产物、由 `pnpm build` 从 `src/` 现构建；本包 `.gitignore` 排除了
`lib/`，所以**发版时**显式强加：

```bash
git add -f plugins/dsh-mini-superagent/lib
```

日常改代码只提交 `src/`、测试与包配置，不夹带 `lib/`。
