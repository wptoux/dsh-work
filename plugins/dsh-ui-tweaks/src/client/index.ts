/**
 * dsh-ui-tweaks — browser half.
 *
 * Folds completed agent turns in the main desktop conversation into an
 * expandable「已处理」block that shows only the turn's last reply, keeping the
 * chat clean (Codex-style). Pure DOM: subscribes the current session's
 * lifecycle snapshot (`ctx.sessions`) and Chat projection
 * (`ctx.uiConversation`'s `chat` target) — see `./session-source` — observes
 * the chat flow column (`[data-chat-flow]`), and translates fold plans into
 * hidden rows + clickable headers. Auto-loads older history when a closed
 * turn's head sits outside the loaded window, so page-split turns complete
 * before folding.
 *
 * Registry/dispatch surface (package.json `dsh.client`): injects the sessions
 * controller and locale services; the bundle registers with the package name
 * through window.__ModuleLoader__.
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the 0.1.5 sessions-service Context merge (ctx.sessions),
// relocated from the removed dsh-client-runtime to dsh-api-session-controller.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the Conversation-assembly Context merge (ctx.uiConversation)
// and the `chat` target snapshot contract the fold driver reads.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { createFoldChrome } from './fold-chrome'
import { createFoldDriver } from './fold-driver'
import { formatDuration } from './fold-dom'
import { createSessionSource } from './session-source'
import { mountMobileSidebar, type MobileLayoutFace } from './mobile-sidebar.tsx'
import { en, zh, type UiTweaksKey } from './locales'
import './fold.css'
import './composer-toolbar.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-ui-tweaks fold copy. */
    'ui-tweaks': UiTweaksKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'ui-tweaks'

/** Services required by this plugin. */
export const inject = ['sessions', 'locale']

/**
 * Mount the folding. The effect owns the whole lifecycle: creating the
 * chrome (DOM observation + click delegation) and the driver (session
 * snapshot → plan → DOM), wired together through a rAF-coalesced re-run, and
 * torn down on fiber disposal (HMR-safe).
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'dsh-ui-tweaks: dictionaries')

  ctx.effect(() => {
    const t = ctx.locale.bind(NS)
    // Narrow-screen drawer: phones run the full desktop GUI, so the sidebar
    // is hidden behind a top-left whale-logo trigger that expands it as an
    // overlay drawer. The toggle goes through the layout service's official
    // action; the drawer's visual state mirrors the host frame (see the
    // module doc) and the trigger/scrim stay hidden at ≥768px via CSS.
    const disposeMobile = mountMobileSidebar({
      label: t('mobile.openSidebar'),
      toggleSidebar: () => {
        const layout = ctx.get('layout') as MobileLayoutFace | undefined
        layout?.toggleSidebar()
      },
    })
    return () => { disposeMobile.dispose() }
  }, 'dsh-ui-tweaks: mobile sidebar drawer')

  ctx.effect(() => {
    const t = ctx.locale.bind(NS)
    const copy = {
      header: () => t('fold.header'),
      count: (n: number) => t('fold.count', { n }),
      duration: formatDuration,
    }
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : ((fn: FrameRequestCallback) => setTimeout(() => fn(performance.now()), 16) as unknown as number)
    let scheduled = false
    let driver: ReturnType<typeof createFoldDriver>
    const schedule = (): void => {
      if (scheduled) return
      scheduled = true
      raf(() => {
        scheduled = false
        driver.run()
      })
    }
    const chrome = createFoldChrome(schedule, turn => driver.toggle(turn))
    driver = createFoldDriver(createSessionSource(ctx), {
      containers: () => chrome.containers(),
      copy,
    })
    const offChrome = chrome.start()
    const offDriver = driver.start()
    return () => {
      offDriver()
      offChrome()
    }
  }, 'dsh-ui-tweaks: fold driver')
}