# DSH Remote Web UI


English | [中文](README.zh.md)
> Remote access for phones and computers: pair a phone to use the current dsh web workspace remotely, or pair a computer browser through the same token to run the full Web GUI from another device.

> **Settings card**: the remote-control configuration (enable/disable, token
> lifetime, device limits, tunnel) lives in the official
> Settings → Plugins → Plugin configuration (设置 → 插件 → 插件配置) list as the
> `remote-web-ui` tab — it is not a standalone navigation entry.

This repository is an external plugin package for DeepSeek Harness (DSH):
pairing-based remote access for the dsh web GUI on phones and computers. It is
a single dual-face package — the host half owns pairing tokens, device
sessions and the `/api/pair` route family (a paired device is *recognized* by
its cookie); the browser half renders the sidebar-foot remote-access entry (an
icon-only entry beside the settings button), the pairing panel with a QR
code, live device status, an authorized-device list, and stop/refresh/copy
actions.

> **This fork removed the standalone `/m/` mobile surface**: phones and
> computers use the same pairing link (a `/api/pair/open?token=...`
> bootstrap URL) and both run the full Web GUI after pairing (the
> narrow-screen layout comes from `dsh-ui-tweaks` — the sidebar collapses
> to a whale-logo drawer at the top-left).

## What it does

- **Entry**: a phone icon beside the settings button in both the expanded sidebar and narrow rail; its tooltip and accessible label say "Remote access".
- **Panel**: "Remote access" title, "Pair a phone or another computer to access this workspace remotely" subtitle, a "Pair a device" card with the status area ("Waiting for a device" + status badge), a large QR code, one **unified pairing link** (a `/api/pair/open?token=...` bootstrap URL) with a copy button, plus Stop / Refresh QR actions and an authorized-device list (a device name inferred from User-Agent, online/offline, last active time, per-device unpair). Credential-bearing device ids and raw User-Agent values are never rendered. The link carries one single-use token that dies as soon as any device pairs.
- **Device side (the same path for phones and computers)**: scanning the QR or opening the copied link runs a two-hop bootstrap — the `/api/pair/open` hop consumes the one-time, time-limited token and sets the HttpOnly device cookie, then redirects to the harness's native launch-token URL (`/?token=...`), which exchanges it for the browser-session cookie and lands the device on the **full Web GUI** — workspaces, sessions, chat, model switching. Fresh devices no longer receive a `workspace` query parameter (the native index exchange redirects to the clean root); a direct `/?workspace=<id>` link still deep-links an already-authorized browser. Phones get the narrow-screen layout from `dsh-ui-tweaks` (the sidebar hides, leaving a small whale logo at the top-left that opens the sidebar as a drawer overlay).
- **Security**: one active one-time token (a refresh invalidates the old
  link; an accepted token cannot be reused; tokens expire). 停止 revokes
  every paired device and the current token — a revoked device is no longer
  recognized by the plugin's pairing surfaces and must scan a fresh QR.
  **DSH 0.1.5 adaptation**: the harness's `/api` trust fence is declarative
  (`Connection` config `trustedHosts` + LAN literals auto-trusted from an
  all-interface bind) and its index is gated by a browser-session cookie
  minted from the per-process launch token; the 0.1.1 `api/gate`
  per-request veto seam no longer exists. Pairing is therefore
  *identity/recognition*, not access control over the harness's own `/api`
  dispatch: this plugin owns its `/api/pair` surfaces, exposes the live
  paired-cookie predicate to sibling plugins (`remoteWebUiPairing`), and
  manages token/session lifecycle — its bootstrap hop drives devices
  through the native launch-token exchange, and it mirrors the active
  public host into the SDK `/api` trust list at runtime (a tunnel host is
  unknowable at boot, so it cannot enter the fence via `--trusted-host`).
  It does not otherwise veto what the SDK itself trusts for `/api`. On DSH
  ≥0.1.5 with a `0.0.0.0` bind, LAN origins are trusted by the SDK by
  default; bind loopback when you want `/api` LAN-closed.
- **Live status**: the desktop panel mirrors the pairing state in real time
  (waiting → connected → disconnected) over an SSE stream, including the
  authorized-device list.
- **Remote update**: removed in this frozen fork — the dsh-web-ui
  self-update surface (sidebar download trigger, `/api/update` endpoints, npm
  registry probes) was cut; the fork never updates plugins from npm.

## Requirements

