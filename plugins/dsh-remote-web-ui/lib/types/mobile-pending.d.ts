import type { MuxFrame } from '@deepseek-ai/dsh-host-apiproxy/api/events';
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc';
export interface PendingApproval {
    rpcId: string;
    approvalId: string;
    toolName: string;
    callId?: string;
    reason?: string;
}
export interface PendingQuestion {
    rpcId: string;
    questions: Array<{
        id: string;
        question: string;
        detail?: string;
        header?: string;
        options?: Array<{
            label: string;
            description?: string;
        }>;
        multiSelect?: boolean;
    }>;
}
export interface PendingState {
    approvals: PendingApproval[];
    questions: PendingQuestion[];
}
export declare class PendingTracker {
    private readonly sessions;
    /** Process one mux frame and update the pending state. */
    onFrame(frame: RpcRequest<MuxFrame>): void;
    private _getOrInit;
    /** Query pending items for a session. */
    pending(sessionId: string): PendingState;
    /** Clear all pending state for a session. */
    clear(sessionId: string): void;
}
//# sourceMappingURL=mobile-pending.d.ts.map