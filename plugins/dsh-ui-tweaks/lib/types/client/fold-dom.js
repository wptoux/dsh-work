/**
 * DOM application of the fold plan over the chat flow column
 * (`[data-chat-flow]`, see ChatView's column). The driver computes the plan
 * from the session snapshot elsewhere; this module only translates a plan
 * into row markers,「已处理」headers and their expanded state.
 *
 * Everything is idempotent and self-healing: running the same plan twice
 * yields one header, a vanished fold removes its header and markers, and the
 * header is repositioned when React reorders rows around it. The header is a
 * plain <button> we insert as a sibling of the flow rows — React's keyed
 * reconciliation leaves foreign siblings alone, and the driver re-applies on
 * every DOM/snapshot change regardless.
 */
/** Compact wall-clock duration: 3m16s / 45s / 1h02m (locale-neutral). */
export function formatDuration(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0)
        return `${hours}h${String(minutes).padStart(2, '0')}m`;
    if (minutes > 0)
        return `${minutes}m${String(seconds).padStart(2, '0')}s`;
    return `${seconds}s`;
}
/** CSS class / attribute vocabulary (plain CSS lives in fold.css, injected by the client entry). */
export const FOLD_HEADER_MARKER = 'data-dsh-fold-header';
export const FOLD_TURN_ATTR = 'data-dsh-fold-turn';
export const FOLD_ROW_ATTR = 'data-dsh-fold-row';
export const FOLD_EXPANDED_ATTR = 'data-dsh-fold-expanded';
/** Marker on the fold's visible last reply (its think block hides while folded). */
export const FOLD_LAST_ATTR = 'data-dsh-fold-last';
export const FOLD_LAST_EXPANDED_ATTR = 'data-dsh-fold-last-expanded';
/** Flow rows are direct children of the flow column carrying their node key. */
const FLOW_ROW_SELECTOR = '[data-chat-flow-key]';
const HEADER_SELECTOR = `[${FOLD_HEADER_MARKER}]`;
function directRows(container) {
    const rows = new Map();
    for (const child of container.children) {
        const el = child;
        const key = el.getAttribute('data-chat-flow-key');
        if (key !== null)
            rows.set(key, el);
    }
    return rows;
}
function directHeaders(container) {
    const headers = [];
    for (const child of container.children) {
        const el = child;
        if (el.hasAttribute(FOLD_HEADER_MARKER))
            headers.push(el);
    }
    return headers;
}
function makeHeader(turn, open, copy) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dsh-fold-header';
    button.setAttribute(FOLD_HEADER_MARKER, '');
    button.setAttribute(FOLD_TURN_ATTR, String(turn));
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    const caret = document.createElement('span');
    caret.className = 'dsh-fold-caret';
    caret.textContent = '›';
    const label = document.createElement('span');
    label.className = 'dsh-fold-label';
    label.textContent = copy.header();
    // Label first, caret trailing (「已处理 ›」not「› 已处理」) so the label
    // left-aligns with the reply text below the header.
    button.appendChild(label);
    button.appendChild(caret);
    return button;
}
/** Set or clear the header's count badge (shown only when rows were hidden). */
function setCountBadge(button, count, copy) {
    const existing = button.querySelector('.dsh-fold-count');
    if (count <= 0) {
        existing?.remove();
        return;
    }
    if (existing === null) {
        const badge = document.createElement('span');
        badge.className = 'dsh-fold-count';
        button.appendChild(badge);
        badge.textContent = copy.count(count);
    }
    else {
        existing.textContent = copy.count(count);
    }
}
/** Set or clear the header's duration badge (shown when the turn duration is known). */
function setDurationBadge(button, durationMs, copy) {
    const existing = button.querySelector('.dsh-fold-duration');
    if (durationMs === undefined) {
        existing?.remove();
        return;
    }
    if (existing === null) {
        const badge = document.createElement('span');
        badge.className = 'dsh-fold-duration';
        // Sit between the label and the caret (已处理 3m16s ›), before the count.
        button.insertBefore(badge, button.querySelector('.dsh-fold-caret'));
        badge.textContent = copy.duration(durationMs);
    }
    else {
        existing.textContent = copy.duration(durationMs);
    }
}
/**
 * Apply one fold plan to a flow container. Pure DOM — no event wiring (the
 * driver owns the delegated click), no session reads.
 * @param container - the `[data-chat-flow]` column element.
 * @param plan - the current fold plan for the session.
 * @param expanded - turns currently expanded (user state, kept by the driver).
 * @param copy - translated header copy.
 */
export function applyFoldPlan(container, plan, expanded, copy) {
    const rows = directRows(container);
    const foldedTurns = new Set(plan.folds.map(f => f.turn));
    // 1. Drop headers whose fold is no longer planned.
    for (const header of directHeaders(container)) {
        const turn = Number(header.getAttribute(FOLD_TURN_ATTR));
        if (!foldedTurns.has(turn))
            header.remove();
    }
    // 2. Clear every marker this module owns, so a re-apply starts clean.
    for (const row of rows.values()) {
        row.removeAttribute(FOLD_ROW_ATTR);
        row.removeAttribute(FOLD_EXPANDED_ATTR);
        row.removeAttribute(FOLD_LAST_ATTR);
        row.removeAttribute(FOLD_LAST_EXPANDED_ATTR);
    }
    // 3. Apply each planned fold.
    for (const fold of plan.folds) {
        const lastRow = rows.get(fold.lastAssistantKey);
        if (lastRow === undefined)
            continue; // last assistant row not rendered yet — skip fold
        const open = expanded.has(fold.turn);
        for (const key of fold.hiddenKeys) {
            const row = rows.get(key);
            if (row === undefined)
                continue;
            row.setAttribute(FOLD_ROW_ATTR, String(fold.turn));
            row.setAttribute(FOLD_EXPANDED_ATTR, open ? 'true' : 'false');
        }
        // Mark the visible last reply so the folded view can hide its think
        // disclosure (restored once the fold is expanded).
        lastRow.setAttribute(FOLD_LAST_ATTR, String(fold.turn));
        lastRow.setAttribute(FOLD_LAST_EXPANDED_ATTR, open ? 'true' : 'false');
        // The「已处理」header leads the block: it sits above the FIRST hidden row
        // (or above the last reply for single-message turns) so the fold expands
        // DOWNWARD from the header, which never moves out of place.
        const anchorRow = firstHiddenRow(container, fold.hiddenKeys) ?? lastRow;
        let header = directHeaders(container).find(h => h.getAttribute(FOLD_TURN_ATTR) === String(fold.turn));
        if (header === undefined) {
            header = makeHeader(fold.turn, open, copy);
            anchorRow.parentNode?.insertBefore(header, anchorRow);
        }
        else {
            header.setAttribute('aria-expanded', open ? 'true' : 'false');
            const label = header.querySelector('.dsh-fold-label');
            if (label !== null)
                label.textContent = copy.header();
            if (header.nextElementSibling !== anchorRow) {
                anchorRow.parentNode?.insertBefore(header, anchorRow);
            }
        }
        setCountBadge(header, fold.hiddenCount, copy);
        setDurationBadge(header, fold.durationMs, copy);
    }
}
/** First row in flow order whose key is a member of the fold's hidden set. */
function firstHiddenRow(container, hiddenKeys) {
    if (hiddenKeys.length === 0)
        return undefined;
    const hidden = new Set(hiddenKeys);
    for (const child of container.children) {
        const key = child.getAttribute('data-chat-flow-key');
        if (key !== null && hidden.has(key))
            return child;
    }
    return undefined;
}
