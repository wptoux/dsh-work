/** @vitest-environment jsdom */
/**
 * Fold chrome: discovers `[data-chat-flow]` containers under <body>,
 * attaches per-container mutation + click wiring, and reports changes to the
 * driver. Keeps the entry's apply() thin configuration (no logic to rot).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFoldChrome } from '../src/client/fold-chrome'

function flowContainer(): HTMLElement {
  const container = document.createElement('div')
  container.dataset.chatFlow = ''
  return container
}

function header(container: HTMLElement, turn: number): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('data-dsh-fold-header', '')
  button.setAttribute('data-dsh-fold-turn', String(turn))
  container.appendChild(button)
  return button
}

/** MutationObserver callbacks are microtask-queued; flush before asserting. */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('createFoldChrome', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('picks up containers already in the document and newly added ones', async () => {
    const existing = flowContainer()
    document.body.appendChild(existing)
    const chrome = createFoldChrome(() => {}, () => {})
    chrome.start()
    expect(chrome.containers()).toContain(existing)

    const added = flowContainer()
    document.body.appendChild(added)
    await flush()
    expect(chrome.containers()).toContain(added)
    expect(chrome.containers().length).toBe(2)
  })

  it('drops removed containers', async () => {
    const container = flowContainer()
    document.body.appendChild(container)
    const chrome = createFoldChrome(() => {}, () => {})
    chrome.start()
    expect(chrome.containers().length).toBe(1)
    container.remove()
    await flush()
    expect(chrome.containers().length).toBe(0)
  })

  it('reports structural changes inside a container', async () => {
    const container = flowContainer()
    document.body.appendChild(container)
    const onChange = vi.fn()
    const chrome = createFoldChrome(onChange, () => {})
    chrome.start()
    onChange.mockClear()
    const row = document.createElement('div')
    container.appendChild(row)
    await flush()
    expect(onChange).toHaveBeenCalled()
  })

  it('delegates clicks on fold headers into the toggle callback with the turn number', async () => {
    const container = flowContainer()
    const h = header(container, 3)
    document.body.appendChild(container)
    const onClick = vi.fn()
    const chrome = createFoldChrome(() => {}, onClick)
    chrome.start()
    await flush()
    h.click()
    expect(onClick).toHaveBeenCalledWith(3)
  })

  it('ignores clicks outside fold headers', async () => {
    const container = flowContainer()
    const rowEl = document.createElement('div')
    rowEl.dataset.chatFlowKey = 'x'
    container.appendChild(rowEl)
    document.body.appendChild(container)
    const onClick = vi.fn()
    const chrome = createFoldChrome(() => {}, onClick)
    chrome.start()
    await flush()
    rowEl.click()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('stops observing after dispose', async () => {
    const container = flowContainer()
    document.body.appendChild(container)
    const onChange = vi.fn()
    const chrome = createFoldChrome(onChange, () => {})
    const dispose = chrome.start()
    expect(chrome.containers().length).toBe(1)
    dispose()
    await flush()
    expect(chrome.containers().length).toBe(0) // wiring torn down
    const added = flowContainer()
    document.body.appendChild(added)
    await flush()
    expect(chrome.containers().length).toBe(0) // body observer disconnected
  })
})