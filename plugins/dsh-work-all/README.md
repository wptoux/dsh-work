# dsh-work-all

dsh-work 全家桶**聚合载具包**：安装这一个包 = 5 款插件（remote-web-ui / better-sidebar /
usage-stats / archive-manager / ui-tweaks）一次性全部就位。

本包**没有自己的插件逻辑**（纯载具）：`dependencies` 以 git 子目录引用拉入全部子包，
`cordis.patch.yml` 汇总各子包的挂载行。DSH loader 从 profile 顶层按行 `name:` 解析子包
（pnpm 默认 hoisted 布局下传递依赖可达顶层），装完自动挂载。

## 安装

首次需要一次性配置 profile 的 `pnpm-workspace.yaml`（整合包路线三件套：放行原生二进制
构建、放行 git 传递依赖、扁平布局让子包可被 loader 从 profile 顶层解析）：

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
- better-sidebar 是个例外（注册 `/sidebar/api` 路由，双挂载会直接启动失败）：聚合包行
  **不带守卫**，由独立包自带的行守卫负责——当聚合包在 `dsh.profile.bundles` 里排在独立包
  之前（标准安装顺序：先装聚合包、之后再补装独立包）时，独立行自动退让、聚合包生效；
  反向（先独立后聚合）是上游已知限制，会双挂载启动失败（聚合行若也加守卫，两个 disabled
  表达式会互相递归评估，loader 直接栈溢出，已实测）。两个来源并存没有额外收益，
  建议只保留一个。
- 本包是**手写维护**（无生成器）：后续新增/移除插件时，需同步修改本包的
  `cordis.patch.yml` 与 `package.json` dependencies。
- 本地开发（`~/dsh-work` 源码即改即生效）仍走 profile 直连 5 条 `link:`，**不要**把本包
  link 进本地 profile 当开发接线——本包只用于对外分发 / 换机器 / 一次性装齐。