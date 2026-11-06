# dsh-work

> 中文版: [README.md](README.md)

### DeepSeek Harness plugins that just work.

A set of DeepSeek Harness (dsh) web plugins forked from the community — picked and trimmed for real-world use, with fine-tuning so they fit your daily workflow.

**pnpm ≥ 9.5** · **2 plugins** · **MIT / Apache-2.0**

---

## About dsh-work

"work" works two ways here: the plugins that actually **work**, and the **work** of getting your daily tasks done.

Community dsh plugins are popping up every day, but compatibility is hard to debug and the experience is rarely consistent. So instead of chasing upstream releases, we fork what's useful, trim and tune it, and keep it stable.

And in the AI era, changing code is cheap — when something interesting shows up in the community, we can just merge it into this repo with AI, no need to wait on upstream.

## Features

Two plugins covering mobile remote control and usage statistics:

### dsh-remote-web-ui · Mobile remote control

Source: [zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui)

- **Scan to pair**: QR entry + one-time pairing tokens, secure and effortless
- **Automatic tunnel**: built-in cloudflared tunnel, works from anywhere
- **Session control**: live device status, revoke anytime

### dsh-usage-stats · Usage statistics

Source: [Ychris12138/dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats)

- **Usage heatmap**: see token consumption at a glance
- **Balances & quotas**: provider balances and subscription quotas in one place

### Removed (now native in DSH 0.2.2)

These four used to live here and were removed once the kernel shipped equivalents: their
sources remain in git history and tag `plugins-2026.09.2`, plus a whole-repo backup at
`.git-backup/pre-plugin-removal-2026-11-06.bundle`.

| Plugin | Why removed |
|---|---|
| `dsh-better-sidebar` | DSH 0.2.x ships a native right sidebar (`dsh-client-ui-sidebar-right` with `-files` / `-terminal` / `-documentpreview`) covering file tree, terminal and document preview |
| `dsh-archive-manager` | Native archived-conversation entry, no settings-page plugin card needed |
| `dsh-model-sync` | DSH 0.2.2 upgrades pi-ai to 1.3.0 and syncs the model catalog with the kernel; no local route takeover needed |
| `dsh-ui-tweaks` | DSH 0.2.2's layout has a native `<768px` sidebar drawer (`data-sidebar-drawer`), which conflicts with the plugin's own drawer |

## Demo

Desktop — the unified web UI with the native right sidebar, here editing this README:

![Desktop demo](assets/images/demo1.png)

Mobile — remote control, keep the conversation going from anywhere:

![Mobile demo](assets/images/demo2.png)

## Quick start

Requirements: dsh installed, with **pnpm ≥ 9.5** on your PATH (needed for
git-subdirectory dependencies; npm does not support them).

`dsh plugin` forwards its arguments to pnpm inside the profile directory
(equivalent to `pnpm add …`), then **automatically syncs any dependency that
declares `dsh.bundle` into `dsh.profile.bundles`** (no manual layer-list
maintenance) and initializes the profile on first use.

1. One-time profile config (the aggregate route needs three things: allow the
   native binaries' build scripts, allow git transitive dependencies, and hoist
   the child packages to the profile top level so the loader can resolve them):

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

   > Skip if already configured; if the file exists, merge these keys into it.
   > All three are required (verified on pnpm 11): ① build scripts of
   > dependencies are blocked by default → `ERR_PNPM_IGNORED_BUILDS`;
   > ② git (exotic) dependencies are banned in the subdependency position by
   > default → `ERR_PNPM_EXOTIC_SUBDEP`; ③ the default isolated layout does not
   > hoist git child packages to the profile top level → `Cannot find package`
   > at boot. The first two are idempotent — fix and re-run the same command.
   > Per-plugin installs (see step 2 note) only need `allowBuilds`.

2. Install the aggregate package (both remaining plugins at once):

   ```sh
   dsh plugin --profile web add 'github:wptoux/dsh-work#plugins-2026.09.2&path:plugins/dsh-work-all'
   ```

   > `dsh-work-all` is an **aggregate carrier package**: its dependencies pull in
   > all 2 plugins and its `cordis.patch.yml` collects their mount rows, so one
   > command installs everything (it can coexist with standalone installs; the
   > mechanics are documented in `plugins/README.md` under "聚合包"). To pick
   > only some plugins, install them individually instead (per-plugin installs
   > are direct git dependencies, so the profile only needs `allowBuilds`):
   >
   > ```sh
   > dsh plugin --profile web add 'github:wptoux/dsh-work#plugins-2026.09.2&path:plugins/dsh-remote-web-ui'
   > dsh plugin --profile web add 'github:wptoux/dsh-work#plugins-2026.09.2&path:plugins/dsh-usage-stats'
   > ```
   >
   > The equivalent manual way, if you prefer to maintain the profile yourself,
   > is editing `~/.dsh/profiles/web/package.json`:
   >
   > ```json
   > "dependencies": {
   >   "dsh-remote-web-ui":   "github:wptoux/dsh-work#plugins-2026.09.2&path:plugins/dsh-remote-web-ui",
   >   "dsh-usage-stats":     "github:wptoux/dsh-work#plugins-2026.09.2&path:plugins/dsh-usage-stats"
   > }
   > ```
   >
   > then run `cd ~/.dsh/profiles/web && pnpm install`. Note the manual way does
   > **not** update `dsh.profile.bundles` automatically — you must keep the
   > package names in that list yourself. That is why `dsh plugin` is recommended.

3. Restart dsh to apply: `Ctrl+C`, then `dsh web` again.

**Upgrade**: re-run `dsh plugin ... add` with the tag (`plugins-2026.09.2`) replaced by the new one (the aggregate command if you installed the aggregate, or per-plugin commands).
**Rollback**: `dsh plugin --profile web remove dsh-work-all` (removes both plugins and the bundles entry at once), or remove plugins one by one; alternatively re-add with the old tag.

## License

Upstream code remains under its original license (MIT / Apache-2.0); additions and modifications in this repo follow this repo's [MIT License](LICENSE). License files are kept in each plugin directory.
