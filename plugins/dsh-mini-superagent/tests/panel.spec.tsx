// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, fetchHub, Panel, pollHub, TicketTable, PANEL_ID } from '../src/client/index.tsx'
import type { MiniClientContext } from '../src/client/index.tsx'

// React 18: opt the test environment into act() so effects flush synchronously.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const jsonResponse = (body: unknown, status = 200): Response => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
}) as unknown as Response

const fakeFetch = (handler: (url: string, init?: RequestInit) => Response): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)) as typeof fetch

const renderPanel = async (openSession: (sessionId: string) => void, fetchImpl: typeof fetch): Promise<{ container: HTMLElement; root: ReturnType<typeof createRoot> }> => {
  vi.stubGlobal('fetch', fetchImpl)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<Panel openSession={openSession} />) })
  await act(async () => { await Promise.resolve() })
  return { container, root }
}

const unmount = async (container: HTMLElement, root: ReturnType<typeof createRoot>): Promise<void> => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
}

afterEach(() => { vi.unstubAllGlobals() })

describe('panel data', () => {
  it('fetches the hub payload', async () => {
    const fake = async () => jsonResponse({ hubSessionId: 'mini-hub-1', tickets: [] })
    await expect(fetchHub(fake)).resolves.toEqual({ hubSessionId: 'mini-hub-1', tickets: [] })
  })

  it('requests the hub endpoint with a cancellation signal', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fake = fakeFetch((url, init) => {
      calls.push({ url, init })
      return jsonResponse({ hubSessionId: 'h', tickets: [] })
    })
    const controller = new AbortController()
    await fetchHub(fake, controller.signal)
    expect(calls[0]?.url).toBe('/mini-superagent/api/hub')
    expect(calls[0]?.init?.signal).toBe(controller.signal)
  })

  it('normalizes the wire ticket id into the panel view', async () => {
    const fake = fakeFetch(() => jsonResponse({
      hubSessionId: 'h',
      tickets: [{ id: 't-1', title: 'fix readme', state: 'working', summary: 'halfway', updatedAt: '2026-11-01T00:00:00.000Z' }],
    }))
    await expect(fetchHub(fake)).resolves.toEqual({
      hubSessionId: 'h',
      tickets: [{ ticket: 't-1', title: 'fix readme', state: 'working', summary: 'halfway', updatedAt: '2026-11-01T00:00:00.000Z' }],
    })
  })

  it('drops non-object ticket rows', async () => {
    const fake = fakeFetch(() => jsonResponse({
      hubSessionId: 'h',
      tickets: [null, 'not-a-ticket', 42, { id: 't-1', title: 'keep me', state: 'queued' }],
    }))
    await expect(fetchHub(fake)).resolves.toEqual({
      hubSessionId: 'h',
      tickets: [{ ticket: 't-1', title: 'keep me', state: 'queued', summary: null, updatedAt: null }],
    })
  })

  it('fails loudly on a non-2xx response', async () => {
    const fake = fakeFetch(() => jsonResponse({ error: 'nope' }, 503))
    await expect(fetchHub(fake)).rejects.toThrow('hub request failed: 503')
  })
})

describe('TicketTable', () => {
  it('renders ticket rows', () => {
    const html = renderToString(<TicketTable tickets={[{ ticket: 't-1', title: 'fix readme', state: 'working', summary: 'halfway' }]} />)
    expect(html).toContain('fix readme')
    expect(html).toContain('working')
    expect(html).toContain('halfway')
  })

  it('renders the empty hint', () => {
    expect(renderToString(<TicketTable tickets={[]} />)).toContain('还没有票据')
  })
})

describe('Panel', () => {
  it('renders the entry point before the first payload arrives', () => {
    const html = renderToString(<Panel openSession={() => {}} />)
    expect(html).toContain('SuperAgent')
    expect(html).toContain('打开主会话')
    expect(html).toContain('加载票据…')
    expect(html).not.toContain('还没有票据')
  })

  it('opens the hub session when 打开主会话 is clicked', async () => {
    const opened: string[] = []
    const fetchMock = vi.fn(async () => jsonResponse({ hubSessionId: 'mini-hub-1', tickets: [] }))
    const { container, root } = await renderPanel(id => { opened.push(id) }, fetchMock as unknown as typeof fetch)
    try {
      const button = container.querySelector('button')
      expect(button).not.toBeNull()
      expect(button!.disabled).toBe(false)
      expect(container.textContent).toContain('主会话：mini-hub-1')
      expect(container.textContent).toContain('还没有票据')
      await act(async () => { button!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(opened).toEqual(['mini-hub-1'])
    } finally {
      await unmount(container, root)
    }
  })

  it('shows the error instead of the empty hint when the first load fails', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('offline') })
    const { container, root } = await renderPanel(() => {}, fetchMock as unknown as typeof fetch)
    try {
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('offline')
      expect(container.textContent).not.toContain('还没有票据')
    } finally {
      await unmount(container, root)
    }
  })
})

describe('client registration', () => {
  interface CapturedRegistration {
    options: { name: string; id?: string; order?: number; label?: string | (() => string); key?: string }
    component: (props: never) => ReactElement
  }

  const mountClient = (): { registered: CapturedRegistration[]; injected: string[]; opened: string[] } => {
    const registered: CapturedRegistration[] = []
    const injected: string[] = []
    const opened: string[] = []
    const ctx = {
      slots: {
        inject(key: string, setup: () => () => void) {
          injected.push(key)
          setup()
          return () => {}
        },
        register(options: CapturedRegistration['options'], component: CapturedRegistration['component']) {
          registered.push({ options, component })
          return () => {}
        },
      },
      uiWorkspace: { openSession: (sessionId: string) => { opened.push(sessionId) } },
    } as unknown as MiniClientContext
    apply(ctx)
    return { registered, injected, opened }
  }

  it('registers the sidebar entry with the panel identity and order', () => {
    const { registered, injected } = mountClient()
    expect(injected).toEqual(['sidebar.panellist', 'main'])
    const sidebar = registered.find(entry => entry.options.name === 'sidebar.panellist')
    expect(sidebar).toBeDefined()
    expect(sidebar!.options.id).toBe(PANEL_ID)
    expect(sidebar!.options.order).toBe(20)
    expect(typeof sidebar!.options.label).toBe('function')
    expect((sidebar!.options.label as () => string)()).toBe('SuperAgent')
  })

  it('registers the main panel under the same key and wires openSession', () => {
    const { registered, opened } = mountClient()
    const main = registered.find(entry => entry.options.name === 'main')
    expect(main).toBeDefined()
    expect(main!.options.key).toBe(PANEL_ID)
    const element = main!.component({} as never) as ReactElement<{ openSession(sessionId: string): void }>
    element.props.openSession('mini-hub-2')
    expect(opened).toEqual(['mini-hub-2'])
  })
})

describe('hub polling', () => {
  afterEach(() => { vi.useRealTimers() })

  it('loads immediately, refreshes every 3s and stops on dispose', async () => {
    vi.useFakeTimers()
    const load = vi.fn(async () => {})
    const stop = pollHub(load)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(load).toHaveBeenCalledTimes(2)
    stop()
    await vi.advanceTimersByTimeAsync(9000)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps polling after a failed load', async () => {
    vi.useFakeTimers()
    const load = vi.fn(async () => { throw new Error('offline') })
    const stop = pollHub(load)
    await vi.advanceTimersByTimeAsync(3000)
    expect(load).toHaveBeenCalledTimes(2)
    stop()
  })

  it('skips a tick while the previous load is still pending', async () => {
    vi.useFakeTimers()
    let settle: (() => void) | undefined
    const load = vi.fn(() => new Promise<void>(resolve => { settle = resolve }))
    const stop = pollHub(load)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(load).toHaveBeenCalledTimes(1)
    settle!()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(3000)
    expect(load).toHaveBeenCalledTimes(2)
    stop()
  })
})