- A DSH installation whose `dsh` CLI supports profiles (`dsh --profile`,
  `dsh plugin`) — the profile/bundle mechanism this package rides on.
- For LAN use the server must be reachable from the phone: start with
  `dsh web --host 0.0.0.0`. With the default `127.0.0.1` bind the panel
  shows an explicit explanation instead of a dead QR code — unless a public
  base URL is configured (see "Remote access over the internet" below),
  which makes the QR reachable from anywhere without rebinding. The panel's
  mint/stop endpoints are loopback-only by design: a desktop browser
  opened at the LAN URL sees a "配对面板仅限本机使用" banner instead —
  open the panel at `http://127.0.0.1` and let the phone use the paired
  link.
- For the one-click public tunnel (`autoTunnel`), the `cloudflared`
  platform binary ships with the package (its postinstall downloads it; a
  runtime download covers installers that skip postinstall scripts). No
  user-side tooling, account, or domain is needed — a Cloudflare quick
  tunnel is free and anonymous.
- Phones need nothing installed: they open the plugin's pairing link and run
  the full Web GUI in the browser (the narrow-screen layout comes from
  `dsh-ui-tweaks`).

## Install

Install the family aggregate package `@linxin666/dsh-web-ui-all` (all plugins and skins in one) or this plugin alone:

```sh
# Recommended: install directly from npm
dsh plugin --profile web add dsh-remote-web-ui@latest

# Or from the repository (development loop)
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-remote-web-ui

```

Restart the profile (`dsh web`), then open the phone icon in the sidebar
foot. The plugin's `cordis.patch.yml` inserts the single plugin row that
mounts both halves.

> Install this package through the GitHub subdirectory channel
> (`github:wptoux/dsh-work#<tag>&path:plugins/dsh-remote-web-ui`,
> pnpm ≥9.5) or wire it locally with `link:`. The package ships its
> committed `lib/` (no `prepare` build), so git installs build nothing;
> only the native binaries' scripts need an `allowBuilds` entry (canonical
> install block: `plugins/README.md`「GitHub 安装」).

## Use

1. `dsh web --host 0.0.0.0` (the printed LAN URL confirms reachability).
2. Click the phone icon → the panel mints a fresh one-time QR.
3. Scan with the phone (or open the copied link): the phone consumes the
   token, bounces through the native launch-token exchange, and lands in
   the **full Web GUI**. On a narrow screen the layout comes from
   `dsh-ui-tweaks` — the sidebar hides automatically, leaving a small whale
   logo at the top-left that opens the sidebar as a drawer overlay;
   workspaces, sessions, chat, and model switching are exactly the desktop's.
4. **Pair another device (a computer or a phone — the same link)**: copy the
   link and open it in a browser on that device (LAN URL or tunnel URL).
   After the accept round trip the full Web GUI runs there. One active token
   pairs one device; mint a fresh QR for the next device.
5. The desktop badge flips to 已连接 in real time; it falls back to
   offline/断开 when the device leaves.
6. 刷新二维码 invalidates the old link and issues a new one. 停止 revokes
   remote access: a revoked device is no longer recognized and must scan
   again.

The pairing link runs a two-hop bootstrap straight into the full Web GUI:
`/api/pair/open` (this plugin) consumes the one-time token and sets the
device cookie, then redirects to the harness's native launch-token URL,
which mints the browser-session cookie and lands on `/`. On DSH ≥0.1.5 the
SDK trusts LAN literals (and any configured `trustedHosts`) for `/api`
directly, so a paired phone or computer runs the GUI natively — **no
harness source changes and no request rewriting** are needed. The plugin
owns the `/api/pair` surface (token mint/accept/open/revoke/heartbeat/
status/events) and the `remoteWebUiPairing` service: sibling plugins
recognize a live paired device by its cookie.

### Behavior notes

- Pairing is identity/recognition (DSH ≥0.1.5): the plugin manages tokens,
  device sessions, and revocation on its own `/api/pair` surfaces, and
  offers the live paired-cookie predicate through the `remoteWebUiPairing`
  service. It does not rewrite or veto the harness's own `/api` traffic —
  the SDK trust fence (`trustedHosts` + LAN-literal auto-trust) is the
  harness's seam. Bind loopback (or restrict `trustedHosts`) when you need
  `/api` closed to the LAN.
