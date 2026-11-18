// @disk-inputs: app/**, bff/**, i18n.ts, i18n.tsx, i18n/**, shared/**, test-utils.ts, test-utils.tsx, tests/fixtures/backend-tools.schema.json.ts, tests/fixtures/backend-tools.schema.json.tsx, tests/fixtures/backend-tools.schema.json/index.ts, tests/fixtures/backend-tools.schema.json/index.tsx, tests/mocks/server.ts, tests/test-utils/index.ts, tests/test-utils/index.tsx, types/**, ui/**, utils/**, workers/app-database.js.ts, workers/app-database.js.tsx, workers/app-database.js/index.ts, workers/app-database.js/index.tsx, workers/database-unavailable.js.ts, workers/database-unavailable.js.tsx, workers/database-unavailable.js/index.ts, workers/database-unavailable.js/index.tsx, workers/job-queue.js.ts, workers/job-queue.js.tsx, workers/job-queue.js/index.ts, workers/job-queue.js/index.tsx, workers/langfuse-traces.js.ts, workers/langfuse-traces.js.tsx, workers/langfuse-traces.js/index.ts, workers/langfuse-traces.js/index.tsx, workers/maintenance-sql.js.ts, workers/maintenance-sql.js.tsx, workers/maintenance-sql.js/index.ts, workers/maintenance-sql.js/index.tsx
/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { parseSourceText } from '@/test-utils/source-ast'
import { DOWNLOAD_LOG_KINDS } from './kinds'
import {
  CALLERS,
  FILES,
  OBJECT_READERS,
  accessCheckedFirst,
  functionsInSource,
} from './coverage.fixtures'

const functionsIn = (rel: string, text: string) => functionsInSource(parseSourceText(text, rel))

const PINNED_HELPERS: Record<string, { callers: readonly string[]; reason: string }> = {
  'lib/documents/version-content.ts::readObjectText': {
    callers: ['fetchVersionText', 'readVersionForService'],
    reason:
      'fetchVersionText is wrapped by readVersionContent (records) and readVersionTextForTask (the revision task: the text goes to the model, not to the reviewer); readVersionForService serves the agent.',
  },
  'lib/documents/version-content.ts::fetchVersionText': {
    callers: ['readVersionContent', 'readVersionTextForTask'],
    reason: 'readVersionContent records the hand-over; readVersionTextForTask feeds an agent task and is exempt.',
  },
}

