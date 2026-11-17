import { describe, test, expect } from 'vitest'
import { checkDraggedFilesSupported } from './validation'
import {
  validateFileUpload,
  isValidFileExtension,
  isValidMimeType,
  createEmptyValidationContext,
  type ValidationContext,
} from './validation'
import { MAX_FILE_SIZE, MAX_FILE_COUNT } from './constants'

describe('validation', () => {
  const createFile = (name: string, size: number = 1024, type: string = 'application/pdf'): File => {
    return new File(['x'.repeat(size)], name, { type })
  }

  describe('isValidFileExtension', () => {
    test('accepts valid extensions', () => {
      expect(isValidFileExtension('document.pdf')).toBe(true)
      expect(isValidFileExtension('document.docx')).toBe(true)
      expect(isValidFileExtension('document.txt')).toBe(true)
      expect(isValidFileExtension('document.md')).toBe(true)
    })

    test('rejects invalid extensions', () => {
      expect(isValidFileExtension('document.exe')).toBe(false)
      expect(isValidFileExtension('document.js')).toBe(false)
      expect(isValidFileExtension('document.zip')).toBe(false)
      expect(isValidFileExtension('document.html')).toBe(false)
    })

    test('rejects files without extension', () => {
      expect(isValidFileExtension('document')).toBe(false)
    })

    test('rejects image extensions by default (opt-in only, needs a VLM)', () => {
      expect(isValidFileExtension('photo.png')).toBe(false)
      expect(isValidFileExtension('photo.jpg')).toBe(false)
      expect(isValidFileExtension('photo.jpeg')).toBe(false)
    })

    test('handles case insensitivity', () => {
      expect(isValidFileExtension('document.PDF')).toBe(true)
      expect(isValidFileExtension('document.Pdf')).toBe(true)
    })
  })

  describe('isValidMimeType', () => {
    test('accepts valid mime types', () => {
      expect(isValidMimeType('application/pdf')).toBe(true)
      expect(isValidMimeType('text/plain')).toBe(true)
      expect(isValidMimeType('text/markdown')).toBe(true)
    })

    test('accepts empty mime type (some files lack it)', () => {
      expect(isValidMimeType('')).toBe(true)
    })

    test('rejects invalid mime types', () => {
      expect(isValidMimeType('image/gif')).toBe(false)
      expect(isValidMimeType('application/javascript')).toBe(false)
      expect(isValidMimeType('text/html')).toBe(false)
    })

    test('rejects image mime types by default (opt-in only, needs a VLM)', () => {
      expect(isValidMimeType('image/png')).toBe(false)
      expect(isValidMimeType('image/jpeg')).toBe(false)
    })
  })

  describe('createEmptyValidationContext', () => {
    test('creates empty context', () => {
      const context = createEmptyValidationContext()

      expect(context.existingTotalSize).toBe(0)
      expect(context.existingFileCount).toBe(0)
      expect(context.existingFileNames.size).toBe(0)
    })
  })

  describe('validateFileUpload', () => {
    describe('basic validation', () => {
      test('accepts valid files', () => {
        const files = [createFile('doc1.pdf'), createFile('doc2.txt')]

        const result = validateFileUpload(files)

        expect(result.valid).toBe(true)
        expect(result.validFiles).toHaveLength(2)
        expect(result.fileErrors).toHaveLength(0)
        expect(result.batchErrors).toHaveLength(0)
        expect(result.summary).toBeNull()
      })

      test('rejects invalid file types', () => {
        const files = [createFile('document.exe')]

        const result = validateFileUpload(files)

        expect(result.valid).toBe(false)
        expect(result.validFiles).toHaveLength(0)
        expect(result.fileErrors).toHaveLength(1)
        expect(result.fileErrors[0].code).toBe('INVALID_TYPE')
      })

      test('rejects oversized files', () => {
        const files = [createFile('large.pdf', MAX_FILE_SIZE + 1)]

        const result = validateFileUpload(files)

        expect(result.valid).toBe(false)
        expect(result.validFiles).toHaveLength(0)
        expect(result.fileErrors).toHaveLength(1)
        expect(result.fileErrors[0].code).toBe('FILE_TOO_LARGE')
      })

      test('punctuates the size with the caller-supplied locale', () => {
        const files = [createFile('large.pdf', MAX_FILE_SIZE + 500_000)]

        const german = validateFileUpload(files, createEmptyValidationContext(), undefined, 'de')
        const english = validateFileUpload(files, createEmptyValidationContext(), undefined, 'en-US')

        expect(german.fileErrors[0].message).toContain('100,5 MB')
        expect(english.fileErrors[0].message).toContain('100.5 MB')
        expect(german.fileErrors[0].message).toContain('100 MB')
        expect(english.fileErrors[0].message).toContain('100 MB')
      })
    })

    describe('duplicate detection', () => {
      test('detects duplicates within batch', () => {
        const files = [createFile('doc.pdf'), createFile('doc.pdf')]

        const result = validateFileUpload(files)

        expect(result.validFiles).toHaveLength(1)
        expect(result.fileErrors).toHaveLength(1)
        expect(result.fileErrors[0].code).toBe('DUPLICATE_FILE')
      })

      test('detects duplicates against existing session files', () => {
        const files = [createFile('existing.pdf')]
        const context: ValidationContext = {
          existingTotalSize: 1024,
          existingFileCount: 1,
          existingFileNames: new Set(['existing.pdf']),
        }

        const result = validateFileUpload(files, context)

        expect(result.validFiles).toHaveLength(0)
        expect(result.fileErrors).toHaveLength(1)
        expect(result.fileErrors[0].code).toBe('DUPLICATE_FILE')
        expect(result.fileErrors[0].message).toContain('already exists in this session')
      })

      test('never refuses a known name on a durable shelf — that is a new version, asked about elsewhere', () => {
        const context: ValidationContext = {
          existingTotalSize: 1024,
          existingFileCount: 1,
          existingFileNames: new Set(['existing.pdf']),
          durableCorpus: true,
        }

        const result = validateFileUpload([createFile('existing.pdf')], context)

        expect(result.fileErrors).toEqual([])
        expect(result.validFiles.map((file) => file.name)).toEqual(['existing.pdf'])
      })

      test('still refuses the same name twice in one batch on a durable shelf', () => {
        const context: ValidationContext = {
          existingTotalSize: 0,
          existingFileCount: 0,
          existingFileNames: new Set(),
          durableCorpus: true,
        }

        const result = validateFileUpload([createFile('a.pdf'), createFile('a.pdf')], context)

        expect(result.fileErrors[0].reason).toBe('duplicate-in-batch')
      })
    })

    describe('partial batch uploads (file-level errors allow other files)', () => {
      test('allows valid files when some have invalid types', () => {
        const files = [createFile('valid.pdf'), createFile('invalid.exe')]

        const result = validateFileUpload(files)

        expect(result.valid).toBe(false)
        expect(result.validFiles).toHaveLength(1)
        expect(result.validFiles[0].name).toBe('valid.pdf')
        expect(result.fileErrors).toHaveLength(1)
        expect(result.fileErrors[0].file.name).toBe('invalid.exe')
      })

      test('allows valid files when some are duplicates', () => {
        const files = [createFile('new.pdf'), createFile('existing.pdf')]
        const context: ValidationContext = {
          existingTotalSize: 1024,
          existingFileCount: 1,
          existingFileNames: new Set(['existing.pdf']),
        }

        const result = validateFileUpload(files, context)

        expect(result.valid).toBe(false)
        expect(result.validFiles).toHaveLength(1)
        expect(result.validFiles[0].name).toBe('new.pdf')
        expect(result.fileErrors).toHaveLength(1)
        expect(result.fileErrors[0].code).toBe('DUPLICATE_FILE')
      })

      test('allows valid files when some are oversized', () => {
        const files = [createFile('small.pdf', 1024), createFile('huge.pdf', MAX_FILE_SIZE + 1)]

        const result = validateFileUpload(files)

        expect(result.valid).toBe(false)
        expect(result.validFiles).toHaveLength(1)
        expect(result.validFiles[0].name).toBe('small.pdf')
        expect(result.fileErrors).toHaveLength(1)
        expect(result.fileErrors[0].code).toBe('FILE_TOO_LARGE')
      })

      test('handles multiple file-level errors in same batch', () => {
        const files = [
          createFile('valid.pdf'),
          createFile('invalid.exe'),
          createFile('duplicate.pdf'),
          createFile('duplicate.pdf'), // duplicate within batch
        ]

        const result = validateFileUpload(files)

        expect(result.validFiles).toHaveLength(2) // valid.pdf and first duplicate.pdf
        expect(result.fileErrors).toHaveLength(2) // invalid.exe and second duplicate.pdf
      })
    })

    describe('batch-level errors (block entire upload)', () => {
      test('blocks all files when max count exceeded', () => {
        const files = Array.from({ length: MAX_FILE_COUNT + 1 }, (_, i) => createFile(`doc${i}.pdf`))

        const result = validateFileUpload(files)

        expect(result.valid).toBe(false)
        expect(result.validFiles).toHaveLength(0)
        expect(result.batchErrors).toHaveLength(1)
        expect(result.batchErrors[0].code).toBe('MAX_FILES_EXCEEDED')
      })

      test('does not apply the session file cap to a durable project or Archiv corpus', () => {
        const files = [createFile('new.pdf')]
        const context: ValidationContext = {
          existingTotalSize: 1024,
          existingFileCount: MAX_FILE_COUNT,
          existingFileNames: new Set(),
          durableCorpus: true,
        }

        const result = validateFileUpload(files, context)

        expect(result.valid).toBe(true)
        expect(result.batchErrors).toHaveLength(0)
      })

      test('blocks all files when max count exceeded including existing', () => {
        const files = [createFile('new.pdf')]
        const context: ValidationContext = {
          existingTotalSize: 1024,
          existingFileCount: MAX_FILE_COUNT,
          existingFileNames: new Set(),
        }

        const result = validateFileUpload(files, context)

        expect(result.valid).toBe(false)
        expect(result.validFiles).toHaveLength(0)
        expect(result.batchErrors).toHaveLength(1)
        expect(result.batchErrors[0].code).toBe('MAX_FILES_EXCEEDED')
      })

      test('batch errors take precedence over file errors', () => {
        const files = [
          ...Array.from({ length: MAX_FILE_COUNT + 1 }, (_, i) => createFile(`doc${i}.pdf`)),
          createFile('invalid.exe'), // This file-level error doesn't matter - batch error wins
        ]

        const result = validateFileUpload(files)

        expect(result.validFiles).toHaveLength(0) // Batch error blocks all
        expect(result.batchErrors).toHaveLength(1)
        expect(result.batchErrors[0].code).toBe('MAX_FILES_EXCEEDED')
        expect(result.fileErrors).toHaveLength(1) // File error is still recorded
      })
    })

    describe('summary generation', () => {
      test('generates summary for single file error', () => {
        const files = [createFile('invalid.exe')]

        const result = validateFileUpload(files)

        expect(result.summary).toContain('invalid.exe')
        expect(result.summary).toContain('not a supported file type')
      })

      test('generates summary for multiple file errors', () => {
        const files = [createFile('a.exe'), createFile('b.zip')]

        const result = validateFileUpload(files)

        expect(result.summary).toContain('2 files have issues')
      })

      test('generates summary for batch errors', () => {
        const files = Array.from({ length: MAX_FILE_COUNT + 1 }, (_, i) => createFile(`doc${i}.pdf`))

        const result = validateFileUpload(files)

        expect(result.summary).toContain('file limit')
      })

      test('no summary for valid batch', () => {
        const files = [createFile('valid.pdf')]

        const result = validateFileUpload(files)

        expect(result.summary).toBeNull()
      })
    })

    describe('custom configuration', () => {
      test('uses custom accepted file types from config', () => {
        const customConfig = {
          acceptedTypes: '.csv,.json',
          acceptedMimeTypes: ['text/csv', 'application/json'],
          maxTotalSizeMB: 100,
          maxFileSize: 100 * 1024 * 1024,
          maxIfcFileSize: 0,
          maxTotalSize: 100 * 1024 * 1024,
          maxFileCount: 10,
          fileExpirationCheckIntervalHours: 0,
        }

        expect(isValidFileExtension('data.csv', customConfig)).toBe(true)
        expect(isValidFileExtension('config.json', customConfig)).toBe(true)

        expect(isValidFileExtension('document.pdf', customConfig)).toBe(false)
      })

      test('uses custom MIME types from config', () => {
        const customConfig = {
          acceptedTypes: '.csv,.json',
          acceptedMimeTypes: ['text/csv', 'application/json'],
          maxTotalSizeMB: 100,
          maxFileSize: 100 * 1024 * 1024,
          maxIfcFileSize: 0,
          maxTotalSize: 100 * 1024 * 1024,
          maxFileCount: 10,
          fileExpirationCheckIntervalHours: 0,
        }

        expect(isValidMimeType('text/csv', customConfig)).toBe(true)
        expect(isValidMimeType('application/json', customConfig)).toBe(true)
        expect(isValidMimeType('application/pdf', customConfig)).toBe(false)
      })

      test('uses custom max file size from config', () => {
        const smallSizeConfig = {
          acceptedTypes: '.pdf,.txt',
          acceptedMimeTypes: ['application/pdf', 'text/plain'],
          maxTotalSizeMB: 1,
          maxFileSize: 1 * 1024 * 1024, // 1MB limit
          maxIfcFileSize: 0,
          maxTotalSize: 1 * 1024 * 1024,
          maxFileCount: 10,
          fileExpirationCheckIntervalHours: 0,
        }

        const smallFile = createFile('small.pdf', 500 * 1024)
        const smallResult = validateFileUpload([smallFile], createEmptyValidationContext(), smallSizeConfig)
        expect(smallResult.valid).toBe(true)

        const largeFile = createFile('large.pdf', 2 * 1024 * 1024)
        const largeResult = validateFileUpload([largeFile], createEmptyValidationContext(), smallSizeConfig)
        expect(largeResult.valid).toBe(false)
        expect(largeResult.fileErrors[0].code).toBe('FILE_TOO_LARGE')
      })

      test('uses custom max file count from config', () => {
        const limitedConfig = {
          acceptedTypes: '.pdf,.txt',
          acceptedMimeTypes: ['application/pdf', 'text/plain'],
          maxTotalSizeMB: 100,
          maxFileSize: 100 * 1024 * 1024,
          maxIfcFileSize: 0,
          maxTotalSize: 100 * 1024 * 1024,
          maxFileCount: 3, // Only 3 files allowed
          fileExpirationCheckIntervalHours: 0,
        }

        const threeFiles = [createFile('a.pdf'), createFile('b.pdf'), createFile('c.pdf')]
        const passResult = validateFileUpload(threeFiles, createEmptyValidationContext(), limitedConfig)
        expect(passResult.valid).toBe(true)
        expect(passResult.validFiles).toHaveLength(3)

        const fourFiles = [createFile('a.pdf'), createFile('b.pdf'), createFile('c.pdf'), createFile('d.pdf')]
        const failResult = validateFileUpload(fourFiles, createEmptyValidationContext(), limitedConfig)
        expect(failResult.valid).toBe(false)
        expect(failResult.batchErrors[0].code).toBe('MAX_FILES_EXCEEDED')
      })

      test('uses custom total size limit from config', () => {
        const smallTotalConfig = {
          acceptedTypes: '.pdf,.txt',
          acceptedMimeTypes: ['application/pdf', 'text/plain'],
          maxTotalSizeMB: 1,
          maxFileSize: 100 * 1024 * 1024, // Individual files can be large
          maxIfcFileSize: 0,
          maxTotalSize: 1 * 1024 * 1024, // But total is limited to 1MB
          maxFileCount: 10,
          fileExpirationCheckIntervalHours: 0,
        }

        const smallFiles = [createFile('a.pdf', 400 * 1024), createFile('b.pdf', 400 * 1024)]
        const passResult = validateFileUpload(smallFiles, createEmptyValidationContext(), smallTotalConfig)
        expect(passResult.valid).toBe(true)

        const largeFiles = [createFile('a.pdf', 600 * 1024), createFile('b.pdf', 600 * 1024)]
        const failResult = validateFileUpload(largeFiles, createEmptyValidationContext(), smallTotalConfig)
        expect(failResult.valid).toBe(false)
        expect(failResult.batchErrors[0].code).toBe('TOTAL_SIZE_EXCEEDED')
      })

      test('validateFileUpload rejects files not in custom accepted types', () => {
        const customConfig = {
          acceptedTypes: '.csv,.json',
          acceptedMimeTypes: ['text/csv', 'application/json'],
          maxTotalSizeMB: 100,
          maxFileSize: 100 * 1024 * 1024,
          maxIfcFileSize: 0,
          maxTotalSize: 100 * 1024 * 1024,
          maxFileCount: 10,
          fileExpirationCheckIntervalHours: 0,
        }

        const files = [createFile('data.pdf')]
        const result = validateFileUpload(files, createEmptyValidationContext(), customConfig)

        expect(result.valid).toBe(false)
        expect(result.fileErrors[0].code).toBe('INVALID_TYPE')
        expect(result.fileErrors[0].message).toContain('.csv,.json')
      })
    })

    describe('image rejected due to missing VLM (flag on, capability off)', () => {
      const nonImageConfig = {
        acceptedTypes: '.pdf,.docx,.txt,.md',
        acceptedMimeTypes: ['application/pdf'],
        maxTotalSizeMB: 100,
        maxFileSize: 100 * 1024 * 1024,
        maxIfcFileSize: 0,
        maxTotalSize: 100 * 1024 * 1024,
        maxFileCount: 10,
        fileExpirationCheckIntervalHours: 0,
      }

      test('tags an image rejection with reason image-vlm-unavailable when blocked by VLM', () => {
        const config = { ...nonImageConfig, imageUploadBlockedReason: 'vlm-unavailable' as const }
        const result = validateFileUpload([createFile('photo.png')], createEmptyValidationContext(), config)

        expect(result.fileErrors[0].code).toBe('INVALID_TYPE')
        expect(result.fileErrors[0].reason).toBe('image-vlm-unavailable')
      })

      test('does NOT tag a non-image rejection even when images are VLM-blocked', () => {
        const config = { ...nonImageConfig, imageUploadBlockedReason: 'vlm-unavailable' as const }
        const result = validateFileUpload([createFile('malware.exe')], createEmptyValidationContext(), config)

        expect(result.fileErrors[0].code).toBe('INVALID_TYPE')
        expect(result.fileErrors[0].reason).toBeUndefined()
      })

      test('does NOT tag an image rejection when the block is not VLM-related', () => {
        const config = { ...nonImageConfig, imageUploadBlockedReason: null }
        const result = validateFileUpload([createFile('photo.png')], createEmptyValidationContext(), config)

        expect(result.fileErrors[0].code).toBe('INVALID_TYPE')
        expect(result.fileErrors[0].reason).toBeUndefined()
      })
    })
  })
})

