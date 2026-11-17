/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { legacyHeaderName } from '@/lib/http/legacy-header-names'
import { HEADLESS_MODE_HEADERS } from './headless-mode'

describe('the headless mode headers', () => {
  it('send the mode under the new name', () => {
    expect(HEADLESS_MODE_HEADERS['x-chat-mode']).toBe('headless')
  })

  it('send it under the old name too, for an agent host one release behind', () => {
    expect(HEADLESS_MODE_HEADERS[legacyHeaderName('x-chat-mode')]).toBe('headless')
  })
})