- Sibling host routes outside `/api` (`/pet/*`, `/git/*`, the right-panel `/aionui-panel/*`
  family) can consult this plugin's `remoteWebUiPairing` service: a live
  paired-device cookie is an allow path, `stop()` stops recognizing those
  cookies too, and the service is absent when this plugin is not installed.
- The QR link is built from the machine's non-internal IPv4 literals; a
  multi-homed host (Wi-Fi + wired, or a proxy/VPN virtual adapter) shows a
  radio picker so you can advertise the network the phone can actually
  reach. The first literal is the default. When `publicBaseUrl` is set, the
  picker adds a 公网地址 option on top — the default QR then uses the
  public base, and picking a LAN literal re-mints an in-network link.
- A configured `publicBaseUrl` satisfies the reachable-bind requirement on
  its own: `dsh web` bound to `127.0.0.1` (no `--host 0.0.0.0`) still mints
  working public QR links through the tunnel.

## Remote access over the internet (tunnels)

### One-click public tunnel (recommended)

Turn on `autoTunnel` in the plugin settings card (or set
`autoTunnel: true` in the profile patch). The plugin then runs its own
Cloudflare quick tunnel — the `cloudflared` binary ships with the package,
no install, account, or domain needed — and wires everything itself:

- the minted `https://xxx.trycloudflare.com` URL becomes the QR base, so a
  phone anywhere can pair. The panel shows the tunnel status (starting /
  running / failed with the reason), and a crash is restarted
  automatically with backoff.

The QR stays LAN-only until the tunnel reports its URL, and a tunnel
restart mints a NEW hostname — the plugin clears the old link and mints a
fresh one, so users never touch configuration. Note that a quick tunnel is
public: anyone with the URL can load the static page; the pairing
surface's own fences (`/api/pair` control endpoints are loopback-only,
phone-facing endpoints accept the configured public host) are the plugin's
boundary. The tunneled Host is not in the connection trust fence, so on a
loopback-only bind the tunnel is the only way in; on a `0.0.0.0` bind the
SDK already trusts LAN origins.

### Manual tunnels (bring your own)

The QR link is normally a LAN URL, so a phone outside the house cannot use
it. Point a tunnel at the dsh web port and tell the plugin its public
address — the QR is then built from the tunnel URL. One knob is involved;
`--trusted-host` is a separate SDK flag, not part of this pairing path:

- **`publicBaseUrl`** (plugin config, in the profile patch or the settings
  card): the public origin, e.g. `https://foo.trycloudflare.com`. The QR
  link is built from it, and `accept`/`heartbeat`/`status` accept its host.
  Malformed values are ignored with a warning (LAN-only behavior kept).
  Unpaired callers of `status` see only the pairing-relevant fields (phase /
  LAN bases); token expiry, device roster, and the tunnel URL require a live
  device cookie. The accept rate limit partitions its buckets by the
  client-visible `X-Forwarded-For` hop so one internet client cannot
  exhaust the shared bucket behind the tunnel.
