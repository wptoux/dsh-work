/**
 * dsh-ui-tweaks — browser half.
 *
 * Narrow-screen mobile handling for the desktop web GUI:
 * - `./mobile-sidebar` — on phone viewports the host's left sidebar (incl.
 *   its 56px icon rail) collapses behind a floating whale-logo trigger that
 *   opens the sidebar as an overlay drawer; the toggle goes through the
 *   layout service's official action and the drawer mirrors host state.
 * - `./composer-toolbar.css` — keeps the composer's bottom toolbar row on
 *   one line within 767px viewports (the host row wraps at 320px widths).
 *
 * The completed-turn「已处理」fold shipped in 0.1.0 was removed: DSH 0.1.5's
 * native "Conversation display › compact" (default) folds completed-turn
 * process content at the render layer, and the two implementations targeted
 * the same rows. See the removal commit (fold-* modules deleted).
 *
 * Registry/dispatch surface (package.json `dsh.client`): injects the locale
 * service; the bundle registers with the package name through
 * window.__ModuleLoader__.
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { mountMobileSidebar, type MobileLayoutFace } from './mobile-sidebar.tsx'
import { en, zh, type UiTweaksKey } from './locales'
import './composer-toolbar.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-ui-tweaks mobile drawer copy. */
    'ui-tweaks': UiTweaksKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'ui-tweaks'

/** Services required by this plugin. */
export const inject = ['locale']

/**
 * Mount the mobile tweaks. Each effect owns its whole lifecycle and is torn
 * down on fiber disposal (HMR-safe).
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
}