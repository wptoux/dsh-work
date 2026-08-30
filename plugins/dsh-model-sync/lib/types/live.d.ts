/**
 * Optional live `/models` probe. Deliberately signal-only: the reply is
 * logged, never fed into the mirror list (the npm catalog carries capacities
 * and reasoning metadata the listing endpoint does not disclose). Never
 * throws — failures are reported to the caller for logging.
 * @module dsh-model-sync/live
 */
/** Resolve a llm-pi-ai `apiKeyEnv` credential reference in the environment. */
export declare function resolveEnvKey(apiKeyEnv: string | undefined): string | undefined;
/** Join an endpoint base with the OpenAI-compatible listing path. */
export declare function buildLiveUrl(baseURL: string): string;
/** Parse an OpenAI-compatible `/models` listing body into model ids. */
export declare function parseLiveListing(raw: unknown): string[] | undefined;
export type LiveProbeResult = {
    ok: true;
    ids: string[];
} | {
    ok: false;
    reason: string;
};
export interface LiveProbeOptions {
    baseURL: string;
    apiKey?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
}
/** Probe one provider's live listing; never throws. */
export declare function probeLiveModels(opts: LiveProbeOptions): Promise<LiveProbeResult>;
