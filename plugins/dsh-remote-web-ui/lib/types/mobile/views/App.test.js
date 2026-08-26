import { jsx as _jsx } from "react/jsx-runtime";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { RpcTransportError } from "../rpc.js";
const api = vi.hoisted(() => ({
    fetchMobilePreferences: vi.fn(),
    history: vi.fn(),
    listSessions: vi.fn(),
    listWorkspaces: vi.fn(),
    prompt: vi.fn(),
}));
vi.mock('../api.ts', () => api);
vi.mock('../mux.ts', () => ({
    MuxClient: class {
        start() { }
        stop() { }
        observe() { }
    },
}));
vi.mock('./WorkspaceView.tsx', () => ({ WorkspaceView: () => _jsx("div", { children: "workspace-ready" }) }));
vi.mock('./SessionListView.tsx', () => ({ SessionListView: () => _jsx("div", { children: "sessions-ready" }) }));
vi.mock('./ChatView.tsx', () => ({ ChatView: () => _jsx("div", { children: "chat-ready" }) }));
import { App, mobilePairStateForError } from "./App.js";
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
describe('mobile paired-device gate', () => {
    it('distinguishes a missing paired cookie from a transport outage', () => {
        expect(mobilePairStateForError(new RpcTransportError('HTTP 403'))).toBe('unpaired');
        expect(mobilePairStateForError(new RpcTransportError('HTTP 503'))).toBe('unavailable');
        expect(mobilePairStateForError(new Error('offline'))).toBe('unavailable');
    });
    it('keeps a valid paired context usable after a failed QR token', async () => {
        api.fetchMobilePreferences.mockResolvedValue({ mobileEnterToSend: true });
        render(_jsx(App, { initialPairError: "\u914D\u5BF9\u94FE\u63A5\u5DF2\u88AB\u4F7F\u7528\u3002" }));
        await waitFor(() => expect(screen.getByText('workspace-ready')).toBeDefined());
        expect(screen.queryByRole('alert')).toBeNull();
    });
    it('shows the pairing screen only when the mobile gateway rejects the device', async () => {
        api.fetchMobilePreferences.mockRejectedValue(new RpcTransportError('HTTP 403'));
        render(_jsx(App, { initialPairError: "\u914D\u5BF9\u94FE\u63A5\u5DF2\u88AB\u4F7F\u7528\u3002" }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('配对链接已被使用。'));
    });
    it('shows a retryable connection failure rather than mounting remote views on outage', async () => {
        api.fetchMobilePreferences.mockRejectedValue(new RpcTransportError('HTTP 503'));
        render(_jsx(App, {}));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('无法连接到运行中的 DSH host。'));
        expect(screen.queryByText('workspace-ready')).toBeNull();
    });
});
