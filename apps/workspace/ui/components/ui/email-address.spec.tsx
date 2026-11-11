/**
 * A project address on a phone used to break mid-word (`…@inbox.e` /
 * `xample.org`). It now carries its own break opportunities.
 */

import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { EmailAddress, emailAddressSegments } from './email-address'

describe('emailAddressSegments', () => {
  it('breaks after the +, before a dot of the local part and before the @', () => {
    expect(emailAddressSegments('project+bauplatz-12.k3x7q2m9p4ab@inbox.example.org')).toEqual([
      'project+',
      'bauplatz-12',
      '.k3x7q2m9p4ab',
      '@inbox.example.org',
    ])
  })

  it('keeps every character, and a plain address breaks only before the @', () => {
    for (const address of ['project+k3x7q2m9p4ab@inbox.example.org', 'a.b+c+d@example.org', 'kontakt@example.org', 'no-at-sign']) {
      expect(emailAddressSegments(address).join('')).toBe(address)
    }
    expect(emailAddressSegments('kontakt@example.org')).toEqual(['kontakt', '@example.org'])
  })
})

describe('EmailAddress', () => {
  it('reads as the address, with a <wbr> between the pieces and none at the end', () => {
    const { container } = render(<EmailAddress address="project+bauplatz-12.k3x7q2m9p4ab@inbox.example.org" />)
    expect(container).toHaveTextContent('project+bauplatz-12.k3x7q2m9p4ab@inbox.example.org')
    expect(container.querySelectorAll('wbr')).toHaveLength(3)
    expect(container.lastChild?.nodeName).toBe('#text')
  })
})
