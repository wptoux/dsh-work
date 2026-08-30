import type { Context } from '@deepseek-ai/cordis';
import { Config, resolveModelSyncConfig, type MirrorSpec, type ModelSyncConfig } from './config.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        baseDir: string;
        setInterval(callback: () => void, delay: number): () => void;
    }
}
/** Stable cordis plugin name. */
export declare const name = "model-sync";
export { Config, resolveModelSyncConfig, type ModelSyncConfig, type MirrorSpec };
export declare function apply(ctx: Context, config?: ModelSyncConfig): void;
