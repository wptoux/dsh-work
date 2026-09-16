/**
 * Phone and desktop remote control for the dsh web GUI — host half. Mounts
 * the pairing service (one-time tokens, device sessions, revocation), the
 * /api/pair route family (issue/accept/stop/heartbeat/status/events), the
 * presence sweep, and the optional public-tunnel QR base. The browser half
 * (the `./client` entry) renders the sidebar entry, the pairing panel, and
 * the pair/accept + deep-link flow.
 *
 * DSH 0.1.5 adaptation: the harness's /api trust fence is declarative
 * (`Connection` config trustedHosts + LAN literals auto-trusted from an
 * all-interface bind) and the 0.1.1 `api/gate` per-request veto seam no
 * longer exists. Pairing is therefore identity/recognition: this plugin owns
 * its /api/pair surfaces and exposes the live paired-cookie predicate to
 * sibling plugins (RemoteWebUiPairing), but it does not veto the harness's
 * own /api dispatch.
 */

import { join } from 'node:path'
import { setInterval as nodeSetInterval, setTimeout as nodeSetTimeout } from 'node:timers'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the dsh-settings Context merge (ctx.settings) so the
// installSection surface resolves.
import type {} from '@deepseek-ai/dsh-settings'
// Type-only: pulls the dsh-client-connection Context merge (ctx.connection —
// HostConnectionHandle) for the native launch-token exchange and the fence
// trust mirror.
import type {} from '@deepseek-ai/dsh-client-connection'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { DEFAULT_IDLE_EXPIRE_MS, PairingService, type PairingConfig } from './pairing.ts'
import { asTrustedHostsOwner, ConnectionTrustSync } from './connection-trust.ts'
import { dshHome } from './dsh-home.ts'
import { isPairedDeviceRequest } from './gate.ts'
import { RemoteWebUiPairing } from './pairing-access.ts'
import { makeRoutes } from './routes.ts'
import { lanIPv4Addresses } from './lan.ts'
import { TunnelManager, type TunnelInfo } from './tunnel.ts'
import { mountOnce } from './mount-once.ts'
import { UUID_POLYFILL_SCRIPT } from './uuid-polyfill.ts'

/** Stable cordis plugin name. */
export const name = 'remote-web-ui'

/** Services required before the pairing surfaces can mount. */
export const inject = ['webServer', 'settings', 'connection']

/**
 * Settings namespace of the remote-control capability — the section the web
 * settings surface edits. Spelled here rather than imported: the browser
 * half spells the same value and must not depend on a Host package.
 */
export const REMOTE_WEB_UI_SETTINGS_NAMESPACE = 'remote-web-ui'

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Token lifetime in ms; the QR link dies after this. */
  tokenTtlMs?: number
  /** A device is "online" while its lastSeenAt is newer than this (ms). */
  offlineAfterMs?: number
  /** Hard cap on paired device sessions (oldest evicted when full). */
  maxDevices?: number
  /**
   * Idle sessions older than this (ms) are deleted from memory and disk.
   * Default is 7 days; a leftover cookie no longer authorizes after expiry.
   */
  idleExpireMs?: number
  /** Cookie name carrying the paired device id. */
  cookieName?: string
  /**
   * Public base URL of a tunnel in front of this server (e.g. a Cloudflare
   * Tunnel quick URL `https://xxx.trycloudflare.com` or a named-tunnel
   * subdomain). When set, the QR link is built from it — a phone anywhere
   * can pair — and its host is trusted by the phone-facing pairing fence.
   * Leave unset for LAN-only usage. Malformed values are ignored with a
   * warning (LAN-only behavior preserved). Ignored while `autoTunnel` is on.
   */
  publicBaseUrl?: string
  /**
   * Absolute path to a JSON file where paired device sessions are persisted.
   * Defaults to `$DSH_HOME/remote-web-ui-devices.json` so a paired device
   * keeps its session across `dsh web` restarts (the cookie already lives
   * 365 days). Override to another absolute path when needed.
   */
  devicesFile?: string
  /**
   * When true, the plugin runs its own Cloudflare quick tunnel (the
   * cloudflared binary ships with the package — no user-side install) and
   * feeds the minted public URL into the QR base and the phone-facing
   * pairing fence dynamically, so phones anywhere can pair without any manual
   * tunnel setup. The manual `publicBaseUrl` is ignored while this is on.
   */
  autoTunnel?: boolean
  /** Master switch for the plugin (browser half + host pairing surfaces). */
  enabled?: boolean
}