describe('a building model is not measured against the document limit', () => {
  const config = {
    acceptedTypes: '.pdf,.ifc',
    acceptedMimeTypes: ['application/pdf', 'application/octet-stream'],
    maxTotalSizeMB: 100,
    maxFileSize: 100 * 1024 * 1024,
    maxIfcFileSize: 250 * 1024 * 1024,
    maxTotalSize: 250 * 1024 * 1024,
    maxFileCount: 10,
    fileExpirationCheckIntervalHours: 0,
  }
  const file = (name: string, bytes: number): File => {
    const f = new File(['x'], name)
    Object.defineProperty(f, 'size', { value: bytes })
    return f
  }

  test('admits a 150 MB .ifc that exceeds the document limit', () => {
    const result = validateFileUpload([file('Lacknergasse-98.ifc', 150 * 1024 * 1024)], undefined, config)

    expect(result.fileErrors).toEqual([])
    expect(result.batchErrors).toEqual([])
    expect(result.validFiles).toHaveLength(1)
  })

  test('still refuses a .ifc past the IFC ceiling', () => {
    const result = validateFileUpload([file('federated.ifc', 300 * 1024 * 1024)], undefined, config)

    expect(result.fileErrors[0].code).toBe('FILE_TOO_LARGE')
  })

  test('leaves the document limit alone for everything else', () => {
    const result = validateFileUpload([file('Einreichplan.pdf', 150 * 1024 * 1024)], undefined, config)

    expect(result.fileErrors[0].code).toBe('FILE_TOO_LARGE')
  })

  test('a batch carrying a model gets the IFC total, not the document one', () => {
    const batch = validateFileUpload([file('Lacknergasse-98.ifc', 150 * 1024 * 1024)], undefined, {
      ...config,
      maxTotalSize: 100 * 1024 * 1024,
    })

    expect(batch.batchErrors).toEqual([])
  })

  test('a batch of ordinary documents keeps the document total', () => {
    const batch = validateFileUpload(
      [file('a.pdf', 40 * 1024 * 1024), file('b.pdf', 40 * 1024 * 1024), file('c.pdf', 40 * 1024 * 1024)],
      undefined,
      { ...config, maxTotalSize: 100 * 1024 * 1024 }
    )

    expect(batch.batchErrors[0].code).toBe('TOTAL_SIZE_EXCEEDED')
  })
})

