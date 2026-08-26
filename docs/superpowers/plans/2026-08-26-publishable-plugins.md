# dsh-work 可发布化改造实施计划（GitHub 安装通道）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `~/dsh-work` 改造成可从 GitHub 子目录直接安装的发布形态：3 个构建包 lib/ 入库并移除 prepare，2 个包改元数据，文档与规则更新，打整仓 tag 并端到端验证安装。

**Architecture:** 保持单仓库（`github.com/wptoux/dsh-work`，公开）为唯一事实源。消费者用 pnpm 子目录 git 依赖 `github:wptoux/dsh-work#<tag>&path:plugins/<dir>` 安装；插件包不带任何构建生命周期脚本（规避 pnpm 11 对 git 依赖构建脚本的带 SHA 审批闸门），lib/ 作为发版产物入库。日常开发链路（src → 构建 → link: 挂载）不变。

**Tech Stack:** pnpm（≥9.5，子目录安装支持）、tsdown/tsc（构建）、node ≥22（remote-web-ui 引擎要求）。

**Spec:** [`docs/superpowers/specs/2026-08-26-publishable-plugins-design.md`](../specs/2026-08-26-publishable-plugins-design.md) —— 本计划实现该设计文档。

## Global Constraints

- 渠道：GitHub 子目录 + tag；**不上 npm registry、不改包名、不建 scope**。
- tag 约定：整仓统一 `plugins-YYYY.MM.N`；首个为 `plugins-2026.08.1`。
- `lib/` 仅允许由 src 现构建后提交（`pnpm build` 产物），**禁止手改 lib/**。
- 提交：Conventional Commits、无 emoji、在仓库根 `~/dsh-work` 提交。
- 禁止 fetch/push **上游插件仓库**；只 push 自有 origin `wptoux/dsh-work`。
- 不重启运行中的 dsh 服务；只做只读探测（`dsh --profile web --dump-config`）。
- `node_modules/`、`*.tsbuildinfo`、`*.log` 一律不入库（gitignore 已覆盖/保持）。
- 沙箱内所有联网命令需带代理 env：`export HTTPS_PROXY=http://host.docker.internal:7890 HTTP_PROXY=http://host.docker.internal:7890`（curl 认 `all_proxy`，node/pnpm 不认）。
- 每个任务以「验证 + 提交」收尾；提交前 `git status --short` 只含预期文件。

---

### Task 1: dsh-remote-web-ui — 构建并入库 lib/，移除 prepare

**Files:**
- Modify: `plugins/dsh-remote-web-ui/package.json`（删 `scripts.prepare` 行）
- Delete: `plugins/dsh-remote-web-ui/tsdown.prepare.config.ts`
- Modify: `plugins/dsh-remote-web-ui/.gitignore`（删 `lib/` 行）
- Add (generated): `plugins/dsh-remote-web-ui/lib/**`（构建产物，现构建后提交）

**Interfaces:**
- Produces: `plugins/dsh-remote-web-ui/lib/index.js`、`lib/client.js`、`lib/types/**` 等（消费者从 git 安装时直接 require 的入口，`main`/`exports` 不变）。

- [ ] **Step 1: 构建当前源码**

```bash
cd /root/dsh-work/plugins/dsh-remote-web-ui && pnpm build
```

Expected: 成功退出；`ls lib/index.js lib/client.js` 存在。

- [ ] **Step 2: 宿主半区可加载自检**

```bash
cd /root/dsh-work && node -e "require('./plugins/dsh-remote-web-ui/lib/index.js')"
```

Expected: 无报错退出（不打印任何东西，exit 0）。

- [ ] **Step 3: 删 prepare 脚本与专用配置**

`plugins/dsh-remote-web-ui/package.json` 中把：

```json
  "scripts": {
    "build": "tsc -b && tsdown",
    "test": "vitest run",
    "typecheck": "tsc -b --pretty false",
    "prepare": "tsdown --config tsdown.prepare.config.ts"
  },
```

改为（删除 prepare 那一行）：

```json
  "scripts": {
    "build": "tsc -b && tsdown",
    "test": "vitest run",
    "typecheck": "tsc -b --pretty false"
  },
```

再删除文件：

```bash
rm /root/dsh-work/plugins/dsh-remote-web-ui/tsdown.prepare.config.ts
```

（`shared/tsdown.client.ts` 仍被 `tsdown.config.ts` 引用，保留。）

- [ ] **Step 4: .gitignore 去掉 lib/**

`plugins/dsh-remote-web-ui/.gitignore` 原文为：

```
lib/
node_modules/
*.tsbuildinfo
```

改为（只删 `lib/` 行，其余保留）：

```
node_modules/
*.tsbuildinfo
```

- [ ] **Step 5: 验证 git 不再忽略 lib/ && 无其他未预期文件**

```bash
cd /root/dsh-work && git check-ignore plugins/dsh-remote-web-ui/lib/index.js; echo "check-ignore exit=$?（1=未忽略，符合预期）"; git status --short plugins/dsh-remote-web-ui
```

Expected: `check-ignore` 退出码 1；status 只显示 `lib/` 新增与 `package.json`/`.gitignore` 修改、`tsdown.prepare.config.ts` 删除。

- [ ] **Step 6: 提交**

```bash
cd /root/dsh-work && git add plugins/dsh-remote-web-ui && git commit -m "build(dsh-remote-web-ui): ship lib/ in-repo and drop prepare for git installs"
```

---

### Task 2: dsh-better-sidebar — 构建并入库 lib/，移除 prepare

**Files:**
- Modify: `plugins/dsh-better-sidebar/package.json`（删 `scripts.prepare` 行）
- Modify: `plugins/dsh-better-sidebar/.gitignore`（删 `lib/` 行）
- Add (generated): `plugins/dsh-better-sidebar/lib/**`

**Interfaces:**
- Produces: `plugins/dsh-better-sidebar/lib/index.js`、`lib/invariant.js`、`lib/client*.js`、`lib/types/**`。消费者由 git 安装后可直接加载（`main`/`exports` 不变）。注意 `prepublishOnly: pnpm build` 与 `build: rm -rf lib && tsc -p tsconfig.build.json && tsdown` **保留**。

- [ ] **Step 1: 构建当前源码**

```bash
cd /root/dsh-work/plugins/dsh-better-sidebar && pnpm build
```

Expected: 成功退出；`ls lib/index.js lib/client.js` 存在。

- [ ] **Step 2: 宿主半区可加载自检**

```bash
cd /root/dsh-work && node -e "require('./plugins/dsh-better-sidebar/lib/index.js')"
```

Expected: exit 0。

- [ ] **Step 3: 删 prepare 脚本**

`plugins/dsh-better-sidebar/package.json` 的 `scripts` 中删除这一行：

```json
    "prepare": "tsdown",
```

其余 scripts（`build`/`prepublishOnly`/`typecheck`/`bundle`/`watch`/`test`/`test:mount`/`check:consumer-types`）全部保留。

- [ ] **Step 4: .gitignore 去掉 lib/**

`plugins/dsh-better-sidebar/.gitignore` 中删除单独成行的 `lib/`（位于 `.vite/` 行之后、`# plugin-registry install staging` 注释之前）。删除后该文件末尾区域应为：

```
# Vite files
vite.config.js.timestamp-*
vite.config.ts.timestamp-*
.vite/

# plugin-registry install staging (assembled by scripts/package-registry.mjs)
registry/
.npmrc
```

（`registry/`、`.npmrc` 等其余条目不动。）

- [ ] **Step 5: 验证**

```bash
cd /root/dsh-work && git check-ignore plugins/dsh-better-sidebar/lib/index.js; echo "check-ignore exit=$?（1=未忽略）"; git status --short plugins/dsh-better-sidebar
```

Expected: `check-ignore` 退出码 1；status 只含 `lib/` 新增与两个配置文件修改。

- [ ] **Step 6: 提交**

```bash
cd /root/dsh-work && git add plugins/dsh-better-sidebar && git commit -m "build(dsh-better-sidebar): ship lib/ in-repo and drop prepare for git installs"
```

---

### Task 3: dsh-ui-tweaks — 构建并入库 lib/

**Files:**
- Modify: `plugins/dsh-ui-tweaks/.gitignore`（删 `lib/` 行）
- Add (generated): `plugins/dsh-ui-tweaks/lib/**`

**Interfaces:**
- Produces: `plugins/dsh-ui-tweaks/lib/index.js`、`lib/client.js`、`lib/types/**`。该包本无 prepare，无需改 package.json。

- [ ] **Step 1: 构建当前源码**

```bash
cd /root/dsh-work/plugins/dsh-ui-tweaks && pnpm build
```

Expected: 成功退出；`ls lib/index.js` 存在。

- [ ] **Step 2: 宿主半区可加载自检**

```bash
cd /root/dsh-work && node -e "require('./plugins/dsh-ui-tweaks/lib/index.js')"
```

Expected: exit 0。

- [ ] **Step 3: .gitignore 去掉 lib/**

`plugins/dsh-ui-tweaks/.gitignore` 原文（无末尾换行）：

```
lib/
node_modules/
*.tsbuildinfo
```

改为：

```
node_modules/
*.tsbuildinfo
```

- [ ] **Step 4: 验证**

```bash
cd /root/dsh-work && git check-ignore plugins/dsh-ui-tweaks/lib/index.js; echo "check-ignore exit=$?（1=未忽略）"; git status --short plugins/dsh-ui-tweaks
```

Expected: `check-ignore` 退出码 1；status 只含 `lib/` 新增与 `.gitignore` 修改。

- [ ] **Step 5: 提交**

```bash
cd /root/dsh-work && git add plugins/dsh-ui-tweaks && git commit -m "build(dsh-ui-tweaks): ship lib/ in-repo for git installs"
```

---

### Task 4: dsh-usage-stats 去 private；dsh-archive-manager 仓库元数据改指

**Files:**
- Modify: `plugins/dsh-usage-stats/package.json`
- Modify: `plugins/dsh-archive-manager/package.json`

**Interfaces:**
- 无运行时接口变化；纯 package.json 元数据。

- [ ] **Step 1: usage-stats 删除 private 标记**

`plugins/dsh-usage-stats/package.json` 中删除这一行：

```json
  "private": true,
```

（其余字段不动；`bin`/`files`/`exports` 本就为发布设计。）

- [ ] **Step 2: archive-manager repository 改指本仓库**

`plugins/dsh-archive-manager/package.json` 中：

```json
  "repository": {
    "type": "git",
    "url": "git+https://github.com/z953218350/dsh-archive-manager.git"
  },
  "homepage": "https://github.com/z953218350/dsh-archive-manager",
  "bugs": {
    "url": "https://github.com/z953218350/dsh-archive-manager/issues"
  },
```

改为：

```json
  "repository": {
    "type": "git",
    "url": "git+https://github.com/wptoux/dsh-work.git"
  },
  "homepage": "https://github.com/wptoux/dsh-work",
  "bugs": {
    "url": "https://github.com/wptoux/dsh-work/issues"
  },
```

- [ ] **Step 3: 语法自检 + 提交**

```bash
cd /root/dsh-work && node -e "require('./plugins/dsh-usage-stats/package.json'); require('./plugins/dsh-archive-manager/package.json')" && git status --short plugins/dsh-usage-stats plugins/dsh-archive-manager
```

Expected: node 无报错（JSON 合法）；status 仅两个 package.json 修改。

```bash
cd /root/dsh-work && git add plugins/dsh-usage-stats/package.json plugins/dsh-archive-manager/package.json && git commit -m "chore(plugins): mark usage-stats publishable and point archive-manager metadata at the fork"
```

---

### Task 5: AGENTS.md — 放宽 lib/ 规则并新增发布小节

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: 修订「硬性规则」第 1 条**

把：

```markdown
1. **不动构建产物**：`lib/`、`node_modules/`、`client/client.js*` 等生成物禁止修改和
   入库（gitignore 已覆盖）。改代码只改 `src/` 与包配置文件。
```

改为：

```markdown
1. **构建产物**：`node_modules/`、`*.tsbuildinfo` 等禁止入库（gitignore 已覆盖）。
   `lib/` 是发布产物，**允许入库，但仅限发版时由 src 现构建（`pnpm build`）后提交**，
   禁止手改 `lib/` 内容、禁止不构建直接提交；日常改代码只改 `src/` 与包配置文件。
   （发布形态见下文「发布与安装」。）
```

- [ ] **Step 2: 新增「发布与安装」小节**

在「## 硬性规则」小节之后、「## 构建与验证」小节之前，新增「## 发布与安装（对外分发）」小节，正文如下（保持中文、无 emoji）：

```markdown
## 发布与安装（对外分发）

本仓库同时是对外分发的安装源（`github.com/wptoux/dsh-work`，公开）。消费者经 pnpm
子目录 git 依赖安装，版本由**整仓统一 tag** 固定（`plugins-YYYY.MM.N`）——延续冻结
哲学，引用永不漂移。

- 安装语法：`github:wptoux/dsh-work#<tag>&path:plugins/<目录>`（pnpm ≥9.5）。
- 发版三步：① 改 `src/` 并 `pnpm build`；② 提交源码 + `lib/`（lib/ 必须与 src 同步）；
  ③ 打整仓 tag：`git tag plugins-YYYY.MM.N` 并 `git push origin main --tags`。
- 禁止 `fetch/push` 上游插件仓库；push 仅限自有 origin。
- 完整安装文档见 `plugins/README.md` 的「GitHub 安装」章节。
```

- [ ] **Step 3: 提交**

```bash
cd /root/dsh-work && git add AGENTS.md && git commit -m "docs(agents): allow publishing lib/ and document the tag-based install channel"
```

---

### Task 6: plugins/README.md 与根 README.md — GitHub 安装文档

**Files:**
- Modify: `plugins/README.md`
- Modify: `README.md`

- [ ] **Step 1: plugins/README.md 新增「GitHub 安装」章节**

在「## 接线方式（已配置好，一般不用动）」小节之后插入新章节：

````markdown
## GitHub 安装（对外分发）

除本地 `link:` 外，本仓库支持直接以 GitHub 子目录依赖安装（pnpm ≥9.5），版本固定，
适合换机器 / 分享给他人：

```json
// ~/.dsh/profiles/web/package.json
"dependencies": {
  "dsh-remote-web-ui":   "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-remote-web-ui",
  "dsh-better-sidebar":  "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-better-sidebar",
  "dsh-usage-stats":     "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-usage-stats",
  "dsh-archive-manager": "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-archive-manager",
  "dsh-ui-tweaks":       "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-ui-tweaks"
}
```

首次安装还需在 profile 目录放行两个原生二进制的构建脚本（一次性配置，与发版无关）：

```yaml
// ~/.dsh/profiles/web/pnpm-workspace.yaml
allowBuilds:
  cloudflared: true
  node-pty: true
```

然后 `cd ~/.dsh/profiles/web && pnpm install`，重启 dsh。

**升级**：把依赖里的 tag（`plugins-2026.08.1`）换成新 tag，重新 `pnpm install`。
**回滚**：换回旧 tag 重装即可。

> 说明与约束：
> - 本仓库是**个人冻结 fork**（裁剪/定制版），与 npm registry 上同名包/上游仓库无关；
>   版本号沿用上游但内容以本仓库为准。
> - 使用 pnpm 安装（npm 不支持 git 子目录依赖）；npm 用户可整仓 clone 后改用
>   `file:` 依赖（等价于本机 `link:` 模式）。
> - 发版 = 构建 lib/ 并提交 + 打整仓 tag（`plugins-YYYY.MM.N`），见 AGENTS.md。
````

- [ ] **Step 2: 根 README.md 增加安装方式**

在「## 快速开始」的代码块前插入一段：

````markdown
或者当成发布源直接安装（新机器 / 分享给他人，需 pnpm ≥9.5）：

```json
"dependencies": {
  "dsh-remote-web-ui":   "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-remote-web-ui",
  "dsh-better-sidebar":  "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-better-sidebar",
  "dsh-usage-stats":     "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-usage-stats",
  "dsh-archive-manager": "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-archive-manager",
  "dsh-ui-tweaks":       "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-ui-tweaks"
}
```

（详情与 `allowBuilds` 配置见 [plugins/README.md](plugins/README.md)。）
````

- [ ] **Step 3: 提交**

```bash
cd /root/dsh-work && git add plugins/README.md README.md && git commit -m "docs: document the tag-based GitHub install channel"
```

---

### Task 7: 打整仓 tag、推送并端到端验证

**Files:**
- 无源码改动；发布动作 + 验证。

- [ ] **Step 1: 确认工作区干净并打 tag**

```bash
cd /root/dsh-work && git status --short && git tag plugins-2026.08.1 && git tag
```

Expected: status 为空（或已提交干净）；tag 列表含 `plugins-2026.08.1`。

- [ ] **Step 2: 推送 main 与 tag 到自有 origin**

```bash
cd /root/dsh-work && git push origin main && git push origin plugins-2026.08.1
```

Expected: 两端均成功（远程为公开仓库，anon 可读即可被安装）。

- [ ] **Step 3: 端到端安装验证（模拟全新用户）**

```bash
export HTTPS_PROXY=http://host.docker.internal:7890 HTTP_PROXY=http://host.docker.internal:7890
rm -rf /tmp/pubtest-final && mkdir -p /tmp/pubtest-final && cd /tmp/pubtest-final && npm init -y >/dev/null 2>&1
# 用 node 写 package.json 的 dependencies（避免手写转义错误）
node -e '
const p = require("./package.json");
p.dependencies = {
  "dsh-remote-web-ui":   "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-remote-web-ui",
  "dsh-better-sidebar":  "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-better-sidebar",
  "dsh-usage-stats":     "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-usage-stats",
  "dsh-archive-manager": "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-archive-manager",
  "dsh-ui-tweaks":       "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-ui-tweaks"
};
require("fs").writeFileSync("./package.json", JSON.stringify(p, null, 2));
'
cat > pnpm-workspace.yaml <<'EOF'
allowBuilds:
  cloudflared: true
  node-pty: true
EOF
timeout 900 pnpm install > /tmp/pubtest-final.log 2>&1; echo "install exit=$?"
```

Expected: `install exit=0`；日志**无** `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`（我们已移除 prepare，不应出现）。

- [ ] **Step 4: 断言 5 包全部就位且含 lib/ 与原生二进制**

```bash
cd /tmp/pubtest-final
for d in dsh-remote-web-ui dsh-better-sidebar dsh-usage-stats dsh-archive-manager dsh-ui-tweaks; do
  test -f "node_modules/$d/lib/index.js" && echo "OK  $d lib/index.js" || echo "MISS $d lib/index.js"
done
test -f node_modules/cloudflared/bin/cloudflared && echo "OK  cloudflared binary" || echo "MISS cloudflared binary"
ls node_modules/node-pty/build/Release/ >/dev/null 2>&1 && echo "OK  node-pty build" || echo "MISS node-pty build (可能无预编译，需本机编译)"
```

Expected: 5 个 `OK` + `cloudflared binary` OK。`node-pty build` 视平台而定（有预编译即 OK）。

- [ ] **Step 5: dsh 只读配置探测（本机 profile 仍走 link:，不应受影响）**

```bash
dsh --profile web --dump-config >/tmp/pubtest-dump.log 2>&1; echo "dump exit=$?"; tail -25 /tmp/pubtest-dump.log
```

Expected: exit 0；layer 栈含 5 个插件 bundle，无报错。**不重启 dsh 服务。**

- [ ] **Step 6: 收尾确认**

```bash
cd /root/dsh-work && git status --short && git log --oneline -8
```

Expected: status 干净；log 显示本计划全部提交 + spec 提交。

---

## 验收标准（全部满足才算完成）

1. 3 个构建包的 `lib/` 已入库且与当前 src 同步（`pnpm build` 后无 diff）。
2. 5 个包从 `#plugins-2026.08.1` tag 在空目录安装成功（Task 7 Step 3/4 全 OK）。
3. `dsh --profile web --dump-config` 无报错。
4. `git status --short` 干净。
5. 功能级正确性（扫码配对 / 侧边栏 / 折叠）以用户重启 dsh 后的反馈为准，本计划不做 UI 断言。