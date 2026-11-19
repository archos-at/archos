# The cluster program: `deploy/pulumi`

The Pulumi program that deploys every stack. Its config keys: [`README.md`](README.md).

- A session has no stack credentials: run `task infra:types` and `task infra:test` before you push.
  A pull request's `infra-preview` job previews it against staging (`scripts/preview-pull-request.sh`)
  and fails on a plan that loses data unless the pull request is labelled `infra:destroys-state`.
- A Job that must finish before the apps roll is in their `dependsOn` and carries no
  `pulumi.com/skipAwait`, as the `before-readers` backfill Job is in `index.ts`. Without both, the
  apps roll beside a Job still running.
- Pin every Helm chart's version and give it `HELM_RELEASE_TIMEOUT_SECONDS`: `index-helm-pins.spec.ts` fails either gap.
- CNPG rolls a changed pod spec by switchover (`src/data/cnpg.ts`): change `imageName` and a
  PostgreSQL parameter in separate deploys, as the `pgPrimaryUpdateStrategy` row of the README says.
- The log shipper keeps 10% of info lines, and a JSON line with no level counts as info. A short-lived
  Job whose every line must reach PostHog has its pod prefix where `UNSAMPLED_POD` is built
  (`src/platform/log-shipper.ts`).
