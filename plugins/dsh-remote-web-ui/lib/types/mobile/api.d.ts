/**
 * Mobile-surface business API: the handful of host RPC methods the
 * simplified surface needs. Types come from the harness apiproxy contract
 * (type-only imports; the wire schemas stay in the bundle only through the
 * rpc/mux layers).
 */
import type { WorkspaceView } from '@deepseek-ai/dsh-host-apiproxy/api/workspace';
import type { AgentPresetEntry } from '@deepseek-ai/dsh-host-apiproxy/api/agent-presets';
import type { SessionSummary, SessionModels, SessionProjectionsBlock } from '@deepseek-ai/dsh-host-apiproxy/api/sessions';
/** One session.list page. */
export interface SessionPage {
    items: SessionSummary[];
    /** Continuation cursor; undefined once the tail is reached. */
    nextCursor?: string;
    hasMore: boolean;
}
/** The session.create result (the id is the commit the caller navigates to). */
export interface CreatedSession {
    sessionId: string;
    /** The composition the new session runs (echoed so the caller can label it). */
    agentPreset?: string;
}
/** Agent presets available when composing a new session. */
export interface AgentPresetRoster {
    presets: readonly AgentPresetEntry[];
    authorable: boolean;
    hasDocument: boolean;
}
/** One history page (already bounded to whole messages by the host). */
export interface HistoryPage {
    events: import('@deepseek-ai/dsh-host-apiproxy/api/sessions').HistoryEntry[];
    hasMore: boolean;
    /**
     * Projection baseline riding the tail page (permissions select etc.);
     * absent when the deployment mounts no projection registry.
     */
    projections?: SessionProjectionsBlock;
}
/** Read-only display preferences the plugin answers locally on `/m/api`. */
export interface MobilePreferences {
    /** Plain Enter sends the drafted prompt (false: Enter inserts a newline). */
    mobileEnterToSend: boolean;
}
/** The workspace roster (session ids come back per workspace). */
export declare function listWorkspaces(): Promise<WorkspaceView[]>;
/** Read-only mobile display preferences (answered by the plugin, not the host proxy). */
export declare function fetchMobilePreferences(): Promise<MobilePreferences>;
/** One session.list page; omit the cursor for the first page. */
export declare function listSessions(cursor?: string): Promise<SessionPage>;
/** Read the available agent compositions for a new session. */
export declare function listAgentPresets(): Promise<AgentPresetRoster>;
/**
 * Create a blank session (entity birth precedes the first message). Name a
 * workspace to attach it there, or a cwd; omitting both uses the host cwd.
 */
export declare function createSession(options?: {
    workspaceId?: string;
    cwd?: string;
    agentPreset?: string;
}): Promise<CreatedSession>;
/** One history window; omit beforeSeq for the tail page, pass a signal to abort. */
export declare function history(sessionId: string, beforeSeq?: number, maxMessages?: number, signal?: AbortSignal): Promise<HistoryPage>;
/** Send one text prompt (queued: the agent picks it up in order). */
export declare function prompt(sessionId: string, text: string): Promise<void>;
/** Send one slash command line (e.g. `/permission workspace-write`). */
export declare function sendCommand(sessionId: string, line: string): Promise<unknown>;
/** Fresh advisory model directory for one session (current + groups + failures). */
export declare function models(sessionId: string): Promise<SessionModels>;
/** Select the complete model selection (provider/model/reasoning effort) for a session. */
export declare function selectModel(sessionId: string, selection: {
    provider: string;
    model: string;
    reasoningEffort?: string;
}): Promise<{
    selected: {
        provider: string;
        model: string;
        reasoningEffort?: string;
    };
}>;
/** One pending tool approval awaiting the user's decision. */
export interface PendingApproval {
    approvalId: string;
    toolName: string;
    callId?: string;
    reason?: string;
}
/** One pending question group awaiting the user's answer. */
export interface PendingQuestionItem {
    id: string;
    question: string;
    detail?: string;
    header?: string;
    options?: Array<{
        label: string;
        description?: string;
    }>;
    multiSelect?: boolean;
}
/** The pending state for one session. */
export interface PendingState {
    approvals: PendingApproval[];
    questions: PendingQuestionItem[];
}
/** Fetch pending approvals and questions for one session (polling fallback data source). */
export declare function fetchPending(sessionId: string): Promise<PendingState>;
/** Submit an approval decision (allowed-once or rejected). */
export declare function respondApproval(sessionId: string, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void>;
/** Submit answers to a question group. */
export declare function respondQuestion(sessionId: string, answers: Array<{
    id: string;
    selected: string[];
    custom?: string;
}>): Promise<void>;
/** One entry in a directory listing. */
export interface DirectoryEntry {
    name: string;
    path: string;
    hidden: boolean;
}
/** The host directory listing result (one level, with ancestor breadcrumbs). */
export interface DirectoryListing {
    path: string;
    home: string;
    crumbs: DirectoryEntry[];
    entries: DirectoryEntry[];
    truncated: boolean;
}
/** The result of creating a workspace from an existing directory. */
export interface WorkspaceCreateResult {
    workspace: WorkspaceView;
    created: boolean;
}
/** Browse one directory level on the host (defaults to home directory). */
export declare function listDirectory(path?: string): Promise<DirectoryListing>;
/** Create a workspace from an existing host directory (does not mkdir). */
export declare function createWorkspace(path: string): Promise<WorkspaceCreateResult>;
//# sourceMappingURL=api.d.ts.map