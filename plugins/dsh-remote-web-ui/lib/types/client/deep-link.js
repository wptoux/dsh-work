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
import { acceptPair, readPairParams } from "./pair-api.js";
/** sessionStorage key for the failed-pair notice. */
export const PAIR_FAILED_MARKER = 'dsh-remote-pair-failed';
/** Poll budget for the runtime services (activation order is unconstrained). */
const SERVICE_WAIT_MS = 10_000;
/** The browser implementation of {@link PageSurface}. */
export const browserPage = {
    get href() {
        return window.location.href;
    },
    replaceState(url) {
        window.history.replaceState(null, '', url);
    },
    navigate(url) {
        window.location.assign(url);
    },
    reload() {
        window.location.reload();
    },
};
/**
 * Run the pair/workspace boot flow for this page load.
 * @param ctx - client root context (workspaces/sessions read at need time).
 * @param search - the current location.search.
 * @param page - the page surface (defaults to the browser).
 */
export function runPairBootFlow(ctx, search, page = browserPage) {
    const params = readPairParams(search);
    if (params.pair !== undefined) {
        void runAccept(params.pair, page);
        return;
    }
    if (params.workspace !== undefined) {
        void runDeepLink(ctx, params.workspace, page);
    }
}
/** Accept the token, then boot the full Web GUI with the device cookie. */
async function runAccept(token, page) {
    let ok = false;
    try {
        const result = await acceptPair(token);
        ok = result.ok;
        if (!ok)
            sessionStorage.setItem(PAIR_FAILED_MARKER, 'failed');
    }
    catch {
        sessionStorage.setItem(PAIR_FAILED_MARKER, 'failed');
    }
    // Drop the token from the URL either way: an accepted token is consumed
    // (a re-scan would 409), and a failed one must not loop.
    const url = new URL(page.href);
    url.searchParams.delete('pair');
    page.replaceState(`${url.pathname}${url.search}${url.hash}`);
    if (ok) {
        // Phones and computers both run the full Web GUI; the workspace target
        // stays in the query for runDeepLink to honor after boot.
        page.reload();
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
async function runDeepLink(ctx, workspaceId, page) {
    const target = workspaceId;
    const deadline = Date.now() + SERVICE_WAIT_MS;
    while (Date.now() < deadline) {
        const workspaces = ctx.get('workspaces');
        const sessions = ctx.get('sessions');
        if (workspaces !== undefined && sessions !== undefined) {
            const items = workspaces.list.getSnapshot().items;
            if (items.some(item => item.workspaceId === target)) {
                try {
                    // Create-or-adopt the workspace's blank session, then select it.
                    // The QR's workspace target is explicit user intent and must win.
                    const sessionId = await sessions.create({ workspaceId: target });
                    sessions.open(sessionId);
                }
                catch {
                    // Unknown workspace or a failed connect: fall through to the
                    // runtime's own default initial selection.
                }
                break;
            }
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    const url = new URL(page.href);
    url.searchParams.delete('workspace');
    page.replaceState(`${url.pathname}${url.search}${url.hash}`);
}
