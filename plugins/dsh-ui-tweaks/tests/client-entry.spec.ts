/** @vitest-environment jsdom */
/**
 * Client-entry smoke test after the fold removal: `apply()` mounts without
 * throwing, declares only the services the remaining mobile tweaks need, and
 * registers the `ui-tweaks` dictionaries.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { apply, inject } from '../src/client/index'

function fakeContext() {
  const disposers: Array<() => void> = []
  const dictionaries = new Map<string, Record<string, string>>()
  const ctx = {
    effect(fn: () => (() => void) | void) {
      const off = fn()
      if (typeof off === 'function') disposers.push(off)
      return off ?? (() => {})
    },
    locale: {
      register(namespace: string, dicts: Record<string, Record<string, string>>) {
        dictionaries.set(namespace, dicts.zh)
        return () => dictionaries.delete(namespace)
      },
      bind(namespace: string) {
        return (key: string) => dictionaries.get(namespace)?.[key] ?? key
      },
    },
    get: () => undefined,
  } as unknown as ClientContext
  return {
    ctx,
    dictionaries,
    disposeAll() {
      for (const off of disposers.splice(0)) off()
    },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('client entry (post-fold-removal)', () => {
  it('declares only the locale service', () => {
    expect(inject).toEqual(['locale'])
  })

  it('mounts without throwing and registers the ui-tweaks dictionaries', () => {
    const fake = fakeContext()
    apply(fake.ctx)
    expect(fake.dictionaries.get('ui-tweaks')?.['mobile.openSidebar']).toBe('打开侧边栏')
    fake.disposeAll()
  })
})