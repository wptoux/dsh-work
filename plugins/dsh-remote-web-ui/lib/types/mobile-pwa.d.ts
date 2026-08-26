/** PWA registration for the standalone /m mobile surface. */
export declare const MOBILE_PWA_SCOPE = "/m/";
export declare const MOBILE_SERVICE_WORKER_URL = "/m/service-worker.js";
/** Register the mobile shell worker when the current browser supports it. */
export declare function registerMobilePwa(serviceWorker?: Pick<ServiceWorkerContainer, 'register'> | undefined): Promise<void>;
//# sourceMappingURL=mobile-pwa.d.ts.map