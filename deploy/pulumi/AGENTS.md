# The cluster program: `deploy/pulumi`

The Pulumi program that deploys every stack. Its config keys: [`README.md`](README.md).

- `pulumi preview`, CRD validation and CrossGuard need stack credentials, which a session and a pull
  request lack: run `task infra:types` and `task infra:test` before you push, and treat the staging
  deploy (`deploy.yml`, after the merge to develop) as the first real preview of the change.
- A Job that must finish before the apps roll is in their `dependsOn` and carries no
  `pulumi.com/skipAwait`, as the `before-readers` backfill Job is in `index.ts`. Without both, the
  apps roll beside a Job still running.
- Pin every Helm chart's version: `index-helm-pins.spec.ts` fails an unpinned release.
- CNPG rolls a changed pod spec by switchover (`src/data/cnpg.ts`): change `imageName` and a
  PostgreSQL parameter in separate deploys, as the `pgPrimaryUpdateStrategy` row of the README says.
- The log shipper keeps 10% of info lines, and a JSON line with no level counts as info. A short-lived
  Job whose every line must reach PostHog has its pod prefix where `UNSAMPLED_POD` is built
  (`src/platform/log-shipper.ts`).
