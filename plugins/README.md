# dsh 插件本地化维护仓库

本目录是 DeepSeek Harness web profile（`~/.dsh/profiles/web`）使用的全部第三方插件的
**冻结本地源码**。目标：版本永远不自动漂移（不再跟随上游），遇到问题直接改这里的源码，
改完重启 dsh 即生效。

整个 `plugins/` 由**一个统一 git 仓库管理**（仓库根在 `~/dsh-work/`），不再是每个插件
一个 git。

## 目录与对应关系（冻结溯源）

| 目录 | 包名 | 上游仓库 | 冻结 commit | 说明 |
|---|---|---|---|---|
| `dsh-market/` | `dshmarket` | https://github.com/dsh-market/dsh-market | `4c21747`（tag v1.14.1） | 插件市场。**本地修复**：补漏声明的 `@deepseek-ai/schemastery` devDep |
| `dsh-web-ui/` | `@linxin666/dsh-remote-web-ui` | https://github.com/zhu1090093659/dsh-web-ui | `a3b44d9`（tag v0.3.2） | **已裁剪**：原 19 个子包只剩 remote-web-ui（手机远程控制） |
| `dsh-better-sidebar/` | `dsh-better-sidebar` | https://github.com/omdsh-dev/DSH-better-sidebar | `d9b8f15`（tag v0.15.2） | 增强侧边栏 |
| `dsh-usage-stats/` | `dsh-usage-stats` | https://github.com/Ychris12138/dsh-usage-stats | `8373659`（v0.2.5） | 用量统计，lib/ 已入库，无需构建 |

> 历史背景：旧 profile 用的 `@linxin666/dsh-web-ui-all` 全家桶（^0.2.4 semver 自动漂移）、
> `dshmarket`（^1.9.0 → 漂到 1.14.1）、`github:` 浮动引用，每次更新都可能 break。
> 现已全部改为本地 `link:` 依赖，锁死版本，源码自持。
>
> 统一仓库前，4 个插件曾是独立 git 仓库，其完整历史打包在 `~/dsh-work/.git-backup/*.bundle`
> （不入库，仅本地保险；其中 dsh-web-ui.bundle 较大，约 430MB，不需要可删）。

## 接线方式（已配置好，一般不用动）

profile 依赖指向本地目录（symlink，改源码即生效）：

```json
// ~/.dsh/profiles/web/package.json
"dependencies": {
  "dshmarket":               "link:/root/dsh-work/plugins/dsh-market",
  "@linxin666/dsh-remote-web-ui": "link:/root/dsh-work/plugins/dsh-web-ui/packages/dsh-remote-web-ui",
  "dsh-better-sidebar":      "link:/root/dsh-work/plugins/dsh-better-sidebar",
  "dsh-usage-stats":         "link:/root/dsh-work/plugins/dsh-usage-stats"
}
```

`dsh.profile.bundles` 同步列出这 4 个包（+ 内核自带的 `dsh-base`、`dsh-web-app`）。

## 日常维护流程

### 改代码（最常见）

1. 编辑对应目录下的源码（改完 **不要** 动 `lib/`，那是构建产物）。
2. 有 TypeScript 源码改动时重新构建：
   - `dsh-market`：`cd ~/dsh-work/plugins/dsh-market && pnpm build`
   - `dsh-web-ui`：`cd ~/dsh-work/plugins/dsh-web-ui && pnpm -r build`
   - `dsh-better-sidebar`：`cd ~/dsh-work/plugins/dsh-better-sidebar && pnpm build`
   - `dsh-usage-stats`：无构建步骤（lib/ 已入库）
3. **重启 dsh 服务**（`Ctrl+C` 后重新 `dsh web`，或退出后 `dsh web`）使改动生效。
   临时验证可以用 `dsh --profile web --dump-config`（只读，不打扰运行中的服务）。
4. 提交（Conventional Commits，无 emoji）——**在统一仓库根提交**：
   `cd ~/dsh-work && git add plugins/<目录> && git commit -m "fix(scope): what"`。
   *不要* `git fetch/push` 上游——本 fork 是冻结的。

### 验证

- 快速自检：`node -e "require('<目录>/lib/index.js')"`（host 半区能加载即可）。
- 完整验证：重启 dsh 后确认对应功能正常（remote-web-ui：手机扫码配对；better-sidebar：
  侧边栏渲染；dshmarket：市场页打开；usage-stats：面板数据更新）。
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

- `dsh-market`：package.json 补 `@deepseek-ai/schemastery@^3.18.1` devDep（上游漏声明，
  pnpm 严格模式下 tsc 找不到）；.gitignore 追加生成产物 `client/client.js*`。
- `dsh-web-ui`：删除 19 个无关子包 + skins + market 站点 + umbrella 聚合包 + docs/gallery/
  tests 等开发脚手架；根 package.json 精简脚本与 devDeps（保留 `lightningcss`、`tsdown`
  供 shared 构建预设使用）；`pnpm-workspace.yaml` 去掉 `packages/skins/*`；lockfile 重新生成。
- `dsh-better-sidebar` / `dsh-usage-stats`：无源码改动。

## 备注

- 构建产物处理：`dsh-usage-stats` 的 `lib/` 随仓库入库（上游即如此，开箱即用）；
  其余三者的 `lib/`、`node_modules/` 一律忽略（各目录 .gitignore），改源码后需重新构建。
- profile 的 `pnpm-workspace.yaml`（`~/.dsh/profiles/web/`）已配置 `nodeLinker: hoisted`，
  link:- 依赖的传递依赖会被平铺安装到 profile node_modules。
- 被裁掉的组件在 `~/.dsh/settings.yaml` 里的残留配置（pet / skin-custom-theme 等）是
  惰性配置，无害；如想清理，删掉对应小节即可。