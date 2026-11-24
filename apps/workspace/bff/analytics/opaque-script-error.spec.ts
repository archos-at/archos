import { describe, expect, it } from 'vitest'

import { isOpaqueScriptErrorEvent } from './opaque-script-error'

describe('isOpaqueScriptErrorEvent', () => {
  it('matches the bare "Script error." a browser reports for a cross-origin script', () => {
    expect(isOpaqueScriptErrorEvent('$exception', { $exception_list: [{ value: 'Script error.' }] })).toBe(true)
    expect(isOpaqueScriptErrorEvent('$exception', { $exception_list: [{ value: 'Script error' }] })).toBe(true)
    expect(
      isOpaqueScriptErrorEvent('$exception', { $exception_list: [{ value: 'Script error.', stacktrace: { frames: [] } }] })
    ).toBe(true)
  })

  it('keeps an error that has a stack, another message, or is not an exception', () => {
    expect(
      isOpaqueScriptErrorEvent('$exception', {
        $exception_list: [{ value: 'Script error.', stacktrace: { frames: [{ filename: 'https://app.example/a.js' }] } }],
      })
    ).toBe(false)
    expect(isOpaqueScriptErrorEvent('$exception', { $exception_list: [{ value: 'Script error in upload' }] })).toBe(false)
    expect(isOpaqueScriptErrorEvent('$exception', { $exception_list: [] })).toBe(false)
    expect(isOpaqueScriptErrorEvent('$pageview', { $exception_list: [{ value: 'Script error.' }] })).toBe(false)
  })
})
