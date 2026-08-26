import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @vitest-environment jsdom
/**
 * usePullToOlder: a downward drag that starts at the very top of the
 * history scroller arms a "release to load older messages" state past a
 * threshold; releasing it loads the previous history page. The gesture is
 * inert once a load is in flight or when no older page exists, and it
 * never lets the browser's native pull-to-refresh take the overscroll.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { usePullToOlder } from "./pull-to-older.js";
/** Host component: exposes the hook's hint through an <output>. */
function Host({ hasOlder, loading, onLoad }) {
    const ref = useRef(null);
    const hint = usePullToOlder(ref, { hasOlder, loading, onLoad });
    return (_jsxs("div", { children: [_jsx("div", { ref: ref, "data-testid": "scroller" }), _jsx("output", { "data-testid": "hint", children: hint })] }));
}
function scroller() {
    const element = document.querySelector('[data-testid="scroller"]');
    if (element === null)
        throw new Error('scroller not found');
    return element;
}
function hint() {
    const output = document.querySelector('[data-testid="hint"]');
    return (output?.textContent ?? 'idle');
}
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
describe('usePullToOlder', () => {
    it('arms the ready state past the threshold and loads the older page on release', () => {
        const onLoad = vi.fn();
        render(_jsx(Host, { hasOlder: true, loading: false, onLoad: onLoad }));
        fireEvent.touchStart(scroller(), { touches: [{ clientY: 0 }] });
        fireEvent.touchMove(scroller(), { touches: [{ clientY: 180 }] });
        expect(hint()).toBe('ready');
        fireEvent.touchEnd(scroller());
        expect(onLoad).toHaveBeenCalledTimes(1);
        expect(hint()).toBe('idle');
    });
    it('shows the pulling state below the threshold and does not load on release', () => {
        const onLoad = vi.fn();
        render(_jsx(Host, { hasOlder: true, loading: false, onLoad: onLoad }));
        fireEvent.touchStart(scroller(), { touches: [{ clientY: 0 }] });
        fireEvent.touchMove(scroller(), { touches: [{ clientY: 40 }] });
        expect(hint()).toBe('pulling');
        fireEvent.touchEnd(scroller());
        expect(onLoad).not.toHaveBeenCalled();
        expect(hint()).toBe('idle');
    });
    it('never loads when the session has no older page', () => {
        const onLoad = vi.fn();
        render(_jsx(Host, { hasOlder: false, loading: false, onLoad: onLoad }));
        fireEvent.touchStart(scroller(), { touches: [{ clientY: 0 }] });
        fireEvent.touchMove(scroller(), { touches: [{ clientY: 180 }] });
        fireEvent.touchEnd(scroller());
        expect(onLoad).not.toHaveBeenCalled();
        // Without older pages the gesture shows no hint at all.
        expect(hint()).toBe('idle');
    });
    it('does not load again while an older page is already in flight', () => {
        const onLoad = vi.fn();
        render(_jsx(Host, { hasOlder: true, loading: true, onLoad: onLoad }));
        fireEvent.touchStart(scroller(), { touches: [{ clientY: 0 }] });
        fireEvent.touchMove(scroller(), { touches: [{ clientY: 180 }] });
        fireEvent.touchEnd(scroller());
        expect(onLoad).not.toHaveBeenCalled();
    });
    it('does not arm the gesture when the scroller is not at the top', () => {
        const onLoad = vi.fn();
        render(_jsx(Host, { hasOlder: true, loading: false, onLoad: onLoad }));
        // Simulate a scrolled-down position: the drag must not arm.
        Object.defineProperty(scroller(), 'scrollTop', { configurable: true, value: 240 });
        fireEvent.touchStart(scroller(), { touches: [{ clientY: 0 }] });
        fireEvent.touchMove(scroller(), { touches: [{ clientY: 180 }] });
        fireEvent.touchEnd(scroller());
        expect(onLoad).not.toHaveBeenCalled();
        expect(hint()).toBe('idle');
    });
    it('cancels the pull when the finger moves back up', () => {
        const onLoad = vi.fn();
        render(_jsx(Host, { hasOlder: true, loading: false, onLoad: onLoad }));
        fireEvent.touchStart(scroller(), { touches: [{ clientY: 100 }] });
        fireEvent.touchMove(scroller(), { touches: [{ clientY: 40 }] });
        fireEvent.touchEnd(scroller());
        expect(onLoad).not.toHaveBeenCalled();
        expect(hint()).toBe('idle');
    });
});
