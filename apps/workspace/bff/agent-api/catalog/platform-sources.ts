import { sourceCredentialBodySchema, sourceParamsSchema, sourceStatusQuerySchema, sourceTestBodySchema } from '@/lib/base-knowledge/platform/source-wire'
import type { AgentOperation, PersonConfirmation } from '../operation'

const IN_COUNTRIES_VIEW: PersonConfirmation = { decideAt: () => '/app/platform/countries' }

export const platformSourceOperations = [
  {
    name: 'platform-knowledge-source-test',
    domain: 'platform',
    summary: 'Test a public source: its recorded fixtures, and one live probe if asked',
    description:
      'Runs the source record’s recorded fixtures through its access type and engine with no live call (what KC-7 ' +
      'checks), and with `live: true` fetches its monitor probe once through the fetcher. Pass `changeRequestId` to ' +
      'test the source as that open request proposes it: its hosts are usable by that request alone, for 24 hours ' +
      'from the proposal. Without it, the published source. Nothing is stored. 404 for a key nothing registers. ' +
      'A fixture whose response names a capture is read from that capture; one that names none yet (`captureId: null`) ' +
      'is not run: `awaiting` lists the URLs to capture, and it is not `ok`.',
    method: 'POST',
    path: '/api/platform/knowledge/sources/[sourceKey]/test',
    params: sourceParamsSchema,
    body: sourceTestBodySchema,
    readOnly: true,
    examples: [{ params: { sourceKey: 'xa-gazette' }, body: { changeRequestId: '0b8f6d2e-6a51-4d6c-9a0e-4b2f9f1c2d3e', live: true } }],
    load: () => import('@/app/api/platform/knowledge/sources/[sourceKey]/test/route'),
  },
  {
    name: 'platform-knowledge-source-status',
    domain: 'platform',
    summary: 'Read every public source’s hosts, monitor, freshness lag and key state',
    description:
      'Every source there is, by `origin`: `built_in`, the product’s own sources (an engine’s configuration, reviewed ' +
      'as code; read-only here, with its recorded fixtures’ result in `fixtures`), and `record`, the platform’s ' +
      'published and proposed sources. Each host and whether it is active, testing (with when it expires) or expired; ' +
      'the monitor’s kind, last check, last success, failure and freshness lag in days; whether a key is set and its ' +
      'last four characters (never the key); and the open change request a monitor filed for it, if any. ' +
      '`builtInUnavailable` says why the built-in sources are missing when they could not be listed.',
    method: 'GET',
    path: '/api/platform/knowledge/sources',
    query: sourceStatusQuerySchema,
    load: () => import('@/app/api/platform/knowledge/sources/route'),
  },
  {
    name: 'platform-knowledge-source-credential-set',
    domain: 'platform',
    summary: 'Set the key a public source is fetched with (write-only)',
    description:
      'For a source whose terms issue a key; the record names the header it goes in (`credential`). Stored ' +
      'write-only: no operation returns it, only that a key is set and its last four characters; only the fetch ' +
      'attaches it, after every other header is stripped, on the source’s hosts. Replaces the previous key. The ' +
      'person’s own decision. Audited.',
    method: 'PUT',
    path: '/api/platform/knowledge/sources/[sourceKey]/credential',
    params: sourceParamsSchema,
    body: sourceCredentialBodySchema,
    personDecides: true,
    requiresPersonConfirmation: IN_COUNTRIES_VIEW,
    idempotent: true,
    load: () => import('@/app/api/platform/knowledge/sources/[sourceKey]/credential/route'),
  },
] as const satisfies readonly AgentOperation[]
