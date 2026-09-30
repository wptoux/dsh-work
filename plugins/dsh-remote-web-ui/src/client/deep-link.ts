/**
 * Pairing boot flow: the `pair` + `workspace` query parameters. Runs from
 * the client apply on every page load, on any device:
 * - `pair` present → accept the token, then reload so the whole SPA boots
 *   with the device cookie (the accept endpoint is exempt from the pairing
 *   gate; every other /api request needs the cookie). This is the
 *   direct-link path for browsers that already hold the harness's browser
 *   cookie; the QR bootstrap on a fresh device runs server-side instead —
 *   `/api/pair/open` consumes the token, sets the device cookie, and
 *   redirects through the native launch-token exchange, so the SPA boots
 *   with no query parameters at all.
 * - `workspace` present (and paired) → deep-link: connect that workspace's
 *   session and open it, then strip the parameter.
 * Failure of accept leaves a sessionStorage marker the entry renders as a
 * one-time notice.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: the ui-workspace Context merge (ctx.uiWorkspace). DSH 0.2.0 moved
// Session navigation off ISessions onto the workspace view service.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { acceptPair, readPairParams } from './pair-api.ts'

/** sessionStorage key for the failed-pair notice. */
export const PAIR_FAILED_MARKER = 'dsh-remote-pair-failed'

/** Poll budget for the runtime services (activation order is unconstrained). */
const SERVICE_WAIT_MS = 10_000

/**
 * The page-navigation surface the boot flow drives. Browser pages use the
 * default (window.location/history); tests inject a fake.
 */
export interface PageSurface {
  /** The current page URL (read fresh on each access). */
  href: string
  /** Replace the URL without reloading. */
  replaceState(url: string): void
  /** Navigate to a URL (a fresh page load). */
  navigate(url: string): void
  /** Reload the page. */
  reload(): void
}

/** The browser implementation of {@link PageSurface}. */
export const browserPage: PageSurface = {
  get href(): string {
    return window.location.href
  },
  replaceState(url: string): void {
    window.history.replaceState(null, '', url)
  },
  navigate(url: string): void {
    window.location.assign(url)
  },
  reload(): void {
    window.location.reload()
  },
}

/**
 * Run the pair/workspace boot flow for this page load.
 * @param ctx - client root context (workspaces/sessions read at need time).
 * @param search - the current location.search.
 * @param page - the page surface (defaults to the browser).
 */
export function runPairBootFlow(ctx: Context, search: string, page: PageSurface = browserPage): void {
  const params = readPairParams(search)
  if (params.pair !== undefined) {
    void runAccept(params.pair, page)
    return
  }
  if (params.workspace !== undefined) {
    void runDeepLink(ctx, params.workspace, page)
  }
}

/** Accept the token, then boot the full Web GUI with the device cookie. */
async function runAccept(token: string, page: PageSurface): Promise<void> {
  let ok = false
  try {
    const result = await acceptPair(token)
    ok = result.ok
    if (!ok) sessionStorage.setItem(PAIR_FAILED_MARKER, 'failed')
  } catch {
    sessionStorage.setItem(PAIR_FAILED_MARKER, 'failed')
  }
  // Drop the token from the URL either way: an accepted token is consumed
  // (a re-scan would 409), and a failed one must not loop.
  const url = new URL(page.href)
  url.searchParams.delete('pair')
  page.replaceState(`${url.pathname}${url.search}${url.hash}`)
  if (ok) {
    // Phones and computers both run the full Web GUI; the workspace target
    // stays in the query for runDeepLink to honor after boot.
    page.reload()
  }
}

/**
 * Deep-link the target workspace and open its session. Waits for the
 * runtime services AND for the target workspace to appear in the workspace
 * list (both are asynchronous after boot), then creates-or-adopts the
 * workspace's blank session and selects it; gives up silently within the
 * budget — the workspace param is stripped either way, so a late failure
 * cannot loop.
 * @param ctx - client root context.
 * @param workspaceId - the target workspace.
 * @param page - the page surface.
 */
async function runDeepLink(ctx: Context, workspaceId: string, page: PageSurface): Promise<void> {
  const target = workspaceId as WorkspaceId
  const deadline = Date.now() + SERVICE_WAIT_MS
  while (Date.now() < deadline) {
    const workspaces = ctx.get('workspaces') as IWorkspaces | undefined
    const sessions = ctx.get('sessions') as ISessions | undefined
    const uiWorkspace = ctx.get('uiWorkspace') as UiWorkspace | undefined
    if (workspaces !== undefined && sessions !== undefined && uiWorkspace !== undefined) {
      const items = workspaces.list.getSnapshot().items
      if (items.some(item => item.workspaceId === target)) {
        try {
          // Create-or-adopt the workspace's blank session, then select it.
          // The QR's workspace target is explicit user intent and must win.
          const sessionId = await sessions.create({ workspaceId: target })
          uiWorkspace.openSession(sessionId)
        } catch {
          // Unknown workspace or a failed connect: fall through to the
          // runtime's own default initial selection.
        }
        break
      }
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  const url = new URL(page.href)
  url.searchParams.delete('workspace')
  page.replaceState(`${url.pathname}${url.search}${url.hash}`)
}
