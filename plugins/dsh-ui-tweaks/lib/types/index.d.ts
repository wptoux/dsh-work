/**
 * dsh-ui-tweaks — host half.
 *
 * All UI tweaks live in the browser half (`./client`); this host half exists
 * to mount the package into the web profile bundle stack (see
 * cordis.patch.yml) so the client bundle is discovered and served.
 */
import type { Context } from '@deepseek-ai/cordis';
/** Stable cordis plugin name. */
export declare const name = "ui-tweaks";
/**
 * Mount the host face. Deliberately a no-op: the plugin carries no host-side
 * routes or services; future web-shell tweaks that need host support would
 * extend this apply.
 */
export declare function apply(_ctx: Context): void;
//# sourceMappingURL=index.d.ts.map