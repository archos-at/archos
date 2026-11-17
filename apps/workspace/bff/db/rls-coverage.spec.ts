// @disk-inputs: ../../deploy/compose/init-db.sql, ../../deploy/postgres/rename-legacy-names.sh, ../../scripts/rls-test-db.sh, migrations/*.sql

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Table, getTableName, is } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as schema from './schema'
import { ORGANIZATION_SETTING, PLATFORM_ROLE, USER_SETTING } from './tenant-context'

const BOUNDARY_MIGRATIONS = [
  '0031_row_level_security.sql',
  '0032_messages_organization_id.sql',
  '0034_bim_models.sql',
  '0035_bim_check_confirmations.sql',
  '0041_agent_skills.sql',
  '0042_drop_workflows.sql',
  '0043_jobs.sql',
  '0046_curated_skill_activations.sql',
  '0047_platform_skills.sql',
  '0051_file_native_ownership.sql',
   '0067_document_roles.sql',
  '0068_platform_lessons.sql',
  '0075_tasks.sql',
  '0079_pricing_and_credits.sql',
  '0082_document_versions.sql',
  '0086_task_definitions.sql',
  '0087_organization_instructions.sql',
  '0089_skill_categories.sql',
  '0100_product_feedback.sql',
  '0102_archiv_folders.sql',
  '0104_bff_job_queue.sql',
  '0110_upload_batches.sql',
  '0111_project_folder_grants.sql',
  '0112_conversation_restricted_folders.sql',
  '0114_document_access_log.sql',
  '0117_project_steckbrief.sql',
  '0119_document_quarantine_decisions.sql',
  '0124_message_restricted_use.sql',
  '0136_document_version_reviews.sql',
  '0108_mail_imports.sql',
  '0125_conversation_source_projects.sql',
  '0126_permit_records.sql',
  '0130_document_fassung_announcements.sql',
  '0138_document_annotations.sql',
  '0139_piloti_wakes.sql',
  '0140_proposed_changes.sql',
  '0142_piloti_changes.sql',
  '0144_project_intakes.sql',
  '0146_proposal_shelves.sql',
  '0147_push_subscriptions.sql',
  '0154_analytics_export_cursors.sql',
  '0158_project_upload_screening.sql',
  '0165_revision_names.sql',
  '0173_root_sort_runs.sql',
  '0179_piloti_asks.sql',
  '0180_folder_cards.sql',
  '0181_office_conventions.sql',
  '0182_office_convention_decisions.sql',
  '0185_document_search.sql',
  '0186_saved_searches.sql',
  '0189_agent_tables.sql',
  '0191_brand_free_policies.sql',
  '0196_inbound_mail.sql',
  '0202_base_knowledge.sql',
  '0203_residency.sql',
  '0204_rulesets.sql',
  '0205_platform_base_knowledge.sql',
  '0209_knowledge_citation_captures.sql',
  '0210_address_register.sql',
  '0211_country_pack.sql',
  '0212_country_onboarding_tooling.sql',
  '0213_knowledge_context.sql',
  '0214_knowledge_approve_alone.sql',
  '0226_drop_dead_scheduler_schema.sql',
  '0228_golden_cases.sql',
  '0229_personal_memory.sql',
]

const MIGRATION_SOURCES = BOUNDARY_MIGRATIONS.map((file) =>
  readFileSync(join(process.cwd(), 'migrations', file), 'utf8')
)

const MIGRATION = MIGRATION_SOURCES[0]

function declaredTables(): string[] {
  return (Object.values(schema) as unknown[])
    .filter((value): value is Table => is(value, Table))
    .map((table) => getTableName(table))
    .sort()
}

function securedTables(): { tenant: string[]; platform: string[] } {
  const collect = (fn: string) => {
    const seen = new Set<string>()
    for (const source of MIGRATION_SOURCES) {
      for (const match of source.matchAll(new RegExp(`${fn}\\(\\s*'([a-z_]+)'`, 'g'))) {
        seen.add(match[1])
      }
    }
    return [...seen].sort()
  }
  return { tenant: collect('\\b(?:grid_)?secure_table'), platform: collect('\\b(?:grid_)?secure_platform_table') }
}

