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
import type { Context } from '@deepseek-ai/cordis';
/** sessionStorage key for the failed-pair notice. */
export declare const PAIR_FAILED_MARKER = "dsh-remote-pair-failed";
/**
 * The page-navigation surface the boot flow drives. Browser pages use the
 * default (window.location/history); tests inject a fake.
 */
export interface PageSurface {
    /** The current page URL (read fresh on each access). */
    href: string;
    /** Replace the URL without reloading. */
    replaceState(url: string): void;
    /** Navigate to a URL (a fresh page load). */
    navigate(url: string): void;
    /** Reload the page. */
    reload(): void;
}
/** The browser implementation of {@link PageSurface}. */
export declare const browserPage: PageSurface;
/**
 * Run the pair/workspace boot flow for this page load.
 * @param ctx - client root context (workspaces/sessions read at need time).
 * @param search - the current location.search.
 * @param page - the page surface (defaults to the browser).
 */
export declare function runPairBootFlow(ctx: Context, search: string, page?: PageSurface): void;
//# sourceMappingURL=deep-link.d.ts.map