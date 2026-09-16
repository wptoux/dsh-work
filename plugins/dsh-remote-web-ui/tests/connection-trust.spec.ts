/** The runtime trust mirror into the Connection fence's trusted-host list. */
import { describe, expect, it } from 'vitest'
import { asTrustedHostsOwner, ConnectionTrustSync } from '../src/connection-trust.ts'

describe('connection-trust', () => {
  it('extracts the trust list only from a structural owner', () => {
    expect(asTrustedHostsOwner({ trustedHosts: ['a.example.com'] })).toEqual({ trustedHosts: ['a.example.com'] })
    expect(asTrustedHostsOwner({})).toBeUndefined()
    expect(asTrustedHostsOwner(null)).toBeUndefined()
    expect(asTrustedHostsOwner(undefined)).toBeUndefined()
    expect(asTrustedHostsOwner({ trustedHosts: 'nope' })).toBeUndefined()
  })

  it('mirrors the active public host into the fence and removes it again', () => {
    const trustedHosts: string[] = ['192.168.1.5']
    const sync = new ConnectionTrustSync(asTrustedHostsOwner({ trustedHosts }))
    sync.reflect('https://a.example.com')
    expect(trustedHosts).toEqual(['192.168.1.5', 'a.example.com'])
    sync.reflect('https://a.example.com')
    expect(trustedHosts).toEqual(['192.168.1.5', 'a.example.com'])
    sync.reflect('https://b.example.com:8443')
    expect(trustedHosts).toEqual(['192.168.1.5', 'b.example.com:8443'])
    sync.dispose()
    expect(trustedHosts).toEqual(['192.168.1.5'])
  })

  it('is a no-op without a structural connection owner', () => {
    const sync = new ConnectionTrustSync(undefined)
    expect(() => sync.reflect('https://a.example.com')).not.toThrow()
    expect(() => sync.reflect(undefined)).not.toThrow()
    expect(() => sync.dispose()).not.toThrow()
  })
})