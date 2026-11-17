/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createZip } from './zip'

vi.mock('server-only', () => ({}))

interface StoredObject {
  key: string
  body: string
  contentType: string | undefined
  contentEncoding: string | undefined
  metadata: Record<string, string> | undefined
  byteLength: number | undefined
  raw: Uint8Array | undefined
}

const stored: StoredObject[] = []
const deleted: string[] = []
let sourceBytes = ''
let sourceBinary: Uint8Array | null = null
let putFailureSuffix: string | null = null
function failNextPutFor(suffix: string): void {
  putFailureSuffix = suffix
}

vi.mock('@/lib/s3', () => ({
  s3Client: {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const name = command.constructor.name
      const input = command.input
      if (name === 'GetObjectCommand') {
        return {
          Body: {
            transformToByteArray: async () =>
              sourceBinary ?? new TextEncoder().encode(sourceBytes),
          },
        }
      }
      if (name === 'PutObjectCommand') {
        if (putFailureSuffix && String(input.Key).endsWith(putFailureSuffix)) {
          putFailureSuffix = null
          throw new Error('store unavailable')
        }
        stored.push({
          key: String(input.Key),
          body: String(input.Body),
          contentType: input.ContentType as string | undefined,
          contentEncoding: input.ContentEncoding as string | undefined,
          metadata: input.Metadata as Record<string, string> | undefined,
          byteLength: (input.Body as Uint8Array | undefined)?.byteLength,
          raw: input.Body instanceof Uint8Array ? input.Body : undefined,
        })
        return {}
      }
      if (name === 'ListObjectsV2Command') {
        const prefix = String(input.Prefix)
        return { Contents: stored.filter((o) => o.key.startsWith(prefix)).map((o) => ({ Key: o.key })) }
      }
      if (name === 'DeleteObjectCommand') {
        deleted.push(String(input.Key))
        return {}
      }
      throw new Error(`unexpected command ${name}`)
    },
  },
}))

vi.mock('@/lib/storage/bucket', () => ({
  resolveDocumentBucket: (bucket: string | null) => bucket ?? 'grid-documents',
}))

const started: unknown[] = []
const completed: Array<{ run: unknown; elements: unknown[]; indexStorageKey: string | null }> = []
const failed: Array<{ modelId: string; runId: string; reason: string }> = []
let rowStillHeld = true

vi.mock('./extraction-repository', () => ({
  startBimModel: async (input: unknown) => {
    started.push(input)
    return { modelId: 'model-1', runId: 'run-1' }
  },
  completeBimModel: async (input: { run: unknown; elements: unknown[]; indexStorageKey: string | null }) => {
    completed.push(input)
    return rowStillHeld
  },
  failBimModel: async (run: { modelId: string; runId: string }, _org: string, reason: string) => {
    failed.push({ ...run, reason })
    return rowStillHeld
  },
}))

const { buildBimDerivedKeys, deleteBimDerivedObjects, runBimExtraction } = await import('./service')

