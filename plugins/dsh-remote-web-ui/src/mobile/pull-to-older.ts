/**
 * Pull-to-load-older gesture for the chat history scroller.
 *
 * The mobile page fills exactly one viewport and each view owns an inner
 * scroll region, so a downward overscroll would otherwise fall through to
 * the browser's native pull-to-refresh and reload the whole /m page
 * (losing the chat position). This hook intercepts that gesture: a
 * downward drag that starts while the scroller is at the very top arms a
 * "release to load older messages" state past a small threshold, and
 * releasing it loads the previous history page. The gesture is inert
 * when there is no older page (`hasOlder: false`) or a load is already
 * in flight, and the browser never sees the overscroll either way.
 *
 * Listeners attach natively with `passive: false`, because React's
 * delegated touchmove is passive and cannot prevent the browser's
 * pull-to-refresh.
 */

import { useEffect, useRef, useState } from 'react'

/** Pull feedback states: idle → pulling (below the release threshold). */
export type PullHint = 'idle' | 'pulling' | 'ready'

export interface PullToOlderOptions {
  /** Whether an older page exists; the gesture is inert when false. */
  hasOlder: boolean
  /** True while an older page load is in flight; the gesture is inert. */
  loading: boolean
  /** Load the previous history page. */
  onLoad(): void
}

/** Drag distance (after resistance) that arms the ready state. */
export const PULL_READY_DISTANCE = 64
/** Resistance factor applied to the raw drag distance (rubber-band feel). */
export const PULL_RESISTANCE = 0.5

/**
 * Attach the pull-to-load-older gesture to a scrollable element.
 * @param elementRef - the scrollable history element (nullable current).
 * @param options - hasOlder/loading flags and the load action.
 * @returns the current pull hint, for the surface's feedback row.
 */
export function usePullToOlder(
  elementRef: { readonly current: HTMLElement | null | undefined },
  options: PullToOlderOptions,
): PullHint {
  const [hint, setHint] = useState<PullHint>('idle')
  // The options ride a ref so the (single, element-lifetime) listeners
  // always see the freshest hasOlder/loading/onLoad without re-subscribing.
  const optionsRef = useRef(options)
  optionsRef.current = options
  const pullingRef = useRef(false)
  const startYRef = useRef(0)
  const distanceRef = useRef(0)

  useEffect(() => {
    const element = elementRef.current
    if (element === undefined || element === null) return

    const onTouchStart = (event: TouchEvent): void => {
      // Only single-finger pulls that begin at the very top arm the gesture.
      if (event.touches.length !== 1) return
      if (element.scrollTop > 0) return
      pullingRef.current = true
      startYRef.current = event.touches[0]?.clientY ?? 0
      distanceRef.current = 0
    }

    const onTouchMove = (event: TouchEvent): void => {
      if (!pullingRef.current) return
      const touch = event.touches[0]
      if (touch === undefined) return
      const delta = touch.clientY - startYRef.current
      if (delta <= 0) {
        // The finger moved back up: the gesture is over, never a load.
        pullingRef.current = false
        distanceRef.current = 0
        setHint('idle')
        return
      }
      // The drag is ours: keep the browser's pull-to-refresh away.
      event.preventDefault()
      distanceRef.current = delta * PULL_RESISTANCE
      const { hasOlder, loading } = optionsRef.current
      setHint(!hasOlder || loading ? 'idle' : distanceRef.current >= PULL_READY_DISTANCE ? 'ready' : 'pulling')
    }

    const finish = (): void => {
      if (!pullingRef.current) return
      const armed = distanceRef.current >= PULL_READY_DISTANCE
      pullingRef.current = false
      distanceRef.current = 0
      setHint('idle')
      const { hasOlder, loading, onLoad } = optionsRef.current
      if (armed && hasOlder && !loading) onLoad()
    }

    // touchcancel (system took the gesture, e.g. a notification) never loads.
    const cancel = (): void => {
      pullingRef.current = false
      distanceRef.current = 0
      setHint('idle')
    }

    element.addEventListener('touchstart', onTouchStart, { passive: true })
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    element.addEventListener('touchend', finish)
    element.addEventListener('touchcancel', cancel)
    return () => {
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      element.removeEventListener('touchend', finish)
      element.removeEventListener('touchcancel', cancel)
    }
  }, [elementRef])

  return hint
}