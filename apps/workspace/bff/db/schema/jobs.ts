import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { skillCategories } from './skill-categories'

/**
 * Agent Skills (docs/architecture/agent-skills.md): the org toolbox of
 * agentskills.io-format skills, and the two outputs a scheduled prompt can ask
 * for.
 *
 * The file is still named for the `jobs` and `job_runs` tables it used to
 * declare. A job is a `task_definitions` row with a schedule since migration
 * 0086 (`./task-model.ts`), and 0226 dropped the two tables.
 *
 * Platform-authored skills are NOT rows here: they ship as files under
 * `packages/agent/src/agent/skills/builtin/<collection>/` and arrive via the generated
 * `@/lib/skills/platform-skills` module. The `skills` table holds org-authored
 * (and cloned) skills only.
 */

export const SKILL_ORIGINS = ['org', 'platform-clone'] as const
export type SkillOrigin = (typeof SKILL_ORIGINS)[number]

/**
 * What a scheduled prompt produces — the user's choice on the task, and the
 * only thing that decides which agent runs it. Stored as the definition's
 * `kind` (`task_definitions.kind`).
 *
 *   - `chat`          researcher; the finished run is materialised into
 *                     a real conversation the user can open and continue.
 *   - `deep-research` deep_researcher; the finished run is a report.
 *
 * Was `SKILL_EXECUTIONS`, denormalised from the skill's `grid-execution`
 * metadata key. Same two values, same agent mapping; only the source moved.
 * A skill has no opinion about how its output is delivered — the person
 * scheduling it does.
 */
export const JOB_OUTPUTS = ['chat', 'deep-research'] as const
export type JobOutput = (typeof JOB_OUTPUTS)[number]

export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    // Lowercase a-z/0-9/hyphens, no leading/trailing/consecutive hyphens
    // (agentskills.io name rule) — validated by skillNameSchema at the routes.
    name: text('name').notNull(),
    description: text('description').notNull(),
    body: text('body').notNull(),
    // Reserved keys read at resolve time: grid-agents (who may use it — the one
    // availability gate) and grid-cards (preferred output cards). See
    // lib/skills/types.ts. Scheduling and output delivery are NOT here: they
    // are properties of the job that attaches the skill.
    metadata: jsonb('metadata').$type<Record<string, string>>().notNull().default({}),
    // 'org' = authored in this organization; 'platform-clone' = cloned from a
    // platform skill (cloned_from carries the platform name).
    origin: text('origin').$type<SkillOrigin>().notNull().default('org'),
    clonedFrom: text('cloned_from'),
    /**
     * The shelf this skill stands on — an org shelf of this organization, or a
     * platform shelf. NULL is unsorted, which is where every existing row
     * starts: categorising the back-catalogue is curation, not migration.
     * SET NULL on delete, for the same reason skills survive their skill's
     * deletion everywhere else: removing a shelf must never remove the books.
     */
    categoryId: uuid('category_id').references(() => skillCategories.id, {
      onDelete: 'set null',
    }),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: text('created_by').notNull(),
    createdByEmail: text('created_by_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgNameIdx: uniqueIndex('idx_skills_org_name').on(table.organizationId, table.name),
    orgIdx: index('idx_skills_organization_id').on(table.organizationId),
  })
)

export type Skill = typeof skills.$inferSelect
export type NewSkill = typeof skills.$inferInsert
