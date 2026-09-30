/**
 * The remote-control settings card: pairing security and device limits.
 * Registers into the Plugins page's `plugins.item` seat under the
 * `remote-web-ui` settings namespace (the Host entry id): the page renders
 * the summary one-liner on the card and this form on the plugin's own page.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store';
import { type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts';
/** The remote-control fields this card edits (the namespace's full schema). */
export interface RemoteSettings {
    /** Master switch for the plugin. */
    enabled?: boolean;
    /** Token lifetime in ms; the QR link dies after this. */
    tokenTtlMs?: number;
    /** A device is "online" while its lastSeenAt is newer than this (ms). */
    offlineAfterMs?: number;
    /** Hard cap on paired device sessions (oldest evicted when full). */
    maxDevices?: number;
    /** Idle sessions older than this (ms) are deleted. */
    idleExpireMs?: number;
    /** Cookie name carrying the paired device id. */
    cookieName?: string;
    /** Public (tunneled) base URL the QR link is built from when set. */
    publicBaseUrl?: string;
    /** When on, the plugin runs its own Cloudflare quick tunnel automatically. */
    autoTunnel?: boolean;
}
/** What the remote-control card renders. */
export interface RemoteSettingsCardState extends CardShell {
    /** Master switch. */
    enabled: CardFieldState;
    /** Token lifetime. */
    tokenTtlMs: CardFieldState;
    /** Device offline threshold. */
    offlineAfterMs: CardFieldState;
    /** Paired-device cap. */
    maxDevices: CardFieldState;
    /** Idle-expiry window. */
    idleExpireMs: CardFieldState;
    /** Device cookie name. */
    cookieName: CardFieldState;
    /** Public (tunneled) base URL. */
    publicBaseUrl: CardFieldState;
    /** Auto public tunnel switch. */
    autoTunnel: CardFieldState;
}
/** The registration-side face the card's slot entry injects. */
export interface RemoteSettingsCardFace extends CardActions {
    /** Card snapshot bound by the renderer as a reactive source. */
    store: SnapshotStore<RemoteSettingsCardState>;
}
/** Bridges the `remote-web-ui` config form onto the card's staged form. */
export declare class RemoteSettingsCardController {
    private readonly form;
    private readonly store;
    /** @param scope - the bound config form for the `remote-web-ui` namespace. */
    constructor(scope: ConfigForm<RemoteSettings>);
    private projection;
    /**
     * Build the face the card's slot registration injects.
     * @returns the card's snapshot and its form actions.
     */
    inject(): RemoteSettingsCardFace;
    /**
     * Release the card's scope subscription and bound stores; the slot
     * disposer calls this on teardown.
     */
    dispose(): void;
}
/** Props the renderer binds for the remote-control card. */
export type RemoteSettingsCardProps = PropsRuntime<'plugins.item'> & PropsLocale<'remote'> & InjectFace<RemoteSettingsCardFace>;
/**
 * Render the remote-control card: the page's one-liner in the summary view,
 * the settings form in the page view.
 * @param props - the view asked for, locale copy, the card snapshot, and its form actions.
 * @returns the one-liner, or the card.
 */
export declare function RemoteSettingsCard(props: RemoteSettingsCardProps): string | import("react").JSX.Element;
//# sourceMappingURL=RemoteSettingsCard.d.ts.map