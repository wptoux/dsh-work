# dsh-work 可发布化改造设计文档（GitHub 安装通道）

日期：2026-08-26
状态：已获用户批准（决策见下）

## 背景与目标

`~/dsh-work` 是个人维护的 dsh 第三方插件冻结 fork，目前仅通过 profile 的 `link:`
本地依赖挂载。目标：改造成**公开发布形式**——任何机器/用户只要在
`~/.dsh/profiles/web/package.json` 里把依赖写成 GitHub 子目录引用，`pnpm install`
即可装齐，版本由 tag 固定（延续冻结哲学，永不漂移）。

用户已确认的决策：

1. **受众**：公开发布给所有人。
2. **渠道**：GitHub 子目录 + tag（**不上 npm registry**——`dsh-better-sidebar` /
   `dsh-usage-stats` / `dsh-archive-manager` / `dsh-ui-tweaks` 四个裸包名已被上游或
   同名者占用，撞名发布等于劫持）。
3. **版本策略**：整仓统一 tag（如 `plugins-2026.08.1`），5 条依赖引用同一个 tag。
4. **构建时机**：**lib/ 入库**（与 `dsh-archive-manager` / `dsh-usage-stats` 先例一致），
   不做安装时构建（pnpm 11 对此要求带 commit SHA 的 allowBuilds 审批，发版即失效）。

## 实证约束（决定设计的四个事实）

| 事实 | 证据 | 结论 |
|---|---|---|
| pnpm 子目录 git 安装可用 | `pnpm add github:wptoux/dsh-work#path:plugins/dsh-archive-manager` 实测 4s 安装成功，lib/src 齐全 | 主渠道成立；语法 `github:user/repo#ref&path:子目录`（ref 与 path 用 `&` 连接） |
| npm 不支持 git 子目录安装 | npm 把 `github:user/repo/plugins/xxx` 整个当成仓库 URL，clone 404 | 文档注明「用 pnpm」；npm 用户回退走整仓 clone + `file:` 依赖 |
| pnpm 11 对 git 依赖构建脚本的审批键含 commit SHA | `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`/`ERR_PNPM_IGNORED_BUILDS`；`allowBuilds` 通配符不匹配、`pnpm.onlyBuiltDependencies` 纯包名不匹配；错误提示要求粘贴 `name@https://codeload.github.com/...#path:...` 整段 | **移除 prepare 脚本 + lib/ 入库**，让插件包本身零构建脚本，直装无需任何审批 |
| 库内先例 | archive-manager / usage-stats 的 lib/ 已入库，无构建生命周期脚本，实测零配置直装 | lib/ 入库模式已验证可行 |

附带结论：cloudflared / node-pty 作为 registry 依赖，其构建脚本在 pnpm 10/11 默认被
拦，需要消费者一次性配置 `allowBuilds: { cloudflared: true, node-pty: true }`
（**包名匹配、与发版无关**）。这条任何渠道都躲不开（本机 profile 的
`pnpm-workspace.yaml` 早已如此配置，属同款）。

## 目标形态

消费者 `~/.dsh/profiles/web/package.json`：

```json
"dependencies": {
  "dsh-remote-web-ui":   "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-remote-web-ui",
  "dsh-better-sidebar":  "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-better-sidebar",
  "dsh-usage-stats":     "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-usage-stats",
  "dsh-archive-manager": "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-archive-manager",
  "dsh-ui-tweaks":       "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-ui-tweaks"
}
```

消费者 `~/.dsh/profiles/web/pnpm-workspace.yaml`（一次性，与本机现状一致）：

```yaml
allowBuilds:
  cloudflared: true
  node-pty: true
```

升级流程：改 tag → 目录内 `pnpm install` → 重启 dsh。

## 改动清单

### 插件包（5 个）

