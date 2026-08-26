import { jsx as _jsx } from "react/jsx-runtime";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PairRequiredView } from "./PairRequiredView.js";
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});
describe('PairRequiredView', () => {
    it('accepts a pasted link in the installed app context', async () => {
        const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        vi.stubGlobal('fetch', fetch);
        const onPaired = vi.fn();
        render(_jsx(PairRequiredView, { onPaired: onPaired }));
        fireEvent.change(screen.getByLabelText('配对链接'), { target: { value: 'https://phone.example/m/?pair=tok-1&workspace=ws-7' } });
        fireEvent.click(screen.getByRole('button', { name: '配对' }));
        await waitFor(() => expect(onPaired).toHaveBeenCalledWith('/m/?workspace=ws-7'));
    });
    it('shows an initial QR failure without starting the mobile data channel', () => {
        render(_jsx(PairRequiredView, { initialError: "\u914D\u5BF9\u94FE\u63A5\u5DF2\u88AB\u4F7F\u7528\u3002", onPaired: vi.fn() }));
        expect(screen.getByRole('alert').textContent).toContain('配对链接已被使用。');
    });
});
