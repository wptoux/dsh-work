import type { Context } from '@deepseek-ai/cordis';
import { Config, resolveModelSyncConfig, type MirrorSpec, type ModelSyncConfig } from './config.ts';
/** Stable cordis plugin name. */
export declare const name = "model-sync";
/** Loader-level service dependencies (see module doc). */
export declare const inject: string[];
export { Config, resolveModelSyncConfig, type ModelSyncConfig, type MirrorSpec };
export declare function apply(ctx: Context, config?: ModelSyncConfig): void;
