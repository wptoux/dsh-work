/**
 * Unpaired-desktop notice: a full-page blocking surface rendered when the remote channel
 * (see remote-channel.ts) refuses a call because this desktop browser has no
 * live paired-device cookie. Retires automatically once a gated call
 * succeeds (the channel reports pairing) or when the channel itself is
 * torn down (requirePairingForLan off / plugin disabled), so it never
 * outlives the unpaired state it describes.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
/** Notice props: localized copy. */
export interface FenceNoticeProps {
    t: TranslateNS<'remote'>;
    /** Retry after the user has opened a freshly issued computer pairing link. */
    onRetry: () => void;
}
/**
 * Render the unpaired blocking page.
 * @param props - localized copy.
 * @returns the notice element.
 */
export declare function FenceNotice({ t, onRetry }: FenceNoticeProps): import("react").JSX.Element;
//# sourceMappingURL=FenceNotice.d.ts.map