import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { getFileUploadConfigFromEnv } from '@/shared/config/file-upload'
import { requestBodyLimitBytes } from '@/shared/config/request-body-limit'

const originalEnv = process.env

describe('File Upload Configuration', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  const buildFileUploadConfig = () => getFileUploadConfigFromEnv(process.env)

  describe('default values', () => {
    test('uses default accepted types when env var not set', () => {
      const config = buildFileUploadConfig()

      expect(config.acceptedTypes).toBe('.pdf,.docx,.txt,.md,.csv,.xlsx,.pptx,.dxf,.ifc,.ifczip')
    })

    test('uses default max size when env var not set', () => {
      const config = buildFileUploadConfig()

      expect(config.maxTotalSizeMB).toBe(100)
      expect(config.maxFileSize).toBe(100 * 1_000_000)
      expect(config.maxTotalSize).toBe(100 * 1_000_000)
    })

    test('uses default max file count when env var not set', () => {
      const config = buildFileUploadConfig()

      expect(config.maxFileCount).toBe(10)
    })

    test('uses default file expiration check interval (0) when env var not set', () => {
      const config = buildFileUploadConfig()

      expect(config.fileExpirationCheckIntervalHours).toBe(0)
    })

    test('builds correct MIME types from default extensions', () => {
      const config = buildFileUploadConfig()

      expect(config.acceptedMimeTypes).toContain('application/pdf')
      expect(config.acceptedMimeTypes).toContain('text/markdown')
      expect(config.acceptedMimeTypes).toContain('text/x-markdown')
      expect(config.acceptedMimeTypes).toContain('text/plain')
      expect(
        config.acceptedMimeTypes.includes(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
      ).toBe(true)
      expect(config.acceptedMimeTypes).not.toContain('text/html')
    })

    test('does NOT include image types by default (flag on, capability unconfirmed)', () => {
      const enabled = getFileUploadConfigFromEnv(process.env, {
        imageUploadEnabled: true,
        ifcUploadEnabled: false,
      })

      expect(enabled.acceptedTypes).toBe('.pdf,.docx,.txt,.md,.csv,.xlsx,.pptx,.dxf')
      expect(enabled.acceptedTypes).not.toContain('.png')
      expect(enabled.acceptedTypes).not.toContain('.jpg')
      expect(enabled.acceptedTypes).not.toContain('.jpeg')
      expect(enabled.acceptedMimeTypes).not.toContain('image/png')
      expect(enabled.acceptedMimeTypes).not.toContain('image/jpeg')
    })
  })

  describe('image availability = flag AND VLM capability (four combinations)', () => {
    test('flag on + capability on → images included (no env opt-in needed)', () => {
      const config = getFileUploadConfigFromEnv(process.env, { imageUploadEnabled: true, vlmAvailable: true, ifcUploadEnabled: false })

      expect(config.acceptedTypes).toContain('.png')
      expect(config.acceptedTypes).toContain('.jpg')
      expect(config.acceptedTypes).toContain('.jpeg')
      expect(config.acceptedTypes).toContain('.webp')
      expect(config.acceptedMimeTypes).toContain('image/png')
      expect(config.acceptedMimeTypes).toContain('image/jpeg')
      expect(config.acceptedMimeTypes).toContain('image/webp')
      expect(config.imageUploadBlockedReason).toBeNull()
      expect(config.acceptedMimeTypes).toContain('application/pdf')
    })

    test('flag on + capability off → images excluded, reason vlm-unavailable', () => {
      const config = getFileUploadConfigFromEnv(process.env, { imageUploadEnabled: true, vlmAvailable: false, ifcUploadEnabled: false })

      expect(config.acceptedTypes).toBe('.pdf,.docx,.txt,.md,.csv,.xlsx,.pptx,.dxf')
      expect(config.acceptedMimeTypes).not.toContain('image/png')
      expect(config.imageUploadBlockedReason).toBe('vlm-unavailable')
    })

    test('flag off + capability on → images excluded, no reason (product decision)', () => {
      const config = getFileUploadConfigFromEnv(process.env, { imageUploadEnabled: false, vlmAvailable: true, ifcUploadEnabled: false })

      expect(config.acceptedTypes).toBe('.pdf,.docx,.txt,.md,.csv,.xlsx,.pptx,.dxf')
      expect(config.acceptedMimeTypes).not.toContain('image/png')
      expect(config.imageUploadBlockedReason).toBeNull()
    })

    test('flag off + capability off → images excluded, no reason', () => {
      const config = getFileUploadConfigFromEnv(process.env, { imageUploadEnabled: false, vlmAvailable: false, ifcUploadEnabled: false })

      expect(config.acceptedTypes).toBe('.pdf,.docx,.txt,.md,.csv,.xlsx,.pptx,.dxf')
      expect(config.imageUploadBlockedReason).toBeNull()
    })

    test('explicit env images without VLM → still excluded (closes the silent-failure hole)', () => {
      process.env.FILE_UPLOAD_ACCEPTED_TYPES = '.pdf,.docx,.txt,.md,.png,.jpg,.jpeg'
      const config = getFileUploadConfigFromEnv(process.env, { imageUploadEnabled: true, vlmAvailable: false, ifcUploadEnabled: false })

      expect(config.acceptedTypes).toBe('.pdf,.docx,.txt,.md')
      expect(config.acceptedMimeTypes).not.toContain('image/png')
      expect(config.imageUploadBlockedReason).toBe('vlm-unavailable')
    })

    test('explicit env images WITH VLM → included exactly once (no duplication)', () => {
      process.env.FILE_UPLOAD_ACCEPTED_TYPES = '.pdf,.png'
      const config = getFileUploadConfigFromEnv(process.env, { imageUploadEnabled: true, vlmAvailable: true, ifcUploadEnabled: false })

      expect(config.acceptedTypes.split(',').filter((e) => e === '.png')).toHaveLength(1)
      expect(config.acceptedTypes).toContain('.jpg')
      expect(config.acceptedTypes).toContain('.jpeg')
    })
  })

  describe('IFC availability = the ifc-models flag alone', () => {
    test('flag on → .ifc and .ifczip offered without any env opt-in', () => {
      const config = getFileUploadConfigFromEnv(process.env, { ifcUploadEnabled: true })

      expect(config.acceptedTypes).toContain('.ifc')
      expect(config.acceptedTypes).toContain('.ifczip')
    })

    test('flag off → excluded even when the env list names them', () => {
      process.env.FILE_UPLOAD_ACCEPTED_TYPES = '.pdf,.ifc,.ifczip'
      const config = getFileUploadConfigFromEnv(process.env, { ifcUploadEnabled: false })

      expect(config.acceptedTypes).toBe('.pdf')
    })

    test('env-listed .ifc with the flag on appears exactly once', () => {
      process.env.FILE_UPLOAD_ACCEPTED_TYPES = '.pdf,.ifc'
      const config = getFileUploadConfigFromEnv(process.env, { ifcUploadEnabled: true })

      expect(config.acceptedTypes.split(',').filter((ext) => ext === '.ifc')).toHaveLength(1)
    })

    test('IFC MIME types cover the octet-stream browsers actually send', () => {
      const config = getFileUploadConfigFromEnv(process.env, { ifcUploadEnabled: true })

      expect(config.acceptedMimeTypes).toContain('application/octet-stream')
      expect(config.acceptedMimeTypes).toContain('model/ifc')
    })
  })

  describe('environment variable overrides', () => {
    test('FILE_UPLOAD_ACCEPTED_TYPES overrides default accepted types', () => {
      process.env.FILE_UPLOAD_ACCEPTED_TYPES = '.csv,.json'

      const config = buildFileUploadConfig()

      expect(config.acceptedTypes).toBe('.csv,.json,.ifc,.ifczip')
      expect(config.acceptedMimeTypes).toContain('text/csv')
      expect(config.acceptedMimeTypes).toContain('application/json')
      expect(config.acceptedMimeTypes).not.toContain('application/pdf')
    })

    test('FILE_UPLOAD_ACCEPTED_TYPES with .pptx resolves correct MIME type', () => {
      process.env.FILE_UPLOAD_ACCEPTED_TYPES = '.pdf,.docx,.pptx,.txt,.md'

      const config = buildFileUploadConfig()

      expect(config.acceptedTypes).toBe('.pdf,.docx,.pptx,.txt,.md,.ifc,.ifczip')
      expect(config.acceptedMimeTypes).toContain(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      )
      expect(config.acceptedMimeTypes).toContain('application/pdf')
    })

    test('FILE_UPLOAD_MAX_SIZE_MB overrides default max size', () => {
      process.env.FILE_UPLOAD_MAX_SIZE_MB = '50'

      const config = buildFileUploadConfig()

      expect(config.maxTotalSizeMB).toBe(50)
      expect(config.maxFileSize).toBe(50 * 1_000_000)
      expect(config.maxTotalSize).toBe(50 * 1_000_000)
    })

    test('FILE_UPLOAD_MAX_FILE_COUNT overrides default max file count', () => {
      process.env.FILE_UPLOAD_MAX_FILE_COUNT = '5'

      const config = buildFileUploadConfig()

      expect(config.maxFileCount).toBe(5)
    })

    test('FILE_EXPIRATION_CHECK_INTERVAL_HOURS overrides default', () => {
      process.env.FILE_EXPIRATION_CHECK_INTERVAL_HOURS = '12'

      const config = buildFileUploadConfig()

      expect(config.fileExpirationCheckIntervalHours).toBe(12)
    })

    test('all env vars can be set together', () => {
      process.env.FILE_UPLOAD_ACCEPTED_TYPES = '.pdf,.txt'
      process.env.FILE_UPLOAD_MAX_SIZE_MB = '25'
      process.env.FILE_UPLOAD_MAX_FILE_COUNT = '3'

      const config = buildFileUploadConfig()

      expect(config.acceptedTypes).toBe('.pdf,.txt,.ifc,.ifczip')
      expect(config.maxTotalSizeMB).toBe(25)
      expect(config.maxFileSize).toBe(25 * 1_000_000)
      expect(config.maxFileCount).toBe(3)
      expect(config.acceptedMimeTypes).toContain('application/pdf')
      expect(config.acceptedMimeTypes).toContain('text/plain')
      expect([...config.acceptedMimeTypes].sort()).toEqual([
        'application/ifc',
        'application/octet-stream',
        'application/pdf',
        'application/step',
        'application/x-ifc',
        'application/x-step',
        'application/x-zip-compressed',
        'application/zip',
        'model/ifc',
        'text/plain',
      ])
    })
  })

  describe('edge cases', () => {
    test('handles invalid number for max size (falls back to default)', () => {
      process.env.FILE_UPLOAD_MAX_SIZE_MB = 'invalid'

      const config = buildFileUploadConfig()

      expect(config.maxTotalSizeMB).toBe(100) // Default
    })

    test('handles invalid number for max file count (falls back to default)', () => {
      process.env.FILE_UPLOAD_MAX_FILE_COUNT = 'invalid'

      const config = buildFileUploadConfig()

      expect(config.maxFileCount).toBe(10) // Default
    })

    test('handles extensions with spaces', () => {
      process.env.FILE_UPLOAD_ACCEPTED_TYPES = '.pdf, .txt , .md'

      const config = buildFileUploadConfig()

      expect(config.acceptedMimeTypes).toContain('application/pdf')
      expect(config.acceptedMimeTypes).toContain('text/plain')
      expect(config.acceptedMimeTypes).toContain('text/markdown')
    })

    test('handles uppercase extensions', () => {
      process.env.FILE_UPLOAD_ACCEPTED_TYPES = '.PDF,.TXT'

      const config = buildFileUploadConfig()

      expect(config.acceptedMimeTypes).toContain('application/pdf')
      expect(config.acceptedMimeTypes).toContain('text/plain')
    })

    test('unknown extensions do not add MIME types', () => {
      process.env.FILE_UPLOAD_ACCEPTED_TYPES = '.xyz,.unknown'

      const config = buildFileUploadConfig()

      expect(config.acceptedTypes).toBe('.xyz,.unknown,.ifc,.ifczip')
      expect(config.acceptedMimeTypes).not.toContain('application/pdf')
    })
  })
})

