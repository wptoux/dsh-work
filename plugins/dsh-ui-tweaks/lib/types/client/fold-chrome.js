/**
 * Fold chrome: the DOM observation + click delegation the driver needs.
 *
 * Watches <body> for `[data-chat-flow]` columns (added/removed at any depth),
 * attaches a childList observer to each live column so structural changes
 * (new rows, prepended history, remounts) re-trigger the fold pass, and
 * delegates clicks on「已处理」headers into the driver's toggle. All wiring is
 * tracked per container and torn down by the returned disposer (HMR-safe).
 */
/** Flow column marker (see ChatView's column div). */
const FLOW_SELECTOR = '[data-chat-flow]';
const HEADER_SELECTOR = '[data-dsh-fold-header]';
export function createFoldChrome(onChange, onHeaderClick) {
    const attached = new Map();
    const attach = (container) => {
        if (attached.has(container))
            return;
        const observer = new MutationObserver(onChange);
        observer.observe(container, { childList: true });
        const onClick = (event) => {
            const target = event.target;
            if (!(target instanceof Element))
                return;
            const header = target.closest(HEADER_SELECTOR);
            if (header === null || !container.contains(header))
                return;
            const turn = Number(header.getAttribute('data-dsh-fold-turn'));
            if (Number.isFinite(turn))
                onHeaderClick(turn);
        };
        container.addEventListener('click', onClick);
        attached.set(container, { observer, onClick });
    };
    const detach = (container) => {
        const entry = attached.get(container);
        if (entry === undefined)
            return;
        entry.observer.disconnect();
        container.removeEventListener('click', entry.onClick);
        attached.delete(container);
    };
    const sync = () => {
        const visible = new Set();
        for (const container of document.querySelectorAll(FLOW_SELECTOR)) {
            visible.add(container);
            attach(container);
        }
        for (const container of [...attached.keys()]) {
            if (!visible.has(container))
                detach(container);
        }
    };
    // childList + subtree: containers can be nested at any depth; attribute
    // changes never alter the container set. Callbacks are microtask-queued,
    // so a notification may survive teardown — never touch globals blindly.
    const bodyObserver = new MutationObserver(() => {
        if (typeof document === 'undefined')
            return;
        sync();
        onChange();
    });
    const start = () => {
        sync();
        if (typeof document !== 'undefined' && document.body !== null) {
            bodyObserver.observe(document.body, { childList: true, subtree: true });
        }
        return () => {
            bodyObserver.disconnect();
            for (const container of [...attached.keys()])
                detach(container);
        };
    };
    return {
        containers: () => [...attached.keys()],
        start,
    };
}