export const Config: z<Config> = z.object({
  tokenTtlMs: z.number().step(1).min(60_000).default(10 * 60_000),
  offlineAfterMs: z.number().step(1).min(5_000).default(25_000),
  maxDevices: z.number().step(1).min(1).max(64).default(4),
  idleExpireMs: z.number().step(1).min(60_000).default(DEFAULT_IDLE_EXPIRE_MS),
  cookieName: z.string().min(1).default('dsh_pair'),
  publicBaseUrl: z.string(),
  devicesFile: z.string(),
  autoTunnel: z.boolean().default(false),
  enabled: z.boolean().default(true),
})

/** Presence sweep cadence (a stale device flips to disconnected within two sweeps). */
const SWEEP_INTERVAL_MS = 10_000

/**
 * Fully resolved config: every field non-optional except `publicBaseUrl`,
 * which legitimately resolves to `undefined` when unset (the schema keeps it
 * optional, so `Required` alone would over-narrow it to `string`).
 */
type ResolvedConfig = Required<Omit<Config, 'publicBaseUrl' | 'devicesFile'>> & {
  publicBaseUrl: string | undefined
  devicesFile: string
}

/**
 * The single mapping from resolved plugin config to the pairing service
 * config. Both the constructed service and every live settings sync reuse
 * it, so no field can be silently dropped when the web settings surface
 * pushes a new value into the running service.
 */
export function pairingConfigOf(resolved: Pick<
  ResolvedConfig,
  'tokenTtlMs' | 'offlineAfterMs' | 'maxDevices' | 'idleExpireMs' | 'cookieName' | 'devicesFile'
>): PairingConfig {
  return {
    tokenTtlMs: resolved.tokenTtlMs,
    offlineAfterMs: resolved.offlineAfterMs,
    maxDevices: resolved.maxDevices,
    idleExpireMs: resolved.idleExpireMs,
    cookieName: resolved.cookieName,
    devicesFile: resolved.devicesFile,
  }
}

/** Default paired-session store: `$DSH_HOME/remote-web-ui-devices.json`. */
export function defaultDevicesFile(home: string = dshHome()): string {
  return join(home, 'remote-web-ui-devices.json')
}

/** Schema defaults, re-read for hand-built test contexts (the loader applies them normally). */
const DEFAULTS: ResolvedConfig = {
  tokenTtlMs: 10 * 60_000,
  offlineAfterMs: 25_000,
  maxDevices: 4,
  idleExpireMs: DEFAULT_IDLE_EXPIRE_MS,
  cookieName: 'dsh_pair',
  publicBaseUrl: undefined,
  devicesFile: defaultDevicesFile(),
  autoTunnel: false,
  enabled: true,
}