describe('download log coverage: object readers', () => {
  it('finds the source (a broken walk would make every check vacuous)', () => {
    expect(FILES.length).toBeGreaterThan(500)
    expect(CALLERS.some((fn) => fn.key === 'lib/documents/document-delivery.ts::getDocumentDownload')).toBe(true)
  })

  it('classifies every function that builds an object read or presign, and every function that records', () => {
    const found = CALLERS.filter((fn) => fn.buildsObjectRead || fn.callsRecord).map((fn) => fn.key).sort()
    expect(
      found,
      'A function now reads or presigns an object (or records a hand-over) and is not in OBJECT_READERS. ' +
        'If a person receives the bytes, call recordDocumentAccess before they leave and list it as logged; ' +
        'if not, list it as exempt with the reason.'
    ).toEqual(Object.keys(OBJECT_READERS).sort())
  })

  it('every logged function records exactly the kinds it declares, and every kind is known', () => {
    for (const [key, disposition] of Object.entries(OBJECT_READERS)) {
      if (!('logged' in disposition)) continue
      const fn = CALLERS.find((candidate) => candidate.key === key)
      expect([...new Set(fn?.recordedKinds)].sort(), key).toEqual([...disposition.logged].sort())
      for (const kind of disposition.logged) expect(DOWNLOAD_LOG_KINDS, key).toContain(kind)
    }
  })

  it('no exempt function records (an exemption that records is a mislabelled one)', () => {
    for (const [key, disposition] of Object.entries(OBJECT_READERS)) {
      if (!('exempt' in disposition)) continue
      expect(CALLERS.find((fn) => fn.key === key)?.callsRecord, key).toBe(false)
      expect(disposition.exempt.length, key).toBeGreaterThan(20)
    }
  })

  it('every pinned helper has exactly the callers it lists', () => {
    for (const [key, pin] of Object.entries(PINNED_HELPERS)) {
      const [file, helper] = key.split('::')
      const callers = CALLERS.filter((fn) => fn.file === file && fn.name !== helper && fn.identifiers.has(helper))
        .map((fn) => fn.name)
        .sort()
      expect(callers, `${key}: ${pin.reason}`).toEqual([...pin.callers].sort())
    }
  })

  it('every logged function asks getAccessibleDocument before it reads, presigns or records', () => {
    const checked = accessCheckedFirst(CALLERS)
    const logged = Object.entries(OBJECT_READERS)
      .filter(([, disposition]) => 'logged' in disposition)
      .map(([key]) => key)
    expect(
      logged.filter((key) => !checked.has(key)),
      'A function records a hand-over without first asking getAccessibleDocument (itself or through a function ' +
        'that does). That call is the one access decision for a document; authorize through it before the bytes move.'
    ).toEqual([])
  })

  it('the access-check order is read from the code, not assumed (it fails a reader that checks late or elsewhere)', () => {
    const functions = functionsIn(
      'lib/example.ts',
      `
      import { getAccessibleDocument } from '@/lib/documents/access'
      import { recordDocumentAccess } from '@/lib/download-log/service'
      import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
      async function load(session, id) { return getAccessibleDocument(session, id) }
      export async function viaHelper(session, id) { const doc = await load(session, id); await recordDocumentAccess(session, doc, 'download') }
      export async function direct(session, id) { const doc = await getAccessibleDocument(session, id); await getSignedUrl(s3, new GetObjectCommand({ Key: doc.storageKey })) }
      export async function late(session, id) { const url = await getSignedUrl(s3, new GetObjectCommand({})); await getAccessibleDocument(session, id); return url }
      export async function elsewhere(session, id) { await getAccessibleModel(session, id); await recordDocumentAccess(session, null, 'model') }
      export async function nested(session, id) { await recordDocumentAccess(session, await getAccessibleDocument(session, id), 'pdf') }
      export async function inCondition(session, id) { if (!(await getAccessibleDocument(session, id))) throw new Error(); await recordDocumentAccess(session, null, 'pdf') }
      `
    )
    const checked = accessCheckedFirst(functions)
    const key = (name: string) => `lib/example.ts::${name}`
    expect(['load', 'viaHelper', 'direct', 'nested', 'inCondition'].filter((name) => !checked.has(key(name)))).toEqual([])
    expect(['late', 'elsewhere'].filter((name) => checked.has(key(name)))).toEqual([])
  })

  it('resolves a call to the function it names, so a same-named check elsewhere in src or a method on another object does not count', () => {
    const functions = [
      ...functionsIn(
        'lib/other.ts',
        `
        import { getAccessibleDocument } from '@/lib/documents/access'
        export async function load(session, id) { return getAccessibleDocument(session, id) }
        `
      ),
      ...functionsIn(
        'lib/example.ts',
        `
        import { recordDocumentAccess } from '@/lib/download-log/service'
        import * as other from './other'
        import { load as checkedLoad } from './other'
        async function load(session, id) { return cache.get(id) }
        export async function sameName(session, id) { await load(session, id); await recordDocumentAccess(session, null, 'pdf') }
        export async function method(session, id) { await store.load(session, id); await recordDocumentAccess(session, null, 'pdf') }
        export async function imported(session, id) { const doc = await checkedLoad(session, id); await recordDocumentAccess(session, doc, 'pdf') }
        export async function namespace(session, id) { const doc = await other.load(session, id); await recordDocumentAccess(session, doc, 'pdf') }
        `
      ),
    ]
    const checked = accessCheckedFirst(functions)
    const key = (name: string) => `lib/example.ts::${name}`
    expect(['sameName', 'method'].filter((name) => checked.has(key(name)))).toEqual([])
    expect(['imported', 'namespace'].filter((name) => !checked.has(key(name)))).toEqual([])
  })

  it('counts a check only on the path every call takes: not under a branch, in a swallowing try, or in a callback', () => {
    const functions = functionsIn(
      'lib/example.ts',
      `
      import { getAccessibleDocument } from '@/lib/documents/access'
      import { recordDocumentAccess } from '@/lib/download-log/service'
      export async function guarded(session, id) { if (!cached) await getAccessibleDocument(session, id); await recordDocumentAccess(session, null, 'pdf') }
      export async function ternary(session, id) { const doc = cached ? cached : await getAccessibleDocument(session, id); await recordDocumentAccess(session, doc, 'pdf') }
      export async function shortCircuit(session, id) { const doc = cached ?? (await getAccessibleDocument(session, id)); await recordDocumentAccess(session, doc, 'pdf') }
      export async function swallowed(session, id) { try { await getAccessibleDocument(session, id) } catch {} await recordDocumentAccess(session, null, 'pdf') }
      export async function callback(session, ids) { ids.forEach((id) => getAccessibleDocument(session, id)); await recordDocumentAccess(session, null, 'pdf') }
      export async function finallyOnly(session, id) { let doc; try { doc = await getAccessibleDocument(session, id) } finally { done() } await recordDocumentAccess(session, doc, 'pdf') }
      export async function thenUnconditional(session, id) { if (x) await getAccessibleDocument(session, id); const doc = await getAccessibleDocument(session, id); await recordDocumentAccess(session, doc, 'pdf') }
      `
    )
    const checked = accessCheckedFirst(functions)
    const key = (name: string) => `lib/example.ts::${name}`
    expect(
      ['guarded', 'ternary', 'shortCircuit', 'swallowed', 'callback'].filter((name) => checked.has(key(name)))
    ).toEqual([])
    expect(['finallyOnly', 'thenUnconditional'].filter((name) => !checked.has(key(name)))).toEqual([])
  })

  it('counts no check whose result is thrown away or whose refusal is caught', () => {
    const functions = functionsIn(
      'lib/example.ts',
      `
      import { getAccessibleDocument } from '@/lib/documents/access'
      import { recordDocumentAccess } from '@/lib/download-log/service'
      export async function statement(session, id, other) { await getAccessibleDocument(session, id); await recordDocumentAccess(session, other, 'pdf') }
      export async function voided(session, id, other) { void getAccessibleDocument(session, id); await recordDocumentAccess(session, other, 'pdf') }
      export async function comma(session, id, other) { const doc = (await getAccessibleDocument(session, id), other); await recordDocumentAccess(session, doc, 'pdf') }
      export async function unread(session, id, other) { const doc = await getAccessibleDocument(session, id); await recordDocumentAccess(session, other, 'pdf') }
      export async function caught(session, id) { const doc = await getAccessibleDocument(session, id).catch(() => null); await recordDocumentAccess(session, doc, 'pdf') }
      export async function rejectionHandled(session, id) { const doc = await getAccessibleDocument(session, id).then((found) => found, () => null); await recordDocumentAccess(session, doc, 'pdf') }
      export async function read(session, id) { const doc = await getAccessibleDocument(session, id); await recordDocumentAccess(session, doc, 'pdf') }
      export async function destructured(session, id) { const { folderId } = await getAccessibleDocument(session, id); await recordDocumentAccess(session, { folderId }, 'pdf') }
      export async function chained(session, id) { const doc = await getAccessibleDocument(session, id).then((found) => found); await recordDocumentAccess(session, doc, 'pdf') }
      export async function caughtDownChain(session, id) { const doc = await getAccessibleDocument(session, id).then((found) => found).catch(() => null); await recordDocumentAccess(session, doc, 'pdf') }
      export async function caughtAfterFinally(session, id) { const doc = await getAccessibleDocument(session, id).finally(done).then((found) => found).catch(() => null); await recordDocumentAccess(session, doc, 'pdf') }
      export async function caughtByElement(session, id) { const doc = await getAccessibleDocument(session, id).then((found) => found)['catch'](() => null); await recordDocumentAccess(session, doc, 'pdf') }
      export async function chainAsStatement(session, id, other) { await getAccessibleDocument(session, id).then((found) => found); await recordDocumentAccess(session, other, 'pdf') }
      export async function finallyRead(session, id) { const doc = await getAccessibleDocument(session, id).finally(done); await recordDocumentAccess(session, doc, 'pdf') }
      export async function caughtThroughName(session, id) { const pending = getAccessibleDocument(session, id); const doc = await pending.catch(() => null); await recordDocumentAccess(session, doc, 'pdf') }
      export async function caughtThroughTwoNames(session, id) { const pending = getAccessibleDocument(session, id); const again = pending; const doc = await again.then((found) => found, () => null); await recordDocumentAccess(session, doc, 'pdf') }
      export async function caughtByComputedName(session, id) { const doc = await getAccessibleDocument(session, id)[swallow](() => null); await recordDocumentAccess(session, doc, 'pdf') }
      export async function allSettled(session, id) { const [doc] = await Promise.allSettled([getAccessibleDocument(session, id)]); await recordDocumentAccess(session, doc, 'pdf') }
      export async function anyOf(session, id, other) { const doc = await Promise.any([getAccessibleDocument(session, id), other]); await recordDocumentAccess(session, doc, 'pdf') }
      export async function caughtAfterAll(session, id) { const [doc] = await Promise.all([getAccessibleDocument(session, id)]).catch(() => [null]); await recordDocumentAccess(session, doc, 'pdf') }
      export async function awaitedThroughName(session, id) { const pending = getAccessibleDocument(session, id); const doc = await pending; await recordDocumentAccess(session, doc, 'pdf') }
      export async function all(session, id, other) { const [doc] = await Promise.all([getAccessibleDocument(session, id), other]); await recordDocumentAccess(session, doc, 'pdf') }
      export async function fieldOfAnswer(session, id, key) { const field = (await getAccessibleDocument(session, id))[key]; await recordDocumentAccess(session, field, 'pdf') }
      `
    )
    const checked = accessCheckedFirst(functions)
    const key = (name: string) => `lib/example.ts::${name}`
    expect(
      [
        'statement',
        'voided',
        'comma',
        'unread',
        'caught',
        'rejectionHandled',
        'caughtDownChain',
        'caughtAfterFinally',
        'caughtByElement',
        'chainAsStatement',
        'caughtThroughName',
        'caughtThroughTwoNames',
        'caughtByComputedName',
        'allSettled',
        'anyOf',
        'caughtAfterAll',
      ].filter((name) => checked.has(key(name)))
    ).toEqual([])
    expect(
      ['read', 'destructured', 'chained', 'finallyRead', 'awaitedThroughName', 'all', 'fieldOfAnswer'].filter(
        (name) => !checked.has(key(name))
      )
    ).toEqual([])
  })

  it('reads each function a class expression, an object literal or a declarator list holds as its own unit, so one check covers no other', () => {
    const functions = functionsIn(
      'lib/example.ts',
      `
      import { getAccessibleDocument } from '@/lib/documents/access'
      import { recordDocumentAccess } from '@/lib/download-log/service'
      export const Reader = class {
        async load(session, id) { return getAccessibleDocument(session, id) }
        async serve(session, doc) { await recordDocumentAccess(session, doc, 'pdf') }
      }
      export const api = {
        async load(session, id) { return getAccessibleDocument(session, id) },
        serve: async (session, doc) => { await recordDocumentAccess(session, doc, 'pdf') },
        checked: async function (session, id) { const doc = await this.load(session, id); await recordDocumentAccess(session, doc, 'pdf') },
      }
      export const first = async (session, id) => getAccessibleDocument(session, id), second = async (session, doc) => { await recordDocumentAccess(session, doc, 'pdf') }
      export class Holder {
        static api = {
          async load(session, id) { return getAccessibleDocument(session, id) },
          async serve(session, doc) { await recordDocumentAccess(session, doc, 'pdf') },
        }
      }
      export default {
        async load(session, id) { return getAccessibleDocument(session, id) },
        async serve(session, doc) { await recordDocumentAccess(session, doc, 'pdf') },
      }
      export const wrapped = wrap({
        async load(session, id) { return getAccessibleDocument(session, id) },
        async serve(session, doc) { await recordDocumentAccess(session, doc, 'pdf') },
      })
      `
    )
    const recording = functions.filter((fn) => fn.callsRecord).map((fn) => fn.key.replace('lib/example.ts::', ''))
    expect(recording.sort()).toEqual(
      ['Holder.static api.serve', 'Reader.serve', 'api.checked', 'api.serve', 'default.serve', 'second', 'wrapped'].sort()
    )
    const checked = accessCheckedFirst(functions)
    expect(recording.filter((name) => checked.has(`lib/example.ts::${name}`))).toEqual(['api.checked'])
  })

  it('reads class methods, default exports and top-level code, so a byte step cannot sit where the walk does not look', () => {
    const functions = functionsIn(
      'lib/example.ts',
      `
      import { getAccessibleDocument } from '@/lib/documents/access'
      import { recordDocumentAccess } from '@/lib/download-log/service'
      import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
      export class Reader {
        async load(session, id) { return getAccessibleDocument(session, id) }
        async checked(session, id) { const doc = await this.load(session, id); await recordDocumentAccess(session, doc, 'pdf') }
        async unchecked(session, doc) { await recordDocumentAccess(session, doc, 'preview') }
        presign = async () => getSignedUrl(s3, new GetObjectCommand({}))
        static { getSignedUrl(s3, new GetObjectCommand({})) }
      }
      export default async function (session, doc) { await recordDocumentAccess(session, doc, 'download') }
      void getSignedUrl(s3, new GetObjectCommand({}))
      `
    )
    const byKey = new Map(functions.map((fn) => [fn.key.replace('lib/example.ts::', ''), fn]))
    expect(
      [...byKey].filter(([, fn]) => fn.callsRecord || fn.buildsObjectRead).map(([name]) => name).sort()
    ).toEqual([
      '(top level, line 13)',
      'Reader.(static block, line 10)',
      'Reader.checked',
      'Reader.presign',
      'Reader.unchecked',
      'default',
    ])
    expect(byKey.get('default')?.recordedKinds).toEqual(['download'])
    const checked = accessCheckedFirst(functions)
    expect(['Reader.checked'].filter((name) => !checked.has(`lib/example.ts::${name}`))).toEqual([])
    expect(['Reader.unchecked', 'default'].filter((name) => checked.has(`lib/example.ts::${name}`))).toEqual([])
  })

  it('reads a getter and a setter, and a static and an instance member, of one name as two units', () => {
    const functions = functionsIn(
      'lib/example.ts',
      `
      import { getAccessibleDocument } from '@/lib/documents/access'
      import { recordDocumentAccess } from '@/lib/download-log/service'
      export const api = {
        get doc() { return getAccessibleDocument(this.session, this.id) },
        set doc(value) { recordDocumentAccess(value.session, value.doc, 'pdf') },
      }
      export class Box {
        get doc() { return getAccessibleDocument(this.session, this.id) }
        set doc(value) { recordDocumentAccess(value.session, value.doc, 'pdf') }
      }
      export class Twin {
        static async load(session, id) { return getAccessibleDocument(session, id) }
        async load(session, id) { return cache.get(id) }
        static async serve(session, id) { const doc = await this.load(session, id); await recordDocumentAccess(session, doc, 'pdf') }
        async serve(session, id) { const doc = await this.load(session, id); await recordDocumentAccess(session, doc, 'pdf') }
      }
      export class Overloaded {
        load(session: Session, id: string): Promise<Doc>
        load(session: Session, id: number): Promise<Doc>
        load(session, id) { return getAccessibleDocument(session, id) }
      }
      `
    )
    const names = functions.map((fn) => fn.key.replace('lib/example.ts::', ''))
    expect(names.sort()).toEqual(
      [
        'api.get doc',
        'api.set doc',
        'Box.get doc',
        'Box.set doc',
        'Twin.static load',
        'Twin.load',
        'Twin.static serve',
        'Twin.serve',
        'Overloaded.load',
      ].sort()
    )
    const checked = accessCheckedFirst(functions)
    expect(
      ['api.set doc', 'Box.set doc', 'Twin.serve'].filter((name) => checked.has(`lib/example.ts::${name}`))
    ).toEqual([])
    expect(
      ['api.get doc', 'Box.get doc', 'Twin.static serve', 'Overloaded.load'].filter(
        (name) => !checked.has(`lib/example.ts::${name}`)
      )
    ).toEqual([])
  })

  it('refuses two units under one key, so a check in one never covers the other', () => {
    const functions = functionsIn(
      'lib/example.ts',
      `
      import { getAccessibleDocument } from '@/lib/documents/access'
      import { recordDocumentAccess } from '@/lib/download-log/service'
      export const twice = {
        async serve(session, id) { return getAccessibleDocument(session, id) },
        async serve(session, doc) { await recordDocumentAccess(session, doc, 'pdf') },
      }
      `
    )
    expect(() => accessCheckedFirst(functions)).toThrow(/twice\.serve/)
  })

  it('gives an arrow member the this of where it is written, not its object', () => {
    const functions = functionsIn(
      'lib/example.ts',
      `
      import { getAccessibleDocument } from '@/lib/documents/access'
      import { recordDocumentAccess } from '@/lib/download-log/service'
      export class Reader {
        async load(session, id) { return cache.get(id) }
        api = {
          load: (session, id) => getAccessibleDocument(session, id),
          serve: async (session, id) => { const doc = await this.load(session, id); await recordDocumentAccess(session, doc, 'pdf') },
          method: async function (session, id) { const doc = await this.load(session, id); await recordDocumentAccess(session, doc, 'pdf') },
        }
      }
      export class Holder {
        static async load(session, id) { return cache.get(id) }
        static api = {
          load: (session, id) => getAccessibleDocument(session, id),
          serve: async (session, id) => { const doc = await this.load(session, id); await recordDocumentAccess(session, doc, 'pdf') },
        }
      }
      export class Checked {
        async load(session, id) { return getAccessibleDocument(session, id) }
        api = { serve: async (session, id) => { const doc = await this.load(session, id); await recordDocumentAccess(session, doc, 'pdf') } }
      }
      export const top = {
        load: (session, id) => getAccessibleDocument(session, id),
        serve: async (session, id) => { const doc = await this.load(session, id); await recordDocumentAccess(session, doc, 'pdf') },
      }
      `
    )
    const checked = accessCheckedFirst(functions)
    const key = (name: string) => `lib/example.ts::${name}`
    expect(['Reader.api.serve', 'Holder.static api.serve', 'top.serve'].filter((name) => checked.has(key(name)))).toEqual([])
    expect(['Reader.api.method', 'Checked.api.serve'].filter((name) => !checked.has(key(name)))).toEqual([])
  })

  it('resolves a default import to the default export it names', () => {
    const functions = [
      ...functionsIn(
        'lib/other.ts',
        `
        import { getAccessibleDocument } from '@/lib/documents/access'
        export default async function (session, id) { return getAccessibleDocument(session, id) }
        `
      ),
      ...functionsIn(
        'lib/example.ts',
        `
        import { recordDocumentAccess } from '@/lib/download-log/service'
        import load from './other'
        export async function viaDefault(session, id) { const doc = await load(session, id); await recordDocumentAccess(session, doc, 'pdf') }
        `
      ),
    ]
    expect(accessCheckedFirst(functions).has('lib/example.ts::viaDefault')).toBe(true)
  })

  it('every kind the table logs is used, and every kind in the type is logged by someone', () => {
    const used = new Set(
      Object.values(OBJECT_READERS).flatMap((disposition) => ('logged' in disposition ? disposition.logged : []))
    )
    expect([...used].sort()).toEqual([...DOWNLOAD_LOG_KINDS].sort())
  })
})
