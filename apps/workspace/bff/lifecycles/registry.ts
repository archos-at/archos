/**
 * Every declared lifecycle in the workspace (ADR-0179), in one list: what the
 * generated reference (`docs/architecture/lifecycles.generated.md`) draws and
 * what `registry.spec.ts` checks against a statechart interpreter.
 *
 * A record whose legal moves are declared with `defineLifecycle` is listed
 * here in the same change. `where` names the module that owns the declaration
 * and `column` the place the state is stored, so a reader arriving from a
 * table finds the rule and a reader arriving from the rule finds the table.
 */
import { AGENT_WAKE_LIFECYCLE, ANNOTATION_LIFECYCLE } from '@/lib/annotations/lifecycles'
import { ASK_LIFECYCLE } from '@/lib/agent-asks/ask-wire'
import { MAIL_IMPORT_LIFECYCLE } from '@/lib/db/schema/mail-imports'
import { DOCUMENT_VERSION_LIFECYCLE } from '@/lib/documents/version-lifecycle'
import { ROOT_SORT_LIFECYCLE } from '@/lib/filing/root-sort-types'
import { PROJECT_LIFECYCLE } from '@/lib/projects/project-status'
import type { Lifecycle } from '@/shared/lifecycle/define-lifecycle'

export interface RegisteredLifecycle {
  readonly lifecycle: Lifecycle<string, string>
  /** What the record is, in one sentence a newcomer can read. */
  readonly what: string
  /** The module that declares it, relative to `apps/workspace`. */
  readonly where: string
  /** Where the state is stored. */
  readonly column: string
}

export const LIFECYCLES: readonly RegisteredLifecycle[] = [
  {
    lifecycle: PROJECT_LIFECYCLE,
    what: 'A project: running, parked, or finished and kept as the reference of the office (ADR-0098).',
    where: 'bff/projects/project-status.ts',
    column: 'projects.status',
  },
  {
    lifecycle: DOCUMENT_VERSION_LIFECYCLE,
    what: 'One version of a document on its way through review to publication (ADR-0104).',
    where: 'bff/documents/version-lifecycle.ts',
    column: 'document_versions.state',
  },
  {
    lifecycle: ANNOTATION_LIFECYCLE,
    what: 'A mark on a page of a document: proposed by the agent or set by a person, then resolved or dismissed.',
    where: 'bff/annotations/lifecycles.ts',
    column: 'document_annotations.status',
  },
  {
    lifecycle: AGENT_WAKE_LIFECYCLE,
    what: 'One time the agent was woken on a mark (a mention, a reply, a delegation) and what came of it (ADR-0106).',
    where: 'bff/annotations/lifecycles.ts',
    column: 'agent_wakes.status',
  },
  {
    lifecycle: ASK_LIFECYCLE,
    what: 'A question another agent put to the agent, as an A2A task.',
    where: 'bff/agent-asks/ask-wire.ts',
    column: 'agent_asks.state',
  },
  {
    lifecycle: ROOT_SORT_LIFECYCLE,
    what: 'A run that sorts the loose files at the root of a shelf into folders, for a person to review, apply and undo.',
    where: 'bff/filing/root-sort-types.ts',
    column: 'root_sort_runs.status',
  },
  {
    lifecycle: MAIL_IMPORT_LIFECYCLE,
    what: 'The import of one mail archive into a project.',
    where: 'bff/db/schema/mail-imports.ts',
    column: 'mail_imports.status',
  },
]
