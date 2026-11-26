export type LoadFailureCause = 'expired' | 'download' | 'gpu' | 'device-lost' | 'unknown'

export class ModelDownloadError extends Error {
  constructor(readonly httpStatus: number) {
    super(`model download failed (${httpStatus})`)
    this.name = 'ModelDownloadError'
  }
}

export class GpuInitError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'the GPU could not be initialised', { cause })
    this.name = 'GpuInitError'
  }
}

export function classifyLoadFailure(error: unknown): { cause: LoadFailureCause; httpStatus: number | null } {
  if (error instanceof ModelDownloadError) {
    return { cause: error.httpStatus === 403 ? 'expired' : 'download', httpStatus: error.httpStatus }
  }
  if (error instanceof GpuInitError) return { cause: 'gpu', httpStatus: null }
  if (error instanceof TypeError) return { cause: 'download', httpStatus: null }
  return { cause: 'unknown', httpStatus: null }
}