- **`--trusted-host <tunnel-domain>`** (optional dsh web flag, not
  recommended for this plugin): the flag makes the SDK trust the host for
  `/api` itself — but the browser-session cookie still gates every request,
  so it adds nothing this plugin already provides for its own tunnel. The
  plugin mirrors the active public host into the SDK `/api` trust list at
  runtime (a quick-tunnel hostname is unknowable at boot, so it cannot be
  declared up front), which is exactly the trust a paired phone needs while
  the pairing surfaces keep the identity fence. The SDK leaves no per-request
  veto seam for third-party plugins (0.1.1's `api/gate` is gone), so pairing
  only covers the plugin's own surfaces; the more closed stance is to rely on
  the plugin's mirror plus the browser cookie and let devices pair.

### Cloudflare Tunnel (quick tunnel — no account, no domain)

Install the client once (macOS: `brew install cloudflared`; other systems:
grab the `cloudflared-darwin-{arm64,amd64}` binary from the official GitHub
releases). Then:

```sh
# 1. Expose the local port (whatever dsh web is listening on):
cloudflared tunnel --url http://127.0.0.1:3080
#    prints something like: https://xxxx-xxxx-xxxx.trycloudflare.com

# 2. Start dsh web as usual. Do not add --trusted-host for the tunnel
#    domain: the plugin mirrors the active public host into the SDK /api
#    trust list at runtime, and the browser-session cookie still gates every
#    request.
#    Use --host 0.0.0.0 only when LAN access should stay available:
dsh web
```

Then set `publicBaseUrl: https://xxxx-xxxx-xxxx.trycloudflare.com` in the
profile patch (or the plugin settings card — it hot-reloads). Open the
phone icon at `http://127.0.0.1`, scan the QR from anywhere: the phone
binds, reloads into the full Web GUI, and heartbeats keep it online. A
desktop browser opened at the same tunnel URL pairs the same way via the
same link, running the full Web GUI.

Notes:

- Quick tunnels are free and need no login, but the hostname is random per
  run: every `cloudflared` restart changes it, so update `publicBaseUrl`
  with it. Cloudflare documents no uptime guarantees;
  in-flight-request concurrency is capped (HTTP 429 past it). **Quick
  Tunnels do not forward Server-Sent Events but do forward WebSocket
  upgrades** — and the full Web GUI's live event stream rides exactly a
  WebSocket upgrade (`/api/events.mux`), so phones and remote computers get
  live messages through a quick tunnel; plain HTTP always forwards.
- A quick tunnel is public: anyone with the URL can load the static page.
  The plugin's boundary is its own pairing-surface fences (`/api/pair`
  control endpoints are loopback-only; phone-facing endpoints accept the
  configured public host) plus the harness's browser-session cookie. The
  plugin mirrors the public host into the SDK's `/api` trust list so the
  paired phone's native GUI API calls pass the Host fence — the cookie
  still gates every request — and you should not add the tunnel domain to
  `--trusted-host` yourself.
- For a stable hostname, create a named tunnel from the Cloudflare
  dashboard (Networking → Tunnels; the domain must be hosted on Cloudflare)
  and use its hostname as `publicBaseUrl` (only). Reachability from
  mainland China is not guaranteed by Cloudflare; verify locally.
- Tailscale is an alternative for personal use that needs no plugin
  changes at all: its virtual-interface address (`100.x.y.z`) shows up in
  the QR's address picker automatically, and a phone on the same tailnet
  reaches it like a LAN host.

## Development

Work from this repository (no sibling checkout needed):

```sh
cd ~/code/dsh-web-ui
export NPM_TOKEN='<token>'   # only if private @deepseek-ai auth is still required
pnpm install
pnpm --filter dsh-remote-web-ui run build
pnpm --filter dsh-remote-web-ui test
pnpm --filter dsh-remote-web-ui run typecheck
```

The peer APIs come from the official NPM SDK: every `@deepseek-ai/*` package
used here is declared in devDependencies (rc.6), and TypeScript/Vitest resolve
types straight from node_modules — no DSH source checkout is required. The
package ships its committed `lib/` (built from `src` at release time) and has
no `prepare` build, so git installs work without any harness checkout either.

## Checks

```sh
pnpm run typecheck
pnpm test
pnpm run build
```

## Harness contract dependencies

This plugin rides the harness seams below (0.1.5 line):

- **The declarative `/api` trust fence** (connection config `trustedHosts`
  + LAN literals auto-trusted on an all-interface bind): the 0.1.1
  `api/gate` per-request waterfall is gone and the SDK leaves third-party
  plugins no per-request veto seam — so pairing is identity/recognition
  (the `/api/pair` surface + the `remoteWebUiPairing` service), not a
  rewrite or veto of the harness's own `/api` dispatch.
- **`sidebar.footer.action` foot list seat** (packages/client/ui-sidebar):
  the sidebar declares and renders the seat the phone entry occupies (the
  0.1.1 `sidebar.remote` seat was deleted).
- **`settings.plugins.tab` tab seat** (packages/client/ui-settings): the
  Settings → Plugins section dispatches this plugin's configuration card by
  namespace (the 0.1.1 `settings.plugin.item` keyed seat was deleted).

The fence helpers (`isTrustedApiRequest` / `isLoopbackHostname`) are
reimplemented locally in `src/gate.ts` / `src/routes.ts`: the SDK moved the
trust fence inside the connection plugin and stopped exporting them, so the
pairing routes carry their own copy scoped to the literals the QR links
advertise. The browser-side `ctx.slots` is restated structurally by this
package (the 0.1.5 UI packages do not declare it on the cordis Context;
better-sidebar uses the same structural mirror).

## Manual E2E: LAN pairing round trip

The unit/component specs cover the route family, the pairing surfaces, and
the panel, but the pairing loop involves a real browser on a non-loopback
origin. Repeat this after any change to the wire contract or the pairing
flow:

1. Start the server on all interfaces with a test workspace root:
   `dsh web --host 0.0.0.0 --port 3190 --workspace-root /tmp/remote-e2e`.
2. Open the **loopback** URL (`http://127.0.0.1:3190`) in a browser: the
   phone icon sits in the sidebar foot; the panel mints a QR instantly.
3. In a second tab (or a phone) open the **LAN** URL with the pair token
   (e.g. `http://192.168.1.7:3190/api/pair/open?token=<token>`): the page
   accepts, sets the HttpOnly `dsh_pair` cookie, bounces through the native
   launch-token exchange, and boots the full UI — no console errors, and a
   generation round trip completes.
4. The desktop badge flips to 已连接 in real time; a LAN-origin desktop
   page instead shows the 配对面板仅限本机使用 banner and opens no status
   stream.
5. 停止 on the desktop cuts the phone off: the device is no longer
   recognized — its heartbeats and pair-surface calls are refused, and the
   panel badge flips back (a fresh QR re-pairs it).

The public path is the same round trip through a tunnel (see "Remote access
over the internet"): loopback mint → phone or PC opens the public QR URL →
accept → UI. Only `publicBaseUrl` (plugin config) names the tunneled host;
`--trusted-host` is not part of this pairing flow. The desktop panel still
opens at `http://127.0.0.1`.

## Security model

- The plugin's pairing surfaces recognize devices by a live session:
  `/api/pair` stop/revoke and the loopback panel endpoints are
  loopback-only, the accept/open/heartbeat/status endpoints accept the LAN
  literals or the configured public host (an opaque `Origin: null` from a
  camera QR scanner or in-app webview counts as absent — explicit
  `sec-fetch-site: cross-site` markers are still refused), and the
  `remoteWebUiPairing` service hands the "live paired-device cookie"
  predicate to sibling plugins. Revocation is immediate: a revoked device
  is no longer recognized and must scan again. The harness's own `/api`
  trust (`trustedHosts` + LAN auto-trust) is the SDK's seam; this plugin
  does not veto it — it only mirrors its own active public host into the
  SDK's trust list at runtime (the tunnel host is unknowable at boot) and
  drives fresh devices through the native launch-token exchange, so the
  browser cookie always gates the harness's own `/api`.

## Known Limitations and Deferred Work

- **Revocation is immediate**: a revoked device session stops being
  recognized by the plugin's pairing surfaces and must pair again.
- **Paired device sessions persist by default**: device sessions (not the
  one-time QR token) are written to `$DSH_HOME/remote-web-ui-devices.json`
  (0600, temp file + atomic rename). A paired cookie still works after a
  `dsh web` restart. Refreshing the QR still mints a new token; restarting
  does not restore the current QR. An explicit 停止 (stop) or per-device
  取消配对 still revokes immediately and the revocation is persisted.
  Sessions idle for `idleExpireMs` (default 7 days, no heartbeat or paired
  request) are deleted and must pair again. Device ids are session
  credentials (the pairing surfaces authorize by the device id in the
  cookie).
  Override `devicesFile` with another absolute path when needed. Changing
  `cookieName` invalidates existing devices (expected).
- **Device roster is loopback-only**: the pairing panel lists authorized
  devices using a short name inferred from User-Agent (for example,
  `Windows · Chrome`), online/offline state, and last active time, and can
  unpair one at a time. Credential-bearing device ids and raw User-Agent
  values are not rendered. `/api/pair/status` never returns the device id
  list, even to a paired device.
- **Quick-tunnel hostnames change per run**: a `trycloudflare.com` URL is
  random on every `cloudflared` start, so `publicBaseUrl` must be updated
  whenever the tunnel restarts. A named tunnel (fixed hostname) avoids the
  churn.
- **Dev HMR**: `dsh web --dev` polls every roster bundle by path, so
  rebuilding this package (its own `tsdown --watch`) hot-reloads the client
  bundle; no harness-side watcher is involved.

## Dependency rationale

`qrcode.react` (MIT, actively maintained, React 16–19 support) renders the
QR as a dependency-free SVG component — no canvas, no server-side image
generation. It is inlined into the client bundle at build time (like the
official skin/turtle-ui plugins inline their non-shared deps), so profile
installations need no extra runtime dependency beyond the dsh peer closure.
`schemastery` is the DSH-standard config schema validator.
