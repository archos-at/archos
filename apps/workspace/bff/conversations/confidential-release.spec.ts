/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('@/lib/audit/service', () => ({ recordAuditEventOrThrow: vi.fn() }))
vi.mock('@/lib/authz/folder-access', () => ({ customFolderNames: vi.fn() }))
vi.mock('@/lib/conversation-context/audience', () => ({ readConversationRow: vi.fn() }))
vi.mock('@/lib/organizations/confidential-release', () => ({ confidentialReleaseEnabled: vi.fn() }))
vi.mock('@/lib/agent-api/acting-session', () => ({ currentActingSession: vi.fn() }))
vi.mock('./restricted-use', () => ({
  ownersOf: vi.fn(),
  recordView: vi.fn(),
  stillRestricting: vi.fn(),
  unreadableSourcesOf: vi.fn(),
}))
vi.mock('./restricted-use-repository', () => ({
  listProjectNames: vi.fn(),
  listRecordedSourceFolders: vi.fn(),
  listRestrictingSourceProjects: vi.fn(),
}))

import { ConfidentialReleaseRequiredError, ConversationConfinedError } from '@/lib/api/errors'
import { recordAuditEventOrThrow } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import { customFolderNames } from '@/lib/authz/folder-access'
import { readConversationRow } from '@/lib/conversation-context/audience'
import { confidentialReleaseEnabled } from '@/lib/organizations/confidential-release'
import { currentActingSession } from '@/lib/agent-api/acting-session'
import { ownersOf, recordView, stillRestricting, unreadableSourcesOf } from './restricted-use'
import { listProjectNames, listRecordedSourceFolders, listRestrictingSourceProjects } from './restricted-use-repository'
import { filingReleaseOf, releaseConfidential } from './confidential-release'

const ORG = 'org_1'
const HERE = 'project_here'
const OTHER = 'project_other'
const session = { userId: 'user_me', email: 'me@office.example', organizationId: ORG } as AuthorizedSession
const refused = new ConversationConfinedError('filing', 'refused')
const destination = { organizationId: ORG, projectId: HERE, projectCollection: 'proj_here', folderId: 'open' }
const release = (confirmed: boolean) =>
  releaseConfidential({ session, confirmed }, 'conv_1', 'de', destination, refused)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(confidentialReleaseEnabled).mockResolvedValue(true)
  vi.mocked(unreadableSourcesOf).mockResolvedValue({ folders: new Set(), projects: new Set() })
  vi.mocked(listRecordedSourceFolders).mockResolvedValue(['f_contracts'])
  vi.mocked(listRestrictingSourceProjects).mockResolvedValue([OTHER])
  vi.mocked(readConversationRow).mockResolvedValue({ projectId: HERE } as Awaited<ReturnType<typeof readConversationRow>>)
  vi.mocked(recordView).mockResolvedValue({ tree: new Map(), ownerOf: new Map([['f_contracts', HERE]]) })
  vi.mocked(stillRestricting).mockReturnValue(['f_contracts'])
  vi.mocked(ownersOf).mockReturnValue([HERE])
  vi.mocked(customFolderNames).mockResolvedValue(new Map([['f_contracts', 'Verträge']]))
  vi.mocked(listProjectNames).mockResolvedValue(new Map([[HERE, 'Seestadt'], [OTHER, 'Wohnbau Nord']]))
})

describe('releaseConfidential', () => {
  it('asks the person to check, naming every confidential source, before anything is filed', async () => {
    const error = await release(false).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ConfidentialReleaseRequiredError)
    expect((error as ConfidentialReleaseRequiredError).sources).toEqual([
      { kind: 'folder', name: 'Verträge' },
      { kind: 'project', name: 'Wohnbau Nord' },
    ])
    expect(recordAuditEventOrThrow).not.toHaveBeenCalled()
  })

  it('files once the person confirmed, and records who released what into where', async () => {
    await expect(release(true)).resolves.toBeUndefined()
    expect(recordAuditEventOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'conversation.confidential_released',
        actor: { userId: 'user_me', email: 'me@office.example' },
        targetId: 'conv_1',
        metadata: { projectId: HERE, folderId: 'open', sourceFolders: 'f_contracts', sourceProjects: OTHER },
      }),
    )
  })

  it('refuses as before when the organization switched release off', async () => {
    vi.mocked(confidentialReleaseEnabled).mockResolvedValue(false)
    await expect(release(true)).rejects.toBe(refused)
    expect(recordAuditEventOrThrow).not.toHaveBeenCalled()
  })

  it('refuses a person who may no longer read every source, even confirmed', async () => {
    vi.mocked(unreadableSourcesOf).mockResolvedValue({ folders: new Set(['f_contracts']), projects: new Set() })
    await expect(release(true)).rejects.toBe(refused)
    vi.mocked(unreadableSourcesOf).mockResolvedValue({ folders: new Set(), projects: new Set([OTHER]) })
    await expect(release(true)).rejects.toBe(refused)
    expect(recordAuditEventOrThrow).not.toHaveBeenCalled()
  })

  it('names a restricted folder of another project with that project', async () => {
    vi.mocked(recordView).mockResolvedValue({ tree: new Map(), ownerOf: new Map([['f_contracts', OTHER]]) })
    vi.mocked(ownersOf).mockReturnValue([OTHER])
    vi.mocked(listRestrictingSourceProjects).mockResolvedValue([])
    const error = (await release(false).catch((caught: unknown) => caught)) as ConfidentialReleaseRequiredError
    expect(error.sources).toEqual([{ kind: 'folder', name: 'Verträge', project: 'Wohnbau Nord' }])
  })
})

describe('filingReleaseOf', () => {
  it('gives a person in the app a release that decides as they confirmed, and an agent acting for them none', async () => {
    vi.mocked(currentActingSession).mockReturnValue(undefined)
    await filingReleaseOf(session, true)?.lift('conv_1', 'de', destination, refused)
    expect(recordAuditEventOrThrow).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'conv_1' }))
    vi.mocked(currentActingSession).mockReturnValue(session)
    expect(filingReleaseOf(session, true)).toBeUndefined()
  })
})