/**
 * Mount the pairing service, routes, and presence sweep.
 * @param ctx - host plugin context carrying webServer and settings.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export const apply = mountOnce('dsh-remote-web-ui', applyImpl)

function applyImpl(ctx: Context, config?: Config): void {
  const resolved: ResolvedConfig = {
    tokenTtlMs: config?.tokenTtlMs ?? DEFAULTS.tokenTtlMs,
    offlineAfterMs: config?.offlineAfterMs ?? DEFAULTS.offlineAfterMs,
    maxDevices: config?.maxDevices ?? DEFAULTS.maxDevices,
    idleExpireMs: config?.idleExpireMs ?? DEFAULTS.idleExpireMs,
    cookieName: config?.cookieName ?? DEFAULTS.cookieName,
    publicBaseUrl: config?.publicBaseUrl,
    devicesFile: config?.devicesFile ?? DEFAULTS.devicesFile,
    autoTunnel: config?.autoTunnel ?? DEFAULTS.autoTunnel,
    enabled: config?.enabled ?? DEFAULTS.enabled,
  }
  // The live source the pairing service reads: the settings section once the
  // web settings surface is served, the composition entry otherwise
  // (settings.installSection swaps it when the namespace registers).
  let current: () => Config = () => config ?? {}
  const resolve = (): ResolvedConfig => {
    const value = current()
    return {
      tokenTtlMs: value.tokenTtlMs ?? DEFAULTS.tokenTtlMs,
      offlineAfterMs: value.offlineAfterMs ?? DEFAULTS.offlineAfterMs,
      maxDevices: value.maxDevices ?? DEFAULTS.maxDevices,
      idleExpireMs: value.idleExpireMs ?? DEFAULTS.idleExpireMs,
      cookieName: value.cookieName ?? DEFAULTS.cookieName,
      publicBaseUrl: value.publicBaseUrl,
      devicesFile: value.devicesFile ?? DEFAULTS.devicesFile,
      autoTunnel: value.autoTunnel ?? DEFAULTS.autoTunnel,
      enabled: value.enabled ?? DEFAULTS.enabled,
    }
  }
  const service = new PairingService(pairingConfigOf(resolved))

  // ── native connection integration (DSH 0.1.5) ─────────────────────────────
  // The QR bootstrap hop redirects to the connection plugin's launch-token
  // URL (the phone lands on the Web GUI with the browser cookie), and the
  // active public host — a tunnel host is unknowable at boot, so it cannot
  // enter the fence via --trusted-host — is mirrored into the connection
  // fence's trustedHosts so the tunneled phone's /api requests pass the Host
  // check while the browser-session cookie still gates every request.
  const trust = new ConnectionTrustSync(asTrustedHostsOwner(ctx.connection))

  // ── auto tunnel ─────────────────────────────────────────────────────────
  // The minted public URL becomes the QR base (and the phone-facing pairing
  // fence's trusted host).
  const tunnel = new TunnelManager()
  let autoTunnel = resolved.autoTunnel
  tunnel.onPhase((info: TunnelInfo) => {
    if (!autoTunnel) return
    if (info.phase === 'running' && info.url !== undefined) {
      service.setPublicBaseUrl(info.url)
      service.setTunnelStatus({ state: 'running', url: info.url })
    } else if (info.phase === 'starting') {
      // A restart mints a NEW hostname: the previous URL dies with the old
      // process, so clear it now rather than advertising a dead link.
      service.setPublicBaseUrl(undefined)
      service.setTunnelStatus({ state: 'starting' })
    } else if (info.phase === 'failed') {
      service.setPublicBaseUrl(undefined)
      service.setTunnelStatus(info.error === undefined ? { state: 'failed' } : { state: 'failed', error: info.error })
    }
    trust.reflect(service.publicBaseUrl)
  })
  ctx.effect(() => () => {
    tunnel.dispose()
    trust.dispose()
  }, 'remote-web-ui: auto tunnel')
  // The bind facts are known by now (webServer is an inject edge): the LAN
  // bases are frozen per process, matching the CLI's once-per-invocation
  // sampling stance. The QR can only advertise addresses the fence accepts;
  // every interface gets its own base URL so a multi-homed machine can pick
  // the network the phone can actually reach.
  const lanBases = ctx.webServer.host === '0.0.0.0'
    ? lanIPv4Addresses().map(address => ({ address, base: `http://${address}:${String(ctx.webServer.port)}` }))
    : []
  service.setLanBases(lanBases)
  const lanAddresses = lanBases.map(entry => entry.address)

  // Push a committed settings section into the service. The service config
  // object is read per operation (token mint, touch, sweep), so a live edit
  // takes effect without a restart. When `enabled` turns off, the pairing
  // routes and sweep timer are dropped and all device/token state is revoked.
  let disposeRoutes: (() => void) | undefined
  let disposeSweep: (() => void) | undefined
  const routes = makeRoutes({
    service,
    lanAddresses,
    authenticatedUrl: base => ctx.connection.authenticatedUrl(base),
  })

  // Inject the crypto.randomUUID polyfill before any other script runs, so that
  // the main bundle doesn't crash on non-secure contexts (LAN HTTP)
  ctx.effect(() => ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'script', placement: 'head', text: UUID_POLYFILL_SCRIPT })
  }), 'remote-web-ui: uuid polyfill')

  // Sibling plugins look this service up by name to recognize a live paired
  // device (the cookie) on their own surfaces. Absent when this plugin is
  // not installed; stop() / enabled=false still refuse cookies.
  new RemoteWebUiPairing(ctx, (request) => {
    if (!resolve().enabled) return false
    return isPairedDeviceRequest(service, request)
  })
  const sync = (): void => {
    const value = resolve()
    service.config = pairingConfigOf(value)
    // The auto tunnel owns the public base while enabled: the minted URL
    // lands in the service through the tunnel's phase listener. The manual
    // publicBaseUrl applies only when the auto tunnel is off.
    autoTunnel = value.autoTunnel === true
    if (autoTunnel) {
      if (value.publicBaseUrl !== undefined) {
        console.warn('remote-web-ui: autoTunnel is on — ignoring the manually configured publicBaseUrl')
      }
      tunnel.start(`http://127.0.0.1:${String(ctx.webServer.port)}`)
    } else {
      tunnel.stop()
      // A malformed public base is ignored with a warning — LAN-only behavior
      // stays intact rather than silently minting unusable QR links.
      if (value.publicBaseUrl !== undefined && !isHttpUrl(value.publicBaseUrl)) {
        console.warn(`remote-web-ui: ignoring malformed publicBaseUrl ${JSON.stringify(value.publicBaseUrl)} (expected https://host[:port])`)
        service.setPublicBaseUrl(undefined)
      } else {
        service.setPublicBaseUrl(value.publicBaseUrl)
      }
    }
    // The tunnel phase listener mirrors the auto-tunnel URL; the manual base
    // (and every live edit) lands here.
    trust.reflect(service.publicBaseUrl)
    const enabled = value.enabled
    if (!enabled) service.stop()
    if (disposeRoutes === undefined && enabled) {
      disposeRoutes = ctx.effect(
        () => {
          const disposers = routes.map(route => ctx.webServer.register(route))
          return () => { for (const dispose of disposers) dispose() }
        },
        'remote-web-ui: pairing routes',
      )
    } else if (disposeRoutes !== undefined && !enabled) {
      disposeRoutes()
      disposeRoutes = undefined
    }
    if (disposeSweep === undefined && enabled) {
      disposeSweep = ctx.effect(
        () => {
          const timer = nodeSetInterval(() => { service.sweep() }, SWEEP_INTERVAL_MS)
          timer.unref()
          return () => { clearInterval(timer) }
        },
        'remote-web-ui: presence sweep',
      )
    } else if (disposeSweep !== undefined && !enabled) {
      disposeSweep()
      disposeSweep = undefined
    }
  }
  sync()

  // Push a committed settings section into the service. The service config
  // object is read per operation, so a live edit takes effect without a
  // restart (see sync). The settings service is an inject edge; the section
  // install rides this plugin's fiber and is removed with it.
  ctx.settings.installSection(ctx, REMOTE_WEB_UI_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: (source) => {
      current = source
      sync()
    },
    onChange: sync,
  })
}

/** Whether a configured public base is a parseable http(s) URL with a host. */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== ''
  } catch {
    return false
  }
}