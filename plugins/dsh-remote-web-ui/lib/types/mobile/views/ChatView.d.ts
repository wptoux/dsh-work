/**
 * Chat level: one session. Loads the history tail page on open, appends
 * pages upward (loadOlder), folds live mux frames in as they arrive, and
 * sends prompts through session.prompt.
 *
 * Rendering mirrors the desktop web UI's fold discipline on a small screen:
 * - reasoning text hides behind a collapsed "深度思考" disclosure,
 * - tool calls behind a collapsed tool disclosure (name + arguments),
 * - very long assistant text collapses with an explicit expand toggle,
 * - a toolbar above the composer carries the model (+ thinking effort) and
 *   permission pickers, both as bottom sheets.
 */
import { type SessionView } from './App.tsx';
import { MuxClient } from '../mux.ts';
/** Props for the chat view. */
export interface ChatViewProps {
    session: SessionView;
    /** The page-lifetime mux client (undefined before the first effect tick). */
    mux?: MuxClient | undefined;
    onBack(): void;
}
/**
 * Hard cap on live events buffered while the initial history tail page is in
 * flight. Beyond this the oldest buffered event is dropped and a follow-up
 * history tail re-pull closes the seam.
 */
export declare const MAX_TAIL_BUFFER_EVENTS = 500;
/**
 * Extra pages a boundary fetch may pull to reach a complete turn. The host
 * pages history by message count (boundaries can cut mid-turn), so a fetch
 * keeps going older until the range's oldest edge starts a turn — or runs
 * into this cap (or the host's own tail).
 */
export declare const MAX_BOUNDARY_FETCH_PAGES = 4;
/** One switchable permission preset (the `permissions` projection shape). */
export interface PermissionOption {
    value: string;
    name: string;
    description?: string;
}
/** The `permissions` projection value: options + the effective current value. */
export interface PermissionSelectValue {
    options: PermissionOption[];
    currentValue: string;
}
/**
 * Render one session's chat.
 * @param props - the session, the mux client, and the back action.
 * @returns the chat surface.
 */
export declare function ChatView({ session, mux, onBack }: ChatViewProps): import("react").JSX.Element;
/**
 * Minimum interval between full markdown re-parses of a live (pending)
 * assistant message. Every streamed chunk replaces the message object, and
 * re-parsing the whole accumulated text per chunk turns a long reply into
 * O(n^2) work on mobile. Pending text keeps the last parsed result visible
 * and re-parses at most once per interval; the moment the turn closes the
 * final text parses immediately, so terminal messages render exactly as
 * before.
 */
export declare const STREAM_RENDER_INTERVAL_MS = 120;
//# sourceMappingURL=ChatView.d.ts.map