const VALID_IFC = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('haus-a.ifc','2026-01-01T00:00:00',(''),(''),'t','t','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0GridServiceProject01',$,'Haus A',$,$,$,$,$,$);
#2=IFCBUILDINGSTOREY('0GridServiceStorey01',$,'Erdgeschoss',$,$,$,$,$,.ELEMENT.,0.);
#3=IFCWALL('0GridServiceWall00001',$,'Aussenwand',$,$,$,$,'W-1',.SOLIDWALL.);
#4=IFCRELCONTAINEDINSPATIALSTRUCTURE('0GridServiceCont0001',$,$,$,(#3),#2);
ENDSEC;
END-ISO-10303-21;
`

const STORAGE_KEY = 'org/org_1/project/p1/doc/d1/haus-a.ifc'

function baseInput(dispatchDigest = vi.fn(async () => undefined)) {
  return {
    organizationId: 'org_1',
    projectId: 'p1',
    documentId: 'd1',
    filename: 'haus-a.ifc',
    storageKey: STORAGE_KEY,
    storageBucket: null,
    dispatchDigest,
  }
}

beforeEach(() => {
  stored.length = 0
  deleted.length = 0
  started.length = 0
  completed.length = 0
  failed.length = 0
  rowStillHeld = true
  sourceBytes = VALID_IFC
  sourceBinary = null
  putFailureSuffix = null
})

describe('buildBimDerivedKeys', () => {
  it('keeps the original filename as the digest object’s last path segment', () => {
    expect(buildBimDerivedKeys(STORAGE_KEY)).toEqual({
      prefix: 'org/org_1/project/p1/doc/d1/_bim/',
      digestKey: 'org/org_1/project/p1/doc/d1/_bim/haus-a.ifc',
      indexKey: 'org/org_1/project/p1/doc/d1/_bim/index.json',
      sourceKey: 'org/org_1/project/p1/doc/d1/_bim/source.ifc.gz',
    })
  })

  it('refuses a key with no directory rather than writing to the bucket root', () => {
    expect(buildBimDerivedKeys('haus-a.ifc')).toBeNull()
    expect(buildBimDerivedKeys('some/dir/')).toBeNull()
  })
})

describe('runBimExtraction', () => {
  it('parses, persists and hands the digest to ingestion', async () => {
    const dispatchDigest = vi.fn(async () => undefined)
    const outcome = await runBimExtraction(baseInput(dispatchDigest))

    expect(outcome).toMatchObject({ modelId: 'model-1', status: 'ready', elementCount: 1 })
    expect(started[0]).toMatchObject({ organizationId: 'org_1', projectId: 'p1', documentId: 'd1' })
    expect(completed[0].elements).toHaveLength(1)
    expect(dispatchDigest).toHaveBeenCalledWith('org/org_1/project/p1/doc/d1/_bim/haus-a.ifc')
  })

  it('writes the digest as markdown so the backend reads it as text', async () => {
    await runBimExtraction(baseInput())

    const digest = stored.find((object) => object.key.endsWith('/_bim/haus-a.ifc'))
    expect(digest?.contentType).toBe('text/markdown; charset=utf-8')
    expect(digest?.body).toContain('# BIM-Modell: Haus A')

    const index = stored.find((object) => object.key.endsWith('/_bim/index.json'))
    expect(index?.contentType).toBe('application/json')
    expect(JSON.parse(index?.body ?? '{}')).toMatchObject({ schema: 'IFC4' })
  })

  it('records a failure instead of throwing when the bytes are not IFC', async () => {
    sourceBytes = 'this is not an IFC file'
    const dispatchDigest = vi.fn(async () => undefined)

    const outcome = await runBimExtraction(baseInput(dispatchDigest))

    expect(outcome.status).toBe('failed')
    expect(failed[0]).toMatchObject({ modelId: 'model-1', runId: 'run-1' })
    expect(failed[0].reason).toContain('keine gültige IFC-Datei')
    expect(completed).toHaveLength(0)
    expect(dispatchDigest).not.toHaveBeenCalled()
  })

  it('keeps the extraction when the ingest dispatch fails', async () => {
    const dispatchDigest = vi.fn(async () => {
      throw new Error('backend down')
    })

    const outcome = await runBimExtraction(baseInput(dispatchDigest))

    expect(outcome.status).toBe('ready')
    expect(completed).toHaveLength(1)
    expect(failed).toHaveLength(0)
  })

  it('finishes as the run that started, and hands no digest on once a newer run has the row', async () => {
    rowStillHeld = false
    const dispatchDigest = vi.fn(async () => undefined)

    const outcome = await runBimExtraction(baseInput(dispatchDigest))

    expect(completed[0].run).toEqual({ modelId: 'model-1', runId: 'run-1' })
    expect(outcome).toEqual({ modelId: 'model-1', status: 'superseded', elementCount: 0 })
    expect(dispatchDigest).not.toHaveBeenCalled()
    expect(failed).toHaveLength(0)
  })

  it('does not report a failure for a model a newer run has taken', async () => {
    sourceBytes = 'this is not an IFC file'
    rowStillHeld = false

    const outcome = await runBimExtraction(baseInput())

    expect(failed).toHaveLength(1)
    expect(outcome.status).toBe('superseded')
    expect(outcome.error).toBeUndefined()
  })
})

describe('deleteBimDerivedObjects', () => {
  it('removes everything under the model’s derived prefix', async () => {
    await runBimExtraction(baseInput())
    expect(stored).toHaveLength(3)

    await deleteBimDerivedObjects(STORAGE_KEY, null)

    expect(deleted.sort()).toEqual([
      'org/org_1/project/p1/doc/d1/_bim/haus-a.ifc',
      'org/org_1/project/p1/doc/d1/_bim/index.json',
      'org/org_1/project/p1/doc/d1/_bim/source.ifc.gz',
    ])
  })

  it('does nothing for a key with no directory', async () => {
    await deleteBimDerivedObjects('haus-a.ifc', null)
    expect(deleted).toEqual([])
  })
})

describe('the viewer’s compressed source', () => {
  it('is stored gzipped, smaller than the original, and says how big the original was', async () => {
    await runBimExtraction(baseInput())

    const gzip = stored.find((object) => object.key.endsWith('/source.ifc.gz'))
    expect(gzip).toBeDefined()
    expect(gzip?.contentEncoding).toBe('gzip')
    expect(Number(gzip?.metadata?.['uncompressed-length'])).toBeGreaterThan(0)
  })

  it('actually compresses — STEP is text, and this is the point of the object', async () => {
    await runBimExtraction(baseInput())

    const gzip = stored.find((object) => object.key.endsWith('/source.ifc.gz'))
    const original = Number(gzip?.metadata?.['uncompressed-length'])
    expect(gzip?.byteLength).toBeLessThan(original)
  })

  it('does not fail the extraction when the compressed write fails', async () => {
    failNextPutFor('/source.ifc.gz')

    const outcome = await runBimExtraction(baseInput())

    expect(outcome.status).toBe('ready')
  })

  it('holds the MODEL for a `.ifczip`, not the container', async () => {
    const archive = createZip([{ path: 'haus-a.ifc', content: VALID_IFC }])
    sourceBinary = archive

    const outcome = await runBimExtraction({ ...baseInput(), filename: 'haus-a.ifczip' })
    expect(outcome.status).toBe('ready')

    const gzip = stored.find((object) => object.key.endsWith('/source.ifc.gz'))
    const { gunzipSync } = await import('node:zlib')
    expect(gzip?.raw).toBeDefined()
    const written = gunzipSync(gzip?.raw as Uint8Array)
    expect(new TextDecoder().decode(written)).toBe(VALID_IFC)
    expect(Number(gzip?.metadata?.['uncompressed-length'])).toBe(
      new TextEncoder().encode(VALID_IFC).byteLength
    )
  })

  it('reports an archive refusal in its own words, not as "not a valid IFC file"', async () => {
    sourceBinary = createZip([
      { path: 'haus-a.ifc', content: VALID_IFC },
      { path: 'haus-b.ifc', content: VALID_IFC },
    ])

    const outcome = await runBimExtraction({ ...baseInput(), filename: 'beide.ifczip' })

    expect(outcome.status).toBe('failed')
    expect(failed[0].reason).toContain('IFC-Archiv')
    expect(failed[0].reason).toContain('exactly one')
    expect(completed).toHaveLength(0)
  })
})