function removedTables(): Set<string> {
  const removed = new Set<string>()
  for (const source of MIGRATION_SOURCES) {
    for (const match of source.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([a-z_]+)"?/gi)) {
      removed.add(match[1])
    }
    for (const match of source.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?"?([a-z_]+)"?\s+RENAME\s+TO\s+/gi
    )) {
      removed.add(match[1])
    }
  }
  return removed
}

function duplicatedWithinAMigration(): string[] {
  const duplicates: string[] = []
  for (const source of MIGRATION_SOURCES) {
    const calls = [...source.matchAll(/\b(?:grid_)?secure_(?:platform_)?table\(\s*'([a-z_]+)'/g)].map(
      (m) => m[1]
    )
    duplicates.push(...calls.filter((name, index) => calls.indexOf(name) !== index))
  }
  return duplicates
}

describe('row-level security coverage', () => {
  it('secures every table the drizzle schema declares', () => {
    const { tenant, platform } = securedTables()
    const secured = new Set([...tenant, ...platform])
    const unsecured = declaredTables().filter((table) => !secured.has(table))

    expect(
      unsecured,
      `These tables are outside the tenant boundary. Add a secure_table() ` +
        `line for each one to a migration — see docs/database/row-level-security.md.`
    ).toEqual([])
  })

  it('secures no table that no longer exists', () => {
    const declared = new Set(declaredTables())
    const removed = removedTables()
    const { tenant, platform } = securedTables()
    const orphaned = [...tenant, ...platform].filter(
      (table) => !declared.has(table) && !removed.has(table)
    )

    expect(
      orphaned,
      'Secured tables that are neither in the schema nor dropped/renamed away by a ' +
        'migration — either the declaration was removed without a DROP or a RENAME, ' +
        'or a secure_table() line was left behind.'
    ).toEqual([])
  })

  it('secures each table exactly once per migration', () => {
    expect(
      duplicatedWithinAMigration(),
      'Tables secured twice in one migration — the policies would OR together.'
    ).toEqual([])
  })

  it('keeps platform configuration out of the tenant-predicate set', () => {
    const { tenant, platform } = securedTables()

    expect(platform).toEqual([
      'address_register_entries',
      'address_register_releases',
      'analytics_export_cursors',
      'platform_lesson_events',
      'platform_lesson_reports',
      'platform_lessons',
      'platform_model_defaults',
      'platform_pricing_versions',
      'platform_reasoning_efforts',
      'platform_retrieval_settings',
      'platform_skills',
      'platform_workflow_templates',
    ])
    expect(tenant.filter((table) => table.startsWith('platform_'))).toEqual([])
  })
})

describe('policy predicates say what they should', () => {
  function predicates(): Map<string, string> {
    const found = new Map<string, string>()
    for (const source of MIGRATION_SOURCES) {
      for (const match of source.matchAll(
        /\b(?:grid_)?secure_table\(\s*'([a-z_]+)',\s*'([\s\S]*?)'\s*\)/g
      )) {
        found.set(match[1], match[2])
      }
    }
    return found
  }

  it('ties every table that has an organization_id to current_org()', () => {
    const withOrgColumn = new Set(
      (Object.values(schema) as unknown[])
        .filter((value): value is Table => is(value, Table))
        .filter((table) => 'organizationId' in table)
        .map((table) => getTableName(table))
    )

    const wrong: string[] = []
    for (const [table, predicate] of predicates()) {
      if (!withOrgColumn.has(table)) continue
      if (!/organization_id = (?:grid_)?current_org\(\)/.test(predicate)) wrong.push(table)
    }

    expect(
      wrong,
      'These tables carry organization_id but their policy does not compare it to ' +
        'current_org(). Without that half, a row with a NULL optional foreign ' +
        'key is readable by every tenant.'
    ).toEqual([])
  })

  it('keys user_preferences to the acting user, not the organization', () => {
    expect(predicates().get('user_preferences')).toMatch(/\b(?:grid_)?current_user_id\(\)/)
  })

  it('has no policy that matches everything', () => {
    const permissive = [...predicates()].filter(([, p]) => p.trim() === 'true').map(([t]) => t)
    expect(permissive, 'A predicate of `true` secures nothing.').toEqual([])
  })

  it('keeps the composite foreign keys that replace the recursive folder policy', () => {
    const all = MIGRATION_SOURCES.join('\n')
    expect(all).toContain('FOREIGN KEY (parent_id, project_id)')
    expect(all).toContain('FOREIGN KEY (folder_id, project_id)')
    expect(all).toContain('FOREIGN KEY (conversation_id, organization_id)')
  })
})

describe('settings parity between the app and the policies', () => {
  const SWITCH = readFileSync(join(process.cwd(), 'migrations', '0244_app_session_settings_only.sql'), 'utf8')
  const statements = SWITCH.split('\n').filter((line) => !line.startsWith('--')).join('\n')

  it('reads only the setting names the app sets', () => {
    for (const setting of [ORGANIZATION_SETTING, USER_SETTING]) {
      expect(statements).toContain(`current_setting('${setting}', true)`)
    }
    expect(new Set(statements.match(/current_setting\('([^']+)'/g))).toEqual(
      new Set([`current_setting('${ORGANIZATION_SETTING}'`, `current_setting('${USER_SETTING}'`]),
    )
  })

  it('redefines the functions every policy calls and every column default that reads the setting', () => {
    expect(statements).toMatch(/CREATE OR REPLACE FUNCTION current_org\(\) RETURNS text/)
    expect(statements).toMatch(/CREATE OR REPLACE FUNCTION current_user_id\(\) RETURNS text/)
    for (const table of ['messages', 'conversation_reads', 'message_edition_uses', 'project_base_confirmations']) {
      expect(statements).toMatch(new RegExp(`ALTER TABLE ${table}\\s+ALTER COLUMN organization_id SET DEFAULT`))
    }
  })

  it('names the same bypass role the migration requires', () => {
    const rename = readFileSync(join(process.cwd(), '..', '..', 'deploy/postgres/rename-legacy-names.sh'), 'utf8')
    expect(MIGRATION).toContain(`'grid_app_platform'`)
    expect(MIGRATION).not.toContain('CREATE ROLE grid_app_platform')
    expect(rename).toContain(`grid_app_platform:${PLATFORM_ROLE}`)
  })

  it('is provisioned by every deployment that has to run the migration', () => {
    const provisioners = [
      'deploy/compose/init-db.sql',
      'scripts/rls-test-db.sh',
      'deploy/postgres/rename-legacy-names.sh',
    ]
    for (const file of provisioners) {
      const source = readFileSync(join(process.cwd(), '..', '..', file), 'utf8')
      for (const role of ['grid_app_owner', 'grid_app_rw', 'grid_app_platform']) {
        expect(source, `${file} must provision ${role}`).toContain(role)
      }
    }
  })

  it('grants the runtime role no write access to platform configuration', () => {
    const definitions = MIGRATION_SOURCES.flatMap((source) => [
      ...source.matchAll(/CREATE OR REPLACE FUNCTION (?:grid_)?secure_platform_table\([\s\S]*?\n\$\$;/g),
    ]).map((match) => match[0])
    const platformHelper = definitions.at(-1)

    expect(platformHelper, 'the platform helper is gone from the migrations').toBeDefined()
    expect(platformHelper).toContain("format('GRANT SELECT ON %I TO %I', target, rls_role('rw'))")
    expect(
      platformHelper,
      'the platform helper grants the runtime role a write it must not have'
    ).not.toMatch(/GRANT[^;']*(INSERT|UPDATE|DELETE)[^;]*rls_role\('rw'\)/)
  })
})