describe('a model already in the session keeps the IFC ceiling', () => {
  const config = {
    acceptedTypes: '.pdf,.ifc',
    acceptedMimeTypes: ['application/pdf', 'application/octet-stream'],
    maxTotalSizeMB: 100,
    maxFileSize: 100 * 1024 * 1024,
    maxIfcFileSize: 250 * 1024 * 1024,
    maxTotalSize: 100 * 1024 * 1024,
    maxFileCount: 10,
    fileExpirationCheckIntervalHours: 0,
  }
  const file = (name: string, bytes: number): File => {
    const f = new File(['x'], name)
    Object.defineProperty(f, 'size', { value: bytes })
    return f
  }
  const sessionWithModel = () => ({
    existingTotalSize: Math.round(149.3 * 1024 * 1024),
    existingFileCount: 1,
    existingFileNames: new Set(['2026-02-17_WB_Lacknergasse-98.ifc']),
  })

  test('adding a small document alongside it is not refused', () => {
    const result = validateFileUpload([file('Einreichplan.pdf', 2 * 1024 * 1024)], sessionWithModel(), config)

    expect(result.batchErrors).toEqual([])
    expect(result.validFiles).toHaveLength(1)
  })

  test('re-dropping the model reports the duplicate, not a phantom size failure', () => {
    const result = validateFileUpload(
      [file('2026-02-17_WB_Lacknergasse-98.ifc', Math.round(149.3 * 1024 * 1024))],
      sessionWithModel(),
      config
    )

    expect(result.fileErrors[0].code).toBe('DUPLICATE_FILE')
    expect(result.batchErrors).toEqual([])
  })

  test('the IFC ceiling still bounds the session', () => {
    const result = validateFileUpload([file('zweiter-stand.ifc', 120 * 1024 * 1024)], sessionWithModel(), config)

    expect(result.batchErrors[0].code).toBe('TOTAL_SIZE_EXCEEDED')
  })
})