describe('an organization upload limit', () => {
  test('replaces the per-file limit the browser enforces and labels', () => {
    const config = getFileUploadConfigFromEnv({}, { maxFileSizeBytes: 20 * 1_000_000 })
    expect(config.maxFileSize).toBe(20 * 1_000_000)
    expect(config.maxTotalSize).toBe(100 * 1_000_000)
  })

  test('raises the chat batch total with it, so one admissible file always fits', () => {
    const config = getFileUploadConfigFromEnv({}, { maxFileSizeBytes: 200 * 1_000_000 })
    expect(config.maxFileSize).toBe(200 * 1_000_000)
    expect(config.maxTotalSize).toBe(200 * 1_000_000)
    expect(config.maxTotalSizeMB).toBe(200)
  })

  test('leaves the IFC ceiling alone', () => {
    const config = getFileUploadConfigFromEnv({}, { maxFileSizeBytes: 5 * 1_000_000 })
    expect(config.maxIfcFileSize).toBe(250 * 1_000_000)
  })

  test('is the deployment default when none is passed', () => {
    const config = getFileUploadConfigFromEnv({ FILE_UPLOAD_MAX_SIZE_MB: '40' })
    expect(config.maxFileSize).toBe(40 * 1_000_000)
  })
})

describe('the transport ceiling clears the largest file any route admits', () => {
  afterEach(() => {
    delete process.env.FILE_UPLOAD_MAX_SIZE_MB
    delete process.env.BIM_MAX_IFC_BYTES
  })

  test('defaults to the IFC ceiling, not the document limit', () => {
    expect(requestBodyLimitBytes({})).toBe(250 * 1_000_000)
  })

  test('never sits below what an .ifc upload is allowed to be', () => {
    const env = { BIM_MAX_IFC_BYTES: String(400 * 1_000_000) }
    expect(requestBodyLimitBytes(env)).toBe(400 * 1_000_000)
  })

  test('follows the document limit when that is the larger of the two', () => {
    const env = {
      FILE_UPLOAD_MAX_SIZE_MB: '600',
      BIM_MAX_IFC_BYTES: String(250 * 1_000_000),
    }
    expect(requestBodyLimitBytes(env)).toBe(600 * 1_000_000)
  })
})
