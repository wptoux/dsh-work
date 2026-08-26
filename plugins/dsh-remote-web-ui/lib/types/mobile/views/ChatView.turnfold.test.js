import { jsx as _jsx } from "react/jsx-runtime";
// @vitest-environment jsdom
/**
 * ChatView completed-turn fold: once a turn ends (turn/end), every
 * assistant message of that turn collapses behind a 已处理 header and
 * only the last reply stays visible; tapping the header expands the full
 * turn. Turns that are still running stream unfolded, and failed turns
 * fold too (the failure tag rides the visible last reply).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatView } from "./ChatView.js";
vi.mock('../api.ts', () => ({
    fetchMobilePreferences: vi.fn(),
    models: vi.fn(),
    selectModel: vi.fn(),
    sendCommand: vi.fn(),
}));
vi.mock('./App.tsx', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        loadHistory: vi.fn(),
        prompt: vi.fn(async () => { }),
    };
});
import { fetchMobilePreferences, models } from "../api.js";
import { loadHistory } from "./App.js";
const loadHistoryMock = vi.mocked(loadHistory);
const fetchMobilePreferencesMock = vi.mocked(fetchMobilePreferences);
const modelsMock = vi.mocked(models);
const session = {
    sessionId: 's-1',
    title: '测试会话',
    updatedAt: 1_700_000_000_000,
    running: false,
    blank: false,
};
/** Assemble one history entry wrapping a WireEvent (host history-page shape). */
function makeEntry(type, data, seq) {
    return { event: { type, seq, time: seq * 1_000, data } };
}
/** Build a history page from loose wire events (the host union is strict). */
function historyPage(events, extra = {}) {
    return { events: events, hasMore: false, ...extra };
}
/** Minimal mux stand-in: captures the ChatView's frame listener for hand-off. */
class FakeMux {
    listeners = new Set();
    onFrame(listener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    emit(frame) {
        for (const listener of this.listeners)
            listener(frame);
    }
}
/** A completed turn: user prompt, an intermediate step with a tool call, then the final reply. */
function completedTurn() {
    return [
        makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '帮我修改代码' }] }, 0),
        makeEntry('assistant/message', {
            turn: 0,
            step: 0,
            message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '我先查看文件结构' }] },
        }, 1),
        makeEntry('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' }, 2),
        makeEntry('assistant/message', {
            turn: 0,
            step: 1,
            message: { id: 'a-2', role: 'assistant', content: [{ type: 'text', text: '已完成修改' }] },
        }, 3),
        makeEntry('turn/end', { turn: 0, reason: { kind: 'success' } }, 4),
    ];
}
beforeEach(() => {
    fetchMobilePreferencesMock.mockResolvedValue({ mobileEnterToSend: true });
    modelsMock.mockResolvedValue({
        current: { provider: 'fx', model: 'fx-1' },
        routable: true,
        groups: [],
        failures: [],
    });
});
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
});
describe('ChatView completed-turn fold', () => {
    it('folds a completed turn behind 已处理 and shows only the last reply', async () => {
        loadHistoryMock.mockResolvedValue(historyPage(completedTurn()));
        render(_jsx(ChatView, { session: session, onBack: () => { } }));
        await screen.findByText('帮我修改代码');
        // The turn ended: a 已处理 header exists, the final reply is visible,
        // and the intermediate message with its tool call is folded away.
        expect(screen.getByRole('button', { name: /已处理/ })).toBeTruthy();
        expect(screen.getByText('已完成修改')).toBeTruthy();
        expect(screen.queryByText('我先查看文件结构')).toBeNull();
        expect(screen.queryByRole('button', { name: /工具/ })).toBeNull();
    });
    it('expands the 已处理 block to reveal every message of the turn', async () => {
        loadHistoryMock.mockResolvedValue(historyPage(completedTurn()));
        render(_jsx(ChatView, { session: session, onBack: () => { } }));
        await screen.findByText('已完成修改');
        const head = screen.getByRole('button', { name: /已处理/ });
        expect(head.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(head);
        expect(head.getAttribute('aria-expanded')).toBe('true');
        expect(await screen.findByText('我先查看文件结构')).toBeTruthy();
        expect(screen.getByRole('button', { name: /工具/ })).toBeTruthy();
        expect(screen.getByText('已完成修改')).toBeTruthy();
    });
    it('folds a single-reply completed turn too (the example shape)', async () => {
        loadHistoryMock.mockResolvedValue(historyPage([
            makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '帮我修改xxxx' }] }, 0),
            makeEntry('assistant/message', {
                turn: 0,
                step: 0,
                message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '已完成修改' }] },
            }, 1),
            makeEntry('turn/end', { turn: 0, reason: { kind: 'success' } }, 2),
        ]));
        render(_jsx(ChatView, { session: session, onBack: () => { } }));
        await screen.findByText('帮我修改xxxx');
        expect(screen.getByRole('button', { name: /已处理/ })).toBeTruthy();
        expect(screen.getByText('已完成修改')).toBeTruthy();
    });
    it('keeps a running turn unfolded until turn/end arrives, then folds it', async () => {
        loadHistoryMock.mockResolvedValue(historyPage([
            makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '改一下' }] }, 0),
            makeEntry('assistant/message', {
                turn: 0,
                step: 0,
                message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '第一步' }] },
            }, 1),
            makeEntry('assistant/message', {
                turn: 0,
                step: 1,
                message: { id: 'a-2', role: 'assistant', content: [{ type: 'text', text: '最终回复' }] },
            }, 2),
        ]));
        const mux = new FakeMux();
        render(_jsx(ChatView, { session: session, mux: mux, onBack: () => { } }));
        // No turn/end yet: every message streams unfolded, no 已处理 header.
        await screen.findByText('第一步');
        expect(screen.getByText('最终回复')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /已处理/ })).toBeNull();
        // The turn closes: the two messages fold behind 已处理, only the last shows.
        await act(async () => {
            mux.emit({ type: 'session/event', sessionId: 's-1', event: makeEntry('turn/end', { turn: 0, reason: { kind: 'success' } }, 3).event });
        });
        expect(await screen.findByRole('button', { name: /已处理/ })).toBeTruthy();
        expect(screen.getByText('最终回复')).toBeTruthy();
        expect(screen.queryByText('第一步')).toBeNull();
    });
    it('folds a failed turn too and keeps the failure tag on the visible reply', async () => {
        loadHistoryMock.mockResolvedValue(historyPage([
            makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '改一下' }] }, 0),
            makeEntry('assistant/message', {
                turn: 0,
                step: 0,
                message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '抱歉，执行出错了' }] },
            }, 1),
            makeEntry('turn/end', { turn: 0, reason: { kind: 'error', message: 'boom' } }, 2),
        ]));
        render(_jsx(ChatView, { session: session, onBack: () => { } }));
        await screen.findByText('抱歉，执行出错了');
        expect(screen.getByRole('button', { name: /已处理/ })).toBeTruthy();
        expect(screen.getByText('本次回复失败')).toBeTruthy();
    });
    it('renders a long newest reply inside the fold expanded (no 展开全文 toggle)', async () => {
        const longText = '长'.repeat(1800);
        loadHistoryMock.mockResolvedValue(historyPage([
            makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '写长文' }] }, 0),
            makeEntry('assistant/message', {
                turn: 0,
                step: 0,
                message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '第一段' }] },
            }, 1),
            makeEntry('assistant/message', {
                turn: 0,
                step: 1,
                message: { id: 'a-2', role: 'assistant', content: [{ type: 'text', text: longText }] },
            }, 2),
            makeEntry('turn/end', { turn: 0, reason: { kind: 'success' } }, 3),
        ]));
        render(_jsx(ChatView, { session: session, onBack: () => { } }));
        await screen.findByRole('button', { name: /已处理/ });
        // The final reply is still the newest session message: no long-text fold.
        expect(screen.queryByRole('button', { name: /展开全文/ })).toBeNull();
    });
});
describe('ChatView completed-turn loading and grouping', () => {
    it('pulls older pages until the oldest edge reaches a turn boundary', async () => {
        // The first (tail) page is cut mid-turn: its head lives on an older page.
        loadHistoryMock
            .mockResolvedValueOnce(historyPage([
            makeEntry('assistant/message', { turn: 0, step: 2, message: { id: 'a-3', role: 'assistant', content: [{ type: 'text', text: '第三步' }] } }, 3),
            makeEntry('assistant/message', { turn: 0, step: 3, message: { id: 'a-4', role: 'assistant', content: [{ type: 'text', text: '最后回复' }] } }, 4),
            makeEntry('turn/end', { turn: 0, reason: { kind: 'success' } }, 5),
        ], { hasMore: true }))
            .mockResolvedValueOnce(historyPage([
            makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '改一下' }] }, 0),
            makeEntry('turn/start', { turn: 0 }, 1),
            makeEntry('assistant/message', { turn: 0, step: 0, message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '第一步' }] } }, 2),
        ]));
        render(_jsx(ChatView, { session: session, onBack: () => { } }));
        // The split turn folds as ONE complete 已处理 block (3 members).
        const head = await screen.findByRole('button', { name: /已处理/ });
        expect(head.textContent).toContain('3 条');
        expect(screen.getByText('最后回复')).toBeTruthy();
        expect(screen.queryByText('第一步')).toBeNull();
        expect(loadHistoryMock).toHaveBeenCalledTimes(2);
    });
    it('folds all members of a completed turn even with an injected row between them', async () => {
        loadHistoryMock.mockResolvedValue(historyPage([
            makeEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '改一下' }] }, 0),
            makeEntry('assistant/message', { turn: 0, step: 0, message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '中间一' }] } }, 1),
            makeEntry('user/message', { id: 'i-1', role: 'user', content: [{ type: 'text', text: '系统注入' }], source: { kind: 'plugin', name: 'react-extension' } }, 2),
            makeEntry('assistant/message', { turn: 0, step: 1, message: { id: 'a-2', role: 'assistant', content: [{ type: 'text', text: '最后回复' }] } }, 3),
            makeEntry('turn/end', { turn: 0, reason: { kind: 'success' } }, 4),
        ]));
        render(_jsx(ChatView, { session: session, onBack: () => { } }));
        const head = await screen.findByRole('button', { name: /已处理/ });
        expect(head.textContent).toContain('2 条');
        expect(screen.getByText('最后回复')).toBeTruthy();
        // Both turn members are inside the fold; the injected row is its own
        // system-message row (hidden by default), not folded into the turn.
        expect(screen.queryByText('中间一')).toBeNull();
        expect(screen.queryByText('系统注入')).toBeNull();
    });
    it('rotates the fold caret when the 已处理 header expands', async () => {
        loadHistoryMock.mockResolvedValue(historyPage(completedTurn()));
        render(_jsx(ChatView, { session: session, onBack: () => { } }));
        const head = await screen.findByRole('button', { name: /已处理/ });
        fireEvent.click(head);
        const container = head.closest('.chat-turn-done');
        expect(container?.className ?? '').toContain('chat-turn-done-open');
    });
});
