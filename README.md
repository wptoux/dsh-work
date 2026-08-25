# dsh plugins that just work

Frozen, self-maintained local builds of the third-party DeepSeek Harness plugins
you actually use — pinned forever, tuned by you, never broken by an upstream update.

---

本仓库是一个**个人维护的 dsh 插件冻结仓库**：把曾经"每次更新都可能 break"的第三方
dsh 插件源码本地化，锁死版本，自己修、自己裁、自己优化。所有插件由**一个统一 git
仓库**管理（本仓库），运行时通过 profile 的 `link:` 依赖直接挂载本地源码。

## 包含的插件

| 目录 | 包名 | 功能 | 上游 | 冻结 commit |
|---|---|---|---|---|
| `plugins/dsh-remote-web-ui/` | `dsh-remote-web-ui` | 手机远程控制（扫码配对 + 自动隧道） | [zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui)（19 子包全家桶中**单独提取并裁剪**） | `a3b44d9`（v0.3.2） |
| `plugins/dsh-better-sidebar/` | `dsh-better-sidebar` | 增强侧边栏 | [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | `d9b8f15`（v0.15.2） |
| `plugins/dsh-usage-stats/` | `dsh-usage-stats` | 用量统计 | [Ychris12138/dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats) | `8373659`（v0.2.5） |

> 已移除：`dshmarket`（插件市场）——与"冻结"策略冲突，不再需要；恢复方式见
> `plugins/README.md`。迁移前的完整上游历史备份在 `./.git-backup/*.bundle`（本地保险，
> 不入库；`dsh-web-ui.bundle` 约 430MB，不需要可删）。

## 为什么这样做

旧方案把插件装成 npm 范围依赖（`^1.9.0`）和 `github:` 浮动引用，**每次更新都会拉到
新版本，随时可能 break**。本地化之后：

- 版本**永不自动漂移**——源码冻结在上表 commit，修复全部本地完成
- 改代码 → `pnpm build` → 重启 dsh 即生效（profile 以 symlink 指向本仓库）
- 用不上的功能直接**裁剪掉了**（全家桶 19 子包 → 1 个）

## 快速开始

```sh
# 构建某个插件（改完源码后同样操作）
cd plugins/dsh-remote-web-ui && pnpm build   # 或 dsh-better-sidebar
# 提交改动（Conventional Commits，无 emoji）
cd ~/dsh-work && git add plugins/<目录> && git commit -m "fix(scope): what"
# 重启 dsh 使改动生效（web profile）
#   终端里 Ctrl+C 停掉当前 `dsh web`，重新运行 `dsh web`
```

详细的维护流程（改代码 / 验证 / 回滚 / 更新上游 / 恢复已删组件）见
**[plugins/README.md](plugins/README.md)**。

## 接线方式（已配置，一般不用动）

web profile 的 `~/.dsh/profiles/web/package.json` 通过 `link:` 依赖指向本仓库：

```json
"dependencies": {
  "dsh-remote-web-ui": "link:/root/dsh-work/plugins/dsh-remote-web-ui",
  "dsh-better-sidebar":      "link:/root/dsh-work/plugins/dsh-better-sidebar",
  "dsh-usage-stats":         "link:/root/dsh-work/plugins/dsh-usage-stats"
}
```

依赖模型：pnpm 对 `link:` 采用"插件目录自管依赖"，每个插件目录自带完整 node_modules
（含原生二进制），profile 只挂载目录本身。

## 仓库规则

给 AI agent 的完整工作守则见 **[AGENTS.md](AGENTS.md)**。核心几条：

- **冻结策略**：不 `fetch/push` 上游，不跟随上游更新
- **构建产物**：`lib/`、`node_modules/` 一律不入库（.gitignore 已覆盖）
- **提交**：Conventional Commits，无 emoji，在仓库根提交
- **生效**：改动需重启 dsh 服务，**禁止自行 kill/重启正在运行的 dsh**，在交付报告中标注"需用户重启后生效"

## License

仓库及插件源码参见 `LICENSE` 与各目录内 LICENSE（MIT/Apache-2.0，以各插件上游为准）。