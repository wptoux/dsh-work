import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { fetchHub, Panel, pollHub, TicketTable } from '../src/client/index.tsx'

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const fakeFetch = (handler: (url: string, init?: RequestInit) => Response): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)) as typeof fetch

describe('panel data', () => {
  it('fetches the hub payload', async () => {
    const fake = async () => new Response(JSON.stringify({ hubSessionId: 'mini-hub-1', tickets: [] }), { status: 200 })
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
    expect(html).toContain('还没有票据')
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
})
