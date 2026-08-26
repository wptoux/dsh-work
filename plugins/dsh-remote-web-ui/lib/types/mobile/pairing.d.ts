/** Pairing helpers owned by the standalone /m mobile surface. */
export type PairFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export interface MobilePairInput {
    token: string;
    workspaceId?: string;
}
export type MobilePairAccept = {
    ok: true;
} | {
    ok: false;
    message: string;
};
export type MobilePairBootstrap = {
    kind: 'none';
} | {
    kind: 'accepted';
    path: string;
} | {
    kind: 'failed';
    path: string;
    message: string;
};
/** Parse a pairing token or a copied pairing link without following its origin. */
export declare function parseMobilePairInput(value: string): MobilePairInput | undefined;
/** Build the safe, token-free mobile destination after successful pairing. */
export declare function mobilePairPath(workspaceId?: string): string;
/** Accept one pairing token on this exact browser or installed-web-app context. */
export declare function acceptMobilePair(token: string, fetcher?: PairFetch): Promise<MobilePairAccept>;
/** Consume a QR pairing token before the mobile application starts making RPC calls. */
export declare function consumeMobilePairUrl(href: string, fetcher?: PairFetch): Promise<MobilePairBootstrap>;
//# sourceMappingURL=pairing.d.ts.map