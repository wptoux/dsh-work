# dsh-work

> 中文版: [README.md](README.md)

### DeepSeek Harness plugins that just work.

A set of DeepSeek Harness (dsh) web plugins forked from the community — picked and trimmed for real-world use, with fine-tuning so they fit your daily workflow.

**pnpm ≥ 9.5** · **5 plugins** · **MIT / Apache-2.0**

---

## About dsh-work

"work" works two ways here: the plugins that actually **work**, and the **work** of getting your daily tasks done.

Community dsh plugins are popping up every day, but compatibility is hard to debug and the experience is rarely consistent. So instead of chasing upstream releases, we fork what's useful, trim and tune it, and keep it stable.

And in the AI era, changing code is cheap — when something interesting shows up in the community, we can just merge it into this repo with AI, no need to wait on upstream.

## Features

Five plugins covering a unified mobile & web experience, mobile remote control, sidebar, usage stats, and archive management:

### dsh-ui-tweaks · Unified mobile & web experience

- **One UI everywhere**: phones and desktop share the same web experience
- **Narrow-screen drawer**: sidebar collapses into a drawer on small screens
- **Fold completed turns**: keep long chats clean, showing only the last reply

### dsh-remote-web-ui · Mobile remote control

Source: [zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui)

- **Scan to pair**: QR entry + one-time pairing tokens, secure and effortless
- **Automatic tunnel**: built-in cloudflared tunnel, works from anywhere
- **Session control**: live device status, revoke anytime

### dsh-better-sidebar · Enhanced sidebar

Source: [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)

- **VSCode-style**: explorer, editor, terminal, git, browser
- **Per-conversation isolation**: each session independent
- **Extensible**: open API for other plugins to register tabs

### dsh-usage-stats · Usage statistics

Source: [Ychris12138/dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats)

- **Usage heatmap**: see token consumption at a glance
- **Balances & quotas**: provider balances and subscription quotas in one place

### dsh-archive-manager · Archive management

Source: [z953218350/dsh-archive-manager](https://github.com/z953218350/dsh-archive-manager)

- **Preview, restore, delete** archived conversations from the settings page

## Demo

Desktop — the unified web UI with the enhanced sidebar, here editing this README:

![Desktop demo](assets/images/demo1.png)

Mobile — remote control, keep the conversation going from anywhere:

![Mobile demo](assets/images/demo2.png)

## Quick start

Requirements: **pnpm ≥ 9.5** (npm does not support git-subdirectory dependencies).

1. Add the plugins to `~/.dsh/profiles/web/package.json`:

   ```json
   "dependencies": {
     "dsh-remote-web-ui":   "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-remote-web-ui",
     "dsh-better-sidebar":  "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-better-sidebar",
     "dsh-usage-stats":     "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-usage-stats",
     "dsh-archive-manager": "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-archive-manager",
     "dsh-ui-tweaks":       "github:wptoux/dsh-work#plugins-2026.08.1&path:plugins/dsh-ui-tweaks"
   }
   ```

2. Allow the two native binaries (one-time) in `~/.dsh/profiles/web/pnpm-workspace.yaml`:

   ```yaml
   allowBuilds:
     cloudflared: true
     node-pty: true
   ```

3. Install and restart dsh:

   ```sh
   cd ~/.dsh/profiles/web && pnpm install
   ```

## License

Upstream code remains under its original license (MIT / Apache-2.0); additions and modifications in this repo follow this repo's [MIT License](LICENSE). License files are kept in each plugin directory.
