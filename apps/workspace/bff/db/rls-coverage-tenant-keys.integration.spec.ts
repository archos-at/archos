import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PLATFORM_ROLE } from './tenant-context'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL ?? ''
const STAMP = Date.now()
const ORG_LEGACY = `org_keys_legacy_${STAMP}`
const ORG_NEW = `org_keys_new_${STAMP}`
const USER_LEGACY = `user_keys_legacy_${STAMP}`
const USER_NEW = `user_keys_new_${STAMP}`
const CONVERSATION = `conv_keys_${STAMP}`

type Connection = postgres.TransactionSql<Record<string, never>>

class Rollback extends Error {}

describe.skipIf(!url)('tenant keys against live Postgres', () => {
  let client: ReturnType<typeof postgres>

  beforeAll(() => {
    client = postgres(url, { max: 1 })
  })

  afterAll(async () => {
    await client.end()
  })

  async function setSetting(tx: Connection, name: string, value: string): Promise<void> {
    await tx`select set_config(${name}, ${value}, true)`
  }

  async function asPlatform(tx: Connection): Promise<void> {
    await tx.unsafe(`set local role ${PLATFORM_ROLE}`)
  }

  async function rolledBack<T>(run: (tx: Connection) => Promise<T>): Promise<T> {
    let result: T | undefined
    await client
      .begin(async (tx) => {
        result = await run(tx)
        throw new Rollback('the test keeps no rows')
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error
      })
    return result as T
  }

  async function seedFolders(tx: Connection) {
    await asPlatform(tx)
    await tx`insert into organizations (workos_organization_id, display_name)
             values (${ORG_LEGACY}, ${ORG_LEGACY}) on conflict do nothing`
    const [projectA] = await tx`insert into projects (organization_id, name, created_by, collection_name)
                                values (${ORG_LEGACY}, 'project A', 'user_keys', ${'coll_a_' + STAMP}) returning id`
    const [projectB] = await tx`insert into projects (organization_id, name, created_by, collection_name)
                                values (${ORG_LEGACY}, 'project B', 'user_keys', ${'coll_b_' + STAMP}) returning id`
    const [folderA] = await tx`insert into project_folders (organization_id, scope, project_id, name, path)
                               values (${ORG_LEGACY}, 'project', ${projectA.id}, 'Plans', 'Plans') returning id`
    return { projectA: projectA.id, projectB: projectB.id, folderA: folderA.id }
  }

  it('reads the new setting names before the legacy ones', async () => {
    const [row] = await rolledBack(async (tx) => {
      await setSetting(tx, 'grid.organization_id', ORG_LEGACY)
      await setSetting(tx, 'app.organization_id', ORG_NEW)
      await setSetting(tx, 'grid.user_id', USER_LEGACY)
      await setSetting(tx, 'app.user_id', USER_NEW)
      return await tx`select current_org() as organization_id, current_user_id() as user_id`
    })
    expect(row).toEqual({ organization_id: ORG_NEW, user_id: USER_NEW })
  })

  it('still reads the legacy names when they are set alone', async () => {
    const [row] = await rolledBack(async (tx) => {
      await setSetting(tx, 'grid.organization_id', ORG_LEGACY)
      await setSetting(tx, 'grid.user_id', USER_LEGACY)
      return await tx`select current_org() as organization_id, current_user_id() as user_id`
    })
    expect(row).toEqual({ organization_id: ORG_LEGACY, user_id: USER_LEGACY })
  })

  it('defaults a message to the legacy organization when only the legacy setting is set', async () => {
    const [row] = await rolledBack(async (tx) => {
      await setSetting(tx, 'grid.organization_id', ORG_LEGACY)
      await tx`insert into conversations (id, organization_id, created_by)
               values (${CONVERSATION}, ${ORG_LEGACY}, 'user_keys')`
      return await tx`insert into messages (conversation_id, role, content)
                      values (${CONVERSATION}, 'user', 'legacy only') returning organization_id`
    })
    expect(row).toEqual({ organization_id: ORG_LEGACY })
  })

  it('refuses a message filed under another organization\'s conversation, even as the platform role', async () => {
    await expect(
      rolledBack(async (tx) => {
        await setSetting(tx, 'app.organization_id', ORG_LEGACY)
        await tx`insert into conversations (id, organization_id, created_by)
                 values (${CONVERSATION}, ${ORG_LEGACY}, 'user_keys')`
        await asPlatform(tx)
        await tx`insert into messages (conversation_id, organization_id, role, content)
                 values (${CONVERSATION}, ${ORG_NEW}, 'user', 'filed elsewhere')`
      })
    ).rejects.toThrow('messages_conversation_id_organization_id_fkey')
  })

  it('refuses a folder whose parent sits in another project, even as the platform role', async () => {
    await expect(
      rolledBack(async (tx) => {
        const { projectA, projectB, folderA } = await seedFolders(tx)
        await tx`insert into project_folders (organization_id, scope, project_id, parent_id, name, path)
                 values (${ORG_LEGACY}, 'project', ${projectA}, ${folderA}, 'child', 'Plans/child')`
        await tx`insert into project_folders (organization_id, scope, project_id, parent_id, name, path)
                 values (${ORG_LEGACY}, 'project', ${projectB}, ${folderA}, 'stray', 'Plans/stray')`
      })
    ).rejects.toThrow('project_folders_parent_id_project_id_fkey')
  })

  it('refuses a document filed in a folder of another project, even as the platform role', async () => {
    await expect(
      rolledBack(async (tx) => {
        const { projectA, projectB, folderA } = await seedFolders(tx)
        await tx`insert into documents (organization_id, project_id, scope, folder_id, filename, storage_key, collection_name, created_by, status)
                 values (${ORG_LEGACY}, ${projectA}, 'project', ${folderA}, 'plan.pdf', 'k/plan', ${'coll_a_' + STAMP}, 'user_keys', 'uploaded')`
        await tx`insert into documents (organization_id, project_id, scope, folder_id, filename, storage_key, collection_name, created_by, status)
                 values (${ORG_LEGACY}, ${projectB}, 'project', ${folderA}, 'stray.pdf', 'k/stray', ${'coll_b_' + STAMP}, 'user_keys', 'uploaded')`
      })
    ).rejects.toThrow('documents_folder_id_project_id_fkey')
  })
})
