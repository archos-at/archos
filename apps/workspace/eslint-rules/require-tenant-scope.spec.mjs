/**
 * The guard on the guard for `grid/require-tenant-scope`.
 *
 * The rule's whole value is in resolving the binding: a scope opener counts only
 * when it is an IMPORT from the real module, so a local function that shares the
 * name, or a member call that shares it, does not open a slot. That resolution
 * goes through the linter's scope manager, which is exactly the part a linter
 * upgrade could change underneath the rule — so the shapes below run under the
 * engine that runs the rule in `bun run lint`, oxlint.
 */

import { RuleTester } from 'oxlint/plugins-dev'
import rule from './require-tenant-scope.mjs'

const ruleTester = new RuleTester({
  eslintCompat: true,
  languageOptions: { sourceType: 'module', parserOptions: { lang: 'tsx' } },
})

const PAGE = 'app/projects/[id]/page.tsx'

ruleTester.run('require-tenant-scope', rule, {
  valid: [
    {
      filename: PAGE,
      code:
        "import { withPageSession } from '@/lib/auth/require-auth'\n" +
        'export default function Page() { return withPageSession(async (session) => session) }',
    },
    {
      filename: PAGE,
      code:
        "import { runWithTenantSlot } from '@/lib/db/tenant-context'\n" +
        "import { getUserSession } from '@/lib/auth/session'\n" +
        'export default function Page() { return runWithTenantSlot(async () => getUserSession()) }',
    },
    {
      filename: PAGE,
      code:
        "import { runWithTenantSlot as slot } from '@/lib/db/tenant-context'\n" +
        "import { getUserSession } from '@/lib/auth/session'\n" +
        'export default function Page() { return slot(async () => getUserSession()) }',
    },
    {
      filename: 'app/api/projects/route.ts',
      code: "import { getUserSession } from '@/lib/auth/session'\nexport const GET = () => getUserSession()",
    },
    {
      filename: 'bff/projects/service.ts',
      code: "import { getUserSession } from '@/lib/auth/session'\nexport const load = () => getUserSession()",
    },
    {
      filename: 'app/projects/page.spec.tsx',
      code: "import { getUserSession } from '@/lib/auth/session'\ngetUserSession()",
    },
    {
      filename: PAGE,
      code:
        "import { withPageSession } from '@/lib/auth/require-auth'\n" +
        'async function Slot({ projectId }) { return withPageSession(async (session) => [session, projectId]) }',
    },
    {
      filename: PAGE,
      code: 'function Badge({ session }) { return session.userId }',
    },
    {
      filename: 'ui/features/projects/components/tile.tsx',
      code: 'export async function Tile({ session }) { return session }',
    },
  ],
  invalid: [
    {
      filename: PAGE,
      code:
        "import { getUserSession } from '@/lib/auth/session'\n" +
        'export default async function Page() { const session = await getUserSession(); return session }',
      errors: [{ messageId: 'unscoped' }],
    },
    {
      filename: 'app/projects/actions.ts',
      code:
        "'use server'\nimport { requireUserSession } from '@/lib/auth/session'\n" +
        'export async function rename() { return requireUserSession() }',
      errors: [{ messageId: 'unscoped' }],
    },
    {
      filename: PAGE,
      code:
        "import { getUserSession } from '@/lib/auth/session'\n" +
        'const withPageSession = (fn) => fn()\n' +
        'export default function Page() { return withPageSession(() => getUserSession()) }',
      errors: [{ messageId: 'unscoped' }],
    },
    {
      filename: PAGE,
      code:
        "import { getUserSession } from '@/lib/auth/session'\n" +
        "import { withTenant } from './local-helpers'\n" +
        'export default function Page() { return withTenant(() => getUserSession()) }',
      errors: [{ messageId: 'unscoped' }],
    },
    {
      filename: PAGE,
      code:
        "import { getUserSession } from '@/lib/auth/session'\n" +
        'export default function Page() { return helpers.withTenant(() => getUserSession()) }',
      errors: [{ messageId: 'unscoped' }],
    },
    {
      filename: PAGE,
      code: 'async function SimilarProjectsSlot({ session, projectId }) { return [session, projectId] }',
      errors: [{ messageId: 'sessionProp' }],
    },
    {
      filename: PAGE,
      code: 'const Slot = async ({ session }) => session',
      errors: [{ messageId: 'sessionProp' }],
    },
  ],
})
