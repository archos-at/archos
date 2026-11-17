# The UI and the BFF: `apps/workspace`

The product UI, the BFF routes under `app/api`, and tenancy, authorization and the database.

**This is not the Next.js of your training data.** Next 16 changed APIs, conventions
and file layout: read the guide in `node_modules/next/dist/docs/` before writing Next
code, and heed its deprecation notices.

Each rule in full, with its reason: [`workspace-rules.md`](../../docs/architecture/workspace-rules.md).
For how the UI looks, [`design-language.md`](../../docs/design/design-language.md) wins over any design skill.

- Declare `authz` on every `app/api` route's factory (`@/lib/api/handler`). `authz-coverage.spec.ts`.
- Check a permission, never a role name, through `bff/authz/decide.ts` or its gates. Review.
- Remove a permission by adding its slug to `RETIRED_PERMISSIONS` (`bff/authz/retired-permissions.ts`)
  as well. Nothing in CI: the deploy's `grid-app-authz-catalog` Job fails with `UNKNOWN <slug>`.
- A new table gets `SELECT secure_table(...)` in its migration. `rls-coverage.spec.ts`.
- Put the organization in every `getCached` / `setCached` key; a shared key goes in
  `eslint-rules/global-cache-keys.mjs` with its reason. `grid/require-tenant-cache-key`.
- A query on `documents`, or on one document's facts, ANDs `documentVisibleTo(reader)` into
  its own WHERE. `documents/document-visibility.spec.ts`.
- Only `bff/agent-api/dispatch.ts` calls `runAsActingSession`. `acting-session.spec.ts`.
- Reach the Python backend through `getBackendUrl` and `internalServiceHeaders`. `internal-auth.spec.ts`, `backend-url.spec.ts`.
- Coerce a raw `sql<T>` result at the repository (`new Date(row.x)`). Nothing checks it.
- Translate through the namespace's module (`@/i18n/namespaces/<ns>`), never the whole
  dictionary. `aggregate-imports.spec.ts`.
- Work over many items is a BFF job on Hatchet, never a browser loop. `browser-work-loops.spec.ts`.
- Run scripts without `--bun`: it kills Turbopack's PostCSS step (ADR-0103).

Before you add a card type, a status column, a lint rule, a canvas or chat capability, or a
spec that reads the tree from disk, read its row in
[`workspace-rules.md`](../../docs/architecture/workspace-rules.md#obligations): each has a
registry its spec holds you to.
