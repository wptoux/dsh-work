# dsh-work-all

dsh-work **聚合载具包**：安装这一个包 = 当前保留的 2 款插件（remote-web-ui /
usage-stats）一次性全部就位。

本包**没有自己的插件逻辑**（纯载具）：`dependencies` 以 git 子目录引用拉入全部子包，
`cordis.patch.yml` 汇总各子包的挂载行。DSH loader 从 profile 顶层按行 `name:` 解析子包
（pnpm 默认 hoisted 布局下传递依赖可达顶层），装完自动挂载。

> **2026-11-06 起插件家族缩减为 2 款**：`dsh-better-sidebar`、`dsh-archive-manager`、
> `dsh-model-sync`、`dsh-ui-tweaks` 已移除（DSH 0.2.2 提供等价原生能力）。源码保留在
> git 历史与 tag `plugins-2026.09.2`。

## 安装

首次需要一次性配置 profile 的 `pnpm-workspace.yaml`（整合包路线三件套：放行原生二进制
构建、放行 git 传递依赖、扁平布局让子包可被 loader 从 profile 顶层解析）：

```sh
mkdir -p ~/.dsh/profiles/web
cat > ~/.dsh/profiles/web/pnpm-workspace.yaml <<'EOF'
allowBuilds:
  cloudflared: true
blockExoticSubdeps: false
nodeLinker: hoisted
EOF
```

然后：

```sh
dsh plugin --profile web add 'github:wptoux/dsh-work#plugins-2026.09.2&path:plugins/dsh-work-all'
dsh web   # 重启生效
```

三项缺一不可的原因与完整说明见 `plugins/README.md` 的「GitHub 安装 → 方式 A」。

按需挑选时仍然可以只装单个插件（`path:plugins/<目录>`，只需 `allowBuilds` 配置），
两种方式可任意混用。

## 与独立安装的关系

- 聚合包行 id 统一带 `dsh-work-` 前缀，可与同名插件的独立安装**共存**：loader 不会因
  重复 id 拒绝，host/client 半区按包名去重，只挂载一次。
- 按 id 写的 profile 配置行需改用带前缀的 id（例如 remote-web-ui 的 `autoTunnel`
  要写成 `dsh-work-remote-web-ui` 行）。
- 本包是**手写维护**（无生成器）：后续新增/移除插件时，需同步修改本包的
  `cordis.patch.yml` 与 `package.json` dependencies。
- 本地开发（`~/dsh-work` 源码即改即生效）仍走 profile 直连 3 条 `link:`，**不要**把本包
  link 进本地 profile 当开发接线——本包只用于对外分发 / 换机器 / 一次性装齐。