1. `plugins/dsh-remote-web-ui/`
   - `package.json`：移除 `scripts.prepare`（`tsdown --config tsdown.prepare.config.ts`）。
     `build`/`typecheck`/`test` 保留（本地开发与发版构建用）。`tsdown.prepare.config.ts`
     删除（不再被引用）。
   - `.gitignore`：移除 `lib/` 行（保留 `node_modules/`、`*.tsbuildinfo`）。
   - 在目录内 `pnpm build` 生成最新 `lib/` 并入库。
2. `plugins/dsh-better-sidebar/`
   - `package.json`：移除 `scripts.prepare`（`tsdown`）。`prepublishOnly`、`build` 保留。
   - `.gitignore`：移除 `lib/` 行（保留 `registry/`、`.npmrc` 等其余条目）。
   - 目录内 `pnpm build` 生成最新 `lib/` 并入库。
3. `plugins/dsh-ui-tweaks/`
   - `package.json`：本身无 prepare，不动。
   - `.gitignore`：移除 `lib/` 行。
   - 目录内 `pnpm build` 生成最新 `lib/` 并入库。
4. `plugins/dsh-usage-stats/`
   - `package.json`：删除 `"private": true`（发布形态不应标记私有；lib/ 已入库）。
5. `plugins/dsh-archive-manager/`
   - `package.json`：`repository` / `homepage` / `bugs` 从上游改为指向本仓库
     `https://github.com/wptoux/dsh-work`（纯元数据，消歧义）。

### 规则与文档

6. `AGENTS.md`
   - 「硬性规则 1」修订：lib/ 允许入库，但**仅限发版时由 src 现构建后提交**（保持
     src 与 lib 同步、禁止手改 lib/），gitignore 覆盖条目相应移除。
   - 新增「发布与安装」小节：统一 tag 约定（`plugins-YYYY.MM.N`）、发版三步流程
     （构建 → 提交 lib/ 与改动 → 打 tag 并 push origin）、安装方式速查。
7. `plugins/README.md`
   - 新增「GitHub 安装（对外分发）」章节：依赖块、allowBuilds 块、升级/回滚步骤、
     npm 用户回退方案（整仓 clone + `file:` 依赖）、免责声明（本地冻结 fork，与
     npm 同名包/上游无关）。
   - 「接线方式」章节改为双模式：日常开发 `link:`（不变）+ 对外分发 GitHub 引用。
8. 根 `README.md`
   - 「快速开始」增加安装方式；表格下加 tag/发布说明。

### 发布动作

9. 提交全部改动（Conventional Commits，仓库根）。
10. 打整仓 tag（首个：`plugins-2026.08.1`），push 到 `origin`（`wptoux/dsh-work`，
    公开仓库；push 后安装才可用。此为自有 origin，不违反「不 push 上游」禁令）。
11. 端到端验证（见下）。

## 验证清单

1. 三个构建包 `pnpm build` 成功；`node -e "require('.../plugins/<pkg>/lib/index.js')"`
   可加载。
2. **端到端**：在空目录（模拟新用户）写 profile 形态的 package.json + allowBuilds，
   `pnpm install` 用 `#plugins-2026.08.1&path:...` 安装全部 5 包；断言每个包
   `lib/` 存在、cloudflared/node-pty 二进制就位（allowBuilds 生效）。
3. `dsh --profile web --dump-config`（只读）确认 layer 栈正常（本机 profile 仍走
   link:，不应受影响）。
4. `git status --short` 干净（无 lib/ 之外的多余文件；`*.tsbuildinfo` 不入库）。
5. 本机 dsh 服务不需重启（link: 未变）；不做功能级断言，等用户重启验证。

## 明确不做

- 不上 npm registry、不改包名、不建 scope。
- 不引入 CI 自动发布（tag 由本仓库 owner 手动打；冻结哲学下无自动漂移诉求）。
- 不改冻结策略（仍不 fetch/push 上游、不跟随上游更新）。
- 不改官方 `@deepseek-ai/*` SDK、不引用 DSH 源码 checkout。
- 不删 `.git-backup/`。