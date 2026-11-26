import { describe, expect, it } from 'vitest'
import { classifyLoadFailure, GpuInitError, ModelDownloadError } from './load-failure'

describe('classifyLoadFailure', () => {
  it('reads a 403 as an expired link, which a fresh link fixes', () => {
    expect(classifyLoadFailure(new ModelDownloadError(403))).toEqual({ cause: 'expired', httpStatus: 403 })
  })
  it('reads any other HTTP status as a failed download', () => {
    expect(classifyLoadFailure(new ModelDownloadError(502))).toEqual({ cause: 'download', httpStatus: 502 })
  })
  it('reads a network TypeError from fetch as a failed download', () => {
    expect(classifyLoadFailure(new TypeError('Failed to fetch')).cause).toBe('download')
  })
  it('reads a renderer that could not start as the GPU', () => {
    expect(classifyLoadFailure(new GpuInitError(new Error('no adapter'))).cause).toBe('gpu')
  })
  it('keeps anything else unknown rather than guessing', () => {
    expect(classifyLoadFailure(new Error('wasm trap')).cause).toBe('unknown')
  })
})