describe('the batch caps are the session\'s, not the corpus\'s', () => {
  const bigFile = (name: string, mb: number) =>
    ({ name, size: mb * 1024 * 1024, type: 'application/pdf' }) as unknown as File

  const context = (durableCorpus: boolean) => ({
    existingFileCount: 0,
    existingTotalSize: 0,
    existingFileNames: new Set<string>(),
    durableCorpus,
  })

  test('does not apply the 100 MB batch ceiling to a project or Archiv upload', () => {
    const files = [bigFile('a.pdf', 40), bigFile('b.pdf', 40), bigFile('c.pdf', 40)]

    const result = validateFileUpload(files, context(true))

    expect(result.batchErrors.some((e) => e.code === 'TOTAL_SIZE_EXCEEDED')).toBe(false)
  })

  test('still applies it to a chat session, which has no quota behind it', () => {
    const files = [bigFile('a.pdf', 40), bigFile('b.pdf', 40), bigFile('c.pdf', 40)]

    const result = validateFileUpload(files, context(false))

    expect(result.batchErrors.some((e) => e.code === 'TOTAL_SIZE_EXCEEDED')).toBe(true)
  })

  test('keeps the PER-FILE limit on both, because that is about the file', () => {
    const result = validateFileUpload([bigFile('huge.pdf', 5000)], context(true))

    expect(result.validFiles).toHaveLength(0)
  })
})

describe('a dragged zip', () => {
  const dragOf = (type: string): DataTransfer =>
    ({ items: [{ kind: 'file', type }] }) as unknown as DataTransfer

  test('is unsupported in a chat, where an archive is not a document', () => {
    expect(checkDraggedFilesSupported(dragOf('application/zip'))).toBe(false)
  })

  test.each(['application/zip', 'application/x-zip-compressed', 'APPLICATION/ZIP'])(
    'is welcome on a shelf that unpacks it (%s)',
    (type) => {
      expect(checkDraggedFilesSupported(dragOf(type), undefined, { allowZip: true })).toBe(true)
    }
  )

  test('does not make everything else welcome', () => {
    expect(
      checkDraggedFilesSupported(dragOf('application/x-msdownload'), undefined, { allowZip: true })
    ).toBe(false)
  })
})
