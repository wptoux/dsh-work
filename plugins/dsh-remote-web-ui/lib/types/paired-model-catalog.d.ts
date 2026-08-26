import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api';
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import type { PairingService } from './pairing.ts';
export declare const PAIRED_MODEL_CATALOG_PATHS: {
    readonly catalog: "/api/pair/model-catalog";
    readonly discover: "/api/pair/model-catalog/discover";
    readonly upsert: "/api/pair/model-catalog/upsert";
};
export interface PairedModelCatalogDeps {
    service: PairingService;
    apiProxy: ApiProxy;
    /** The LAN IP literals the host fence accepts, mirroring the /api/pair fence. */
    lanAddresses: readonly string[];
}
/** Build the narrow paired-device model catalog routes. */
export declare function makePairedModelCatalogRoutes(deps: PairedModelCatalogDeps): WebRoute[];
//# sourceMappingURL=paired-model-catalog.d.ts.map