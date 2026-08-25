/** @vitest-environment jsdom */
/**
 * Narrow-screen drawer: frame discovery/stamping against the host markup
 * shape, plus the mounted trigger/scrim mirroring the frame's collapsed
 * attribute and routing clicks through the layout service's toggle.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  findMobileFrame,
  isFrameGrid,
  mountMobileSidebar,
  MOBILE_SIDEBAR_COL_ATTR,
  stampMobileFrame,
} from '../src/client/mobile-sidebar'

/** The host AppFrame shape seen on the live shell: attrs on the frame, the
 *  sidebar column as its first DOM child. */
function hostFrame(withColAttrs = true): { root: HTMLElement; frame: HTMLElement; sidebarCol: HTMLElement } {
  document.body.innerHTML = ''
  const root = document.createElement('div')
  root.id = 'root'
  const frame = document.createElement('div')
  frame.style.gridTemplateColumns = '56px minmax(0, 1fr) 0px'
  frame.setAttribute('data-sidebar-collapsed', '')
  frame.setAttribute('data-details-collapsed', '')
  const sidebarCol = document.createElement('div')
  sidebarCol.style.minWidth = '0'
  const center = document.createElement('div')
  center.setAttribute('data-slot', 'conversation')
  const details = document.createElement('div')
  frame.append(sidebarCol, center, details)
  root.appendChild(frame)
  document.body.appendChild(root)
  return { root, frame, sidebarCol }
}

function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('frame discovery', () => {
  it('recognizes the AppFrame three-track grid pattern', () => {
    const style = document.createElement('div').style
    style.gridTemplateColumns = '280px minmax(0, 1fr) 0px'
    expect(isFrameGrid(style)).toBe(true)
    style.gridTemplateColumns = '1fr 1fr'
    expect(isFrameGrid(style)).toBe(false)
    style.gridTemplateColumns = ''
    expect(isFrameGrid(style)).toBe(false)
  })

  it('finds the frame by its collapse attributes (first child present)', () => {
    const { frame } = hostFrame()
    expect(findMobileFrame()).toBe(frame)
  })

  it('falls back to the inline three-track grid when no attribute is set', () => {
    const { frame } = hostFrame()
    frame.removeAttribute('data-sidebar-collapsed')
    frame.removeAttribute('data-details-collapsed')
    // A stray overlay div with a two-track grid must not win.
    const stray = document.createElement('div')
    stray.style.gridTemplateColumns = '1fr 1fr'
    document.body.appendChild(stray)
    expect(findMobileFrame()).toBe(frame)
  })

  it('stamps the frame and its three grid columns once, idempotently', () => {
    const { frame, sidebarCol } = hostFrame()
    expect(stampMobileFrame()).toBe(true)
    expect(frame.getAttribute('data-dsh-mobile-frame')).not.toBeNull()
    expect(sidebarCol.getAttribute(MOBILE_SIDEBAR_COL_ATTR)).not.toBeNull()
    expect(frame.children[1]?.getAttribute('data-dsh-mobile-center-col')).not.toBeNull()
    expect(frame.children[2]?.getAttribute('data-dsh-mobile-details-col')).not.toBeNull()
    expect(stampMobileFrame()).toBe(true)
    expect(frame.getAttribute('data-dsh-mobile-frame')).not.toBeNull()
  })
})

describe('mountMobileSidebar', () => {
  it('renders the whale-logo trigger with the i18n label next to the frame', async () => {
    hostFrame()
    const toggle = vi.fn()
    const handle = mountMobileSidebar({ label: 'Open sidebar', toggleSidebar: toggle })
    await tick()
    const trigger = document.querySelector('[data-dsh-mobile-trigger]')
    expect(trigger).not.toBeNull()
    expect(trigger?.getAttribute('aria-label')).toBe('Open sidebar')
    expect(trigger?.getAttribute('aria-expanded')).toBe('false')
    expect(trigger?.querySelector('svg')).not.toBeNull()
    const scrim = document.querySelector('[data-dsh-mobile-scrim]')
    expect(scrim).not.toBeNull()
    // Collapsed → no scrim.
    expect(document.querySelector('[data-dsh-mobile-sidebar-root]')?.getAttribute('data-dsh-mobile-open')).toBeNull()
    handle.dispose()
  })

  it('routes trigger clicks through the layout service toggle', async () => {
    hostFrame()
    const toggle = vi.fn()
    const handle = mountMobileSidebar({ label: 'Open sidebar', toggleSidebar: toggle })
    await tick()
    const trigger = document.querySelector('[data-dsh-mobile-trigger]') as HTMLButtonElement
    trigger.click()
    expect(toggle).toHaveBeenCalledOnce()
    handle.dispose()
  })

  it('mirrors the frame collapse state onto the scrim and aria-expanded', async () => {
    const { frame } = hostFrame()
    const handle = mountMobileSidebar({ label: 'Open sidebar', toggleSidebar: () => {} })
    await tick()
    const root = document.querySelector('[data-dsh-mobile-sidebar-root]') as HTMLElement
    const trigger = document.querySelector('[data-dsh-mobile-trigger]') as HTMLButtonElement
    expect(root.getAttribute('data-dsh-mobile-open')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    // The host flips to the expanded drawer (narrowExpanded → no collapsed).
    frame.removeAttribute('data-sidebar-collapsed')
    await tick()
    expect(root.getAttribute('data-dsh-mobile-open')).toBe('true')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    frame.setAttribute('data-sidebar-collapsed', '')
    await tick()
    expect(root.getAttribute('data-dsh-mobile-open')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    handle.dispose()
  })

  it('waits for the frame to appear before stamping and observing it', async () => {
    const host = hostFrame()
    const toggle = vi.fn()
    const handle = mountMobileSidebar({ label: '打开侧边栏', toggleSidebar: toggle })
    await tick()
    // The frame is present at mount, so the trigger renders and the observer
    // tracks the collapse attribute; flipping it bumps the scrim.
    const root = document.querySelector('[data-dsh-mobile-sidebar-root]') as HTMLElement
    expect(host.frame.getAttribute('data-dsh-mobile-frame')).not.toBeNull()
    host.frame.removeAttribute('data-sidebar-collapsed')
    await tick()
    expect(root.getAttribute('data-dsh-mobile-open')).toBe('true')
    handle.dispose()
    expect(document.querySelector('[data-dsh-mobile-sidebar-root]')).toBeNull()
  })
})