/**
 * Sidebar footer-seat wrapper for the remote-control entry.
 *
 * The dsh web shell's `sidebar.footer.action` seat (beside the settings
 * trigger) supplies only the column state `{ wide }` plus the standard locale
 * seat. Pairing is workspace-agnostic: the minted QR carries no workspace
 * target (DSH 0.1.5 removed the recent-workspace projection), and the host
 * `/api/pair` routes fully support that.
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
/** Entry props: the footer seat's column state + the standard locale seat. */
export type FooterRemoteEntryProps = PropsLocale<'remote'> & {
    wide: boolean;
};
/**
 * Render the remote-control trigger + pairing panel from the footer seat.
 * @param props - composed slot props (footer seat subset).
 * @returns the entry element tree.
 */
export declare function FooterRemoteEntry(props: FooterRemoteEntryProps): import("react").JSX.Element;
//# sourceMappingURL=FooterRemoteEntry.d.ts.map