/**
 * The mobile surface's page routes: /m canonicalizes to /m/, which serves the
 * standalone phone UI. The page and worker live in the /m/ scope so the PWA
 * can cache only its static shell; the paired-device data channel remains at
 * /m/api and is never handled by the worker.
 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
/**
 * Build the mobile page routes.
 * @returns Exact routes for the canonical page, static shell, and PWA assets.
 */
export declare function makeMobileRoutes(): WebRoute[];
//# sourceMappingURL=mobile-routes.d.ts.map