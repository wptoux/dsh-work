/** @vitest-environment jsdom */
/**
 * Fold application over the chat flow DOM: row hiding markers, the
 *「已处理」header insertion and its expanded state, idempotence, and stale
 * cleanup. Pure DOM — no React, no session wiring (the driver owns those).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { applyFoldPlan, type FoldCopy } from '../src/client/fold-dom'

const COPY: FoldCopy = {
  header: () => '已处理',
  count: (n: number) => `${n} 条`,
}

function row(key: string, kind: string): HTMLElement {
  const el = document.createElement('div')
  el.dataset.chatFlowKey = key
  el.dataset.chatFlowKind = kind
  return el
}

function containerWith(rows: HTMLElement[]): HTMLElement {
  const container = document.createElement('div')
  container.dataset.chatFlow = ''
  for (const r of rows) container.appendChild(r)
  return container
}

let container: HTMLElement

const FULL_ROWS = () => [
  row('u1', 'user'),
  row('a1', 'assistant-step'),
  row('t1', 'tool-result'),
  row('a2', 'assistant-step'),
  row('tail', 'turn-tail'),
]

const FOLD_1 = { turn: 1, hiddenKeys: ['a1', 't1'], lastAssistantKey: 'a2', hiddenCount: 2 }

describe('applyFoldPlan', () => {
  beforeEach(() => {
    container = containerWith(FULL_ROWS())
    document.body.appendChild(container)
  })

  it('inserts the「已处理」header at the TOP of the fold block (before the first hidden row) and hides the middle rows', () => {
    applyFoldPlan(container, { folds: [FOLD_1], completionRequest: null }, new Set(), COPY)
    const header = container.querySelector<HTMLElement>('[data-dsh-fold-turn="1"]')
    expect(header).not.toBeNull()
    // The header leads the block; the hidden rows expand BELOW it, with the
    // last reply at the block's end (downward expansion).
    expect(header?.nextElementSibling?.getAttribute('data-chat-flow-key')).toBe('a1')
    expect(header?.previousElementSibling?.getAttribute('data-chat-flow-key')).toBe('u1')
    expect(header?.getAttribute('aria-expanded')).toBe('false')
    expect(header?.textContent).toContain('已处理')
    expect(header?.textContent).toContain('2 条')
    const a1 = container.querySelector('[data-chat-flow-key="a1"]')
    const t1 = container.querySelector('[data-chat-flow-key="t1"]')
    expect(a1?.getAttribute('data-dsh-fold-row')).toBe('1')
    expect(a1?.getAttribute('data-dsh-fold-expanded')).toBe('false')
    expect(t1?.getAttribute('data-dsh-fold-row')).toBe('1')
    // user prompt and turn tail stay untouched
    expect(container.querySelector('[data-chat-flow-key="u1"]')?.hasAttribute('data-dsh-fold-row')).toBe(false)
    expect(container.querySelector('[data-chat-flow-key="tail"]')?.hasAttribute('data-dsh-fold-row')).toBe(false)
  })

  it('reflects the expanded state on the header and the hidden rows', () => {
    applyFoldPlan(container, { folds: [FOLD_1], completionRequest: null }, new Set([1]), COPY)
    const header = container.querySelector<HTMLElement>('[data-dsh-fold-turn="1"]')
    expect(header?.getAttribute('aria-expanded')).toBe('true')
    for (const key of ['a1', 't1']) {
      const el = container.querySelector(`[data-chat-flow-key="${key}"]`)
      expect(el?.getAttribute('data-dsh-fold-expanded')).toBe('true')
    }
  })

  it('is idempotent — applying the same plan twice yields exactly one header', () => {
    applyFoldPlan(container, { folds: [FOLD_1], completionRequest: null }, new Set(), COPY)
    applyFoldPlan(container, { folds: [FOLD_1], completionRequest: null }, new Set(), COPY)
    expect(container.querySelectorAll('[data-dsh-fold-header]').length).toBe(1)
    expect(container.querySelectorAll('[data-dsh-fold-row]').length).toBe(2)
  })

  it('removes stale headers and row markers when a fold disappears from the plan', () => {
    applyFoldPlan(container, { folds: [FOLD_1], completionRequest: null }, new Set(), COPY)
    applyFoldPlan(container, { folds: [], completionRequest: null }, new Set(), COPY)
    expect(container.querySelectorAll('[data-dsh-fold-header]').length).toBe(0)
    expect(container.querySelectorAll('[data-dsh-fold-row]').length).toBe(0)
    expect(container.querySelector('[data-chat-flow-key="a1"]')?.hasAttribute('data-dsh-fold-expanded')).toBe(false)
  })

  it('omits the count badge when the fold hides nothing', () => {
    const single = containerWith([row('u1', 'user'), row('a1', 'assistant-step')])
    applyFoldPlan(single, {
      folds: [{ turn: 7, hiddenKeys: [], lastAssistantKey: 'a1', hiddenCount: 0 }],
      completionRequest: null,
    }, new Set(), COPY)
    const header = single.querySelector<HTMLElement>('[data-dsh-fold-turn="7"]')
    expect(header).not.toBeNull()
    expect(header?.textContent).toContain('已处理')
    expect(header?.textContent).not.toContain('条')
  })

  it('skips folds whose last-assistant row is not rendered yet (no header, no markers)', () => {
    const partial = containerWith([row('u1', 'user'), row('a1', 'assistant-step')])
    applyFoldPlan(partial, { folds: [FOLD_1], completionRequest: null }, new Set(), COPY)
    expect(partial.querySelectorAll('[data-dsh-fold-header]').length).toBe(0)
    expect(partial.querySelectorAll('[data-dsh-fold-row]').length).toBe(0)
  })

  it('keeps multiple independent folds sorted with their own headers at the top of each block', () => {
    const multi = containerWith([
      ...FULL_ROWS(),
      row('u2', 'user'),
      row('a3', 'assistant-step'),
      row('a4', 'assistant-step'),
    ])
    const plan = {
      folds: [
        FOLD_1,
        { turn: 2, hiddenKeys: ['a3'], lastAssistantKey: 'a4', hiddenCount: 1 },
      ],
      completionRequest: null,
    }
    applyFoldPlan(multi, plan, new Set([2]), COPY)
    const headers = multi.querySelectorAll<HTMLElement>('[data-dsh-fold-header]')
    expect(headers.length).toBe(2)
    expect(headers[0].getAttribute('data-dsh-fold-turn')).toBe('1')
    expect(headers[0].nextElementSibling?.getAttribute('data-chat-flow-key')).toBe('a1')
    expect(headers[1].getAttribute('data-dsh-fold-turn')).toBe('2')
    expect(headers[1].getAttribute('aria-expanded')).toBe('true')
    expect(headers[1].nextElementSibling?.getAttribute('data-chat-flow-key')).toBe('a3')
  })

  it('re-anchors the header to the fold block\'s top when the rows reorder', () => {
    applyFoldPlan(container, { folds: [FOLD_1], completionRequest: null }, new Set(), COPY)
    // Simulate React moving the first hidden row to the end of the flow.
    const a1 = container.querySelector<HTMLElement>('[data-chat-flow-key="a1"]')
    container.appendChild(a1)
    applyFoldPlan(container, { folds: [FOLD_1], completionRequest: null }, new Set(), COPY)
    const header = container.querySelector<HTMLElement>('[data-dsh-fold-turn="1"]')
    // The block now starts at t1 (a1 moved after it).
    expect(header?.nextElementSibling?.getAttribute('data-chat-flow-key')).toBe('t1')
    expect(container.querySelectorAll('[data-dsh-fold-header]').length).toBe(1)
  })

  it('marks the fold\'s last reply row so the folded view can hide its think block', () => {
    applyFoldPlan(container, { folds: [FOLD_1], completionRequest: null }, new Set(), COPY)
    const last = container.querySelector<HTMLElement>('[data-chat-flow-key="a2"]')
    expect(last?.getAttribute('data-dsh-fold-last')).toBe('1')
    // middle rows are fold members, not the visible last reply
    expect(container.querySelector('[data-chat-flow-key="a1"]')?.hasAttribute('data-dsh-fold-last')).toBe(false)
    expect(container.querySelector('[data-chat-flow-key="t1"]')?.hasAttribute('data-dsh-fold-last')).toBe(false)
  })

  it('clears the last-reply marker when the fold disappears from the plan', () => {
    applyFoldPlan(container, { folds: [FOLD_1], completionRequest: null }, new Set(), COPY)
    applyFoldPlan(container, { folds: [], completionRequest: null }, new Set(), COPY)
    expect(container.querySelector('[data-chat-flow-key="a2"]')?.hasAttribute('data-dsh-fold-last')).toBe(false)
  })
})