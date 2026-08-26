export class PendingTracker {
    sessions = new Map();
    /** Process one mux frame and update the pending state. */
    onFrame(frame) {
        const payload = frame.payload;
        if (payload.type === 'approval/requested') {
            const state = this._getOrInit(payload.sessionId);
            state.approvals.set(payload.approvalId, {
                rpcId: frame.rpcId,
                approvalId: payload.approvalId,
                toolName: payload.toolName,
                callId: payload.callId,
                reason: payload.reason,
            });
        }
        else if (payload.type === 'approval/resolved') {
            const state = this.sessions.get(payload.sessionId);
            if (state) {
                state.approvals.delete(payload.approvalId);
            }
        }
        else if (payload.type === 'question/requested') {
            const state = this._getOrInit(payload.sessionId);
            state.questions.push({
                rpcId: frame.rpcId,
                questions: payload.questions,
            });
        }
        else if (payload.type === 'question/resolved') {
            const state = this.sessions.get(payload.sessionId);
            if (state) {
                state.questions = state.questions.filter(q => q.rpcId !== payload.questionRpcId);
            }
        }
    }
    _getOrInit(sessionId) {
        let state = this.sessions.get(sessionId);
        if (!state) {
            state = { approvals: new Map(), questions: [] };
            this.sessions.set(sessionId, state);
        }
        return state;
    }
    /** Query pending items for a session. */
    pending(sessionId) {
        const state = this.sessions.get(sessionId);
        if (!state) {
            return { approvals: [], questions: [] };
        }
        return {
            approvals: Array.from(state.approvals.values()),
            questions: state.questions,
        };
    }
    /** Clear all pending state for a session. */
    clear(sessionId) {
        this.sessions.delete(sessionId);
    }
}
