/**
 * Fold-plan computation (pure): given a chat window view, decide which
 * completed turns fold into「已处理」blocks, which rows hide, and whether an
 * older-history completion load is needed for a closed turn whose head is
 * outside the window. Mirrors the mobile client's turn-fold semantics.
 */
import { describe, expect, it } from 'vitest'
import { planFolds, type FoldNode, type FoldTurn, type FoldWindow } from '../src/client/fold-plan'

function node(key: string, kind: string, anchorSeq: number, turn: number | undefined): FoldNode {
  return { key, kind, anchorSeq, turn }
}

function turn(number: number, startLoaded: boolean, endLoaded: boolean, durationMs?: number): FoldTurn {
  return { turn: number, startLoaded, endLoaded, ...durationMs === undefined ? {} : { durationMs } }
}

function windowOf(turns: FoldTurn[], nodes: FoldNode[], hasMore = false, loadingOlder = false): FoldWindow {
  return { turns: new Map(turns.map(t => [t.turn, t])), nodes, hasMore, loadingOlder }
}

describe('planFolds — completed-turn folding', () => {
  it('folds a closed whole turn, hiding every middle row (assistant + tool) and keeping only the last assistant message', () => {
    const w = windowOf(
      [turn(1, true, true)],
      [
        node('u1', 'user', 10, 1),
        node('a1', 'assistant-step', 20, 1),
        node('t1', 'tool-result', 30, 1),
        node('a2', 'assistant-step', 40, 1),
        node('tail', 'turn-tail', 50, 1),
      ],
      false,
      false,
    )
    const plan = planFolds(w)
    expect(plan.completionRequest).toBeNull()
    expect(plan.folds).toEqual([
      { turn: 1, hiddenKeys: ['a1', 't1'], lastAssistantKey: 'a2', hiddenCount: 2 },
    ])
  })

  it('does not fold an open turn whose end has not loaded (streaming)', () => {
    const w = windowOf(
      [turn(1, true, false)],
      [
        node('u1', 'user', 10, 1),
        node('a1', 'assistant-step', 20, 1),
        node('a2', 'assistant-step', 30, 1),
      ],
    )
    expect(planFolds(w).folds).toEqual([])
  })

  it('does not fold a closed turn whose head is outside the window, and requests older history', () => {
    const w = windowOf(
      [turn(1, false, true)],
      [node('a1', 'assistant-step', 20, 1), node('a2', 'assistant-step', 40, 1)],
      true,
      false,
    )
    const plan = planFolds(w)
    expect(plan.folds).toEqual([])
    expect(plan.completionRequest).toEqual({ turn: 1 })
  })

  it('requests no completion when there is no older history', () => {
    const w = windowOf(
      [turn(1, false, true)],
      [node('a1', 'assistant-step', 20, 1), node('a2', 'assistant-step', 40, 1)],
      false,
      false,
    )
    expect(planFolds(w).completionRequest).toBeNull()
  })

  it('requests no completion while a load is already in flight', () => {
    const w = windowOf(
      [turn(1, false, true)],
      [node('a1', 'assistant-step', 20, 1), node('a2', 'assistant-step', 40, 1)],
      true,
      true,
    )
    expect(planFolds(w).completionRequest).toBeNull()
  })

  it('folds a failed turn too, leaving the turn-error row visible after the last reply', () => {
    const w = windowOf(
      [turn(1, true, true)],
      [
        node('u1', 'user', 10, 1),
        node('a1', 'assistant-step', 20, 1),
        node('a2', 'assistant-step', 40, 1),
        node('e1', 'turn-error', 50, 1),
      ],
    )
    expect(planFolds(w).folds).toEqual([
      { turn: 1, hiddenKeys: ['a1'], lastAssistantKey: 'a2', hiddenCount: 1 },
    ])
  })

  it('keeps interleaved steering prompts visible inside a folded turn', () => {
    const w = windowOf(
      [turn(1, true, true)],
      [
        node('u1', 'user', 10, 1),
        node('a1', 'assistant-step', 20, 1),
        node('s1', 'steering', 30, 1),
        node('t1', 'tool-result', 40, 1),
        node('a2', 'assistant-step', 50, 1),
      ],
    )
    expect(planFolds(w).folds).toEqual([
      { turn: 1, hiddenKeys: ['a1', 't1'], lastAssistantKey: 'a2', hiddenCount: 2 },
    ])
  })

  it('emits a fold for a single-assistant turn with zero hidden rows (header only)', () => {
    const w = windowOf(
      [turn(1, true, true)],
      [node('u1', 'user', 10, 1), node('a1', 'assistant-step', 20, 1)],
    )
    expect(planFolds(w).folds).toEqual([
      { turn: 1, hiddenKeys: [], lastAssistantKey: 'a1', hiddenCount: 0 },
    ])
  })

  it('ignores nodes without a turn coordinate', () => {
    const w = windowOf(
      [turn(1, true, true)],
      [
        node('ctx1', 'context', 5, undefined),
        node('u1', 'user', 10, 1),
        node('a1', 'assistant-step', 20, 1),
      ],
    )
    expect(planFolds(w).folds).toEqual([
      { turn: 1, hiddenKeys: [], lastAssistantKey: 'a1', hiddenCount: 0 },
    ])
  })

  it('folds every completed whole turn independently (two completed turns)', () => {
    const w = windowOf(
      [turn(1, true, true), turn(2, true, true)],
      [
        node('u1', 'user', 10, 1),
        node('a1', 'assistant-step', 20, 1),
        node('a2', 'assistant-step', 30, 1),
        node('u2', 'user', 40, 2),
        node('a3', 'assistant-step', 50, 2),
        node('t2', 'tool-result', 60, 2),
        node('a4', 'assistant-step', 70, 2),
      ],
    )
    expect(planFolds(w).folds).toEqual([
      { turn: 1, hiddenKeys: ['a1'], lastAssistantKey: 'a2', hiddenCount: 1 },
      { turn: 2, hiddenKeys: ['a3', 't2'], lastAssistantKey: 'a4', hiddenCount: 2 },
    ])
  })

  it('does not fold a closed whole turn that produced no assistant messages', () => {
    const w = windowOf(
      [turn(1, true, true)],
      [node('u1', 'user', 10, 1), node('e1', 'turn-error', 20, 1)],
    )
    expect(planFolds(w).folds).toEqual([])
  })

  it('points the completion request at the oldest closed-but-incomplete turn', () => {
    const w = windowOf(
      [turn(1, true, true), turn(5, false, true)],
      [
        node('u1', 'user', 10, 1),
        node('a1', 'assistant-step', 20, 1),
        node('b1', 'assistant-step', 100, 5),
        node('b2', 'assistant-step', 110, 5),
      ],
      true,
      false,
    )
    const plan = planFolds(w)
    expect(plan.folds).toEqual([
      { turn: 1, hiddenKeys: [], lastAssistantKey: 'a1', hiddenCount: 0 },
    ])
    expect(plan.completionRequest).toEqual({ turn: 5 })
  })

  it('carries the turn\'s wall-clock duration onto its planned fold', () => {
    const w = windowOf(
      [turn(1, true, true, 196_000)],
      [node('u1', 'user', 10, 1), node('a1', 'assistant-step', 20, 1)],
    )
    expect(planFolds(w).folds[0].durationMs).toBe(196_000)
  })

  it('plans folds without a duration when the turn has none loaded', () => {
    const w = windowOf(
      [turn(1, true, true)],
      [node('u1', 'user', 10, 1), node('a1', 'assistant-step', 20, 1)],
    )
    expect(planFolds(w).folds[0].durationMs).toBeUndefined()
  })
})