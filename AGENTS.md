# Contributor guide for agents

You are the owner and long-term maintainer of this codebase, and its design is up to you.

ARCHOS is the workspace for architects, and the agent is a colleague in the
office; building law is one capability among many. Read [`VISION.md`](VISION.md)
before you describe the product anywhere.

## Setup

```bash
task setup                    # first, and after any pull that moves a lockfile
.venv/bin/pre-commit install  # separate from setup; CI lints the whole repo
task verify                   # the merge gate; task verify:fast before a push
```

Nothing here installs `task` (go-task), `uv`, `bun` or Node ([`CONTRIBUTING.md`](CONTRIBUTING.md)).

## Start here

| Question | Go to |
|---|---|
| Where does X live in the code | [`where-is-what.md`](docs/architecture/where-is-what.md) |
| What does this word mean, how do I name X | [`CONTEXT.md`](CONTEXT.md), [`glossary.md`](docs/glossary.md), [`naming.md`](docs/contributing/naming.md) |
| How we work: the rules and their cases | [`working-style.md`](docs/contributing/working-style.md) |
| What every change must do, and what checks it | [`obligations.md`](docs/contributing/obligations.md) |
| Code conventions and the rules that span services | [`code-conventions.md`](docs/contributing/code-conventions.md) |
| What an agent can do in the workspace, and how to add it | [`agent-surface.md`](docs/architecture/agent-surface.md) |
| Everything else, by question | [`docs/README.md`](docs/README.md) |

## Where the scoped guides are

A service or package may keep its own `AGENTS.md` beside its code, adding to
this file. Read the one for the area you are about to touch before you touch it:
harnesses load it late or never. `git ls-files '*AGENTS.md'` lists them; what
belongs in which: [`agent-onboarding-files.md`](docs/contributing/agent-onboarding-files.md).

## Working style

The long form of each rule: [`working-style.md`](docs/contributing/working-style.md).

- **Value driven.** Write down what the user expects to be true when this is
  done; when the requested change would not produce it, say so before coding.
- **Finish the task.** Carry reversible work to the end state, report at
  boundaries, and stop only for a one-way door or a real ambiguity.
- **Code is memory; a comment is a liability.** The next agent copies what the
  code does, workarounds included; a comment goes stale and excuses them. If you
  need to document how code works, treat it as an architectural fault and
  rethink how you built it. Turn each correction into a check that names the fix.
- **Context earns its place.** Every line of a guide, skill or prompt names the
  failure it prevents; a line about state outside the code names where it lives.
- **Read [`gotchas.md`](docs/contributing/gotchas.md) first** when something
  surprises you or breaks, and add your entry with the string you searched for.
- **Done means the closing checklist** of [`definition-of-done.md`](docs/contributing/definition-of-done.md),
  every line filled with evidence or why not, in your summary.

**Ask first only for a one-way door.** Each has a safe form, which is the
default. Run the writing form when the user asked for it in this session:

| Run it freely | Ask first |
|---|---|
| `task workspace:provision:authz` and its siblings, which check | the same task with `-- --apply`, which writes the catalog into WorkOS (every deploy also runs it, as the Job `grid-app-authz-catalog`) |
| `npm run preview` in `deploy/pulumi` | `npm run up`, which mutates the cluster, and `npm run destroy`, which deletes it |
| writing a migration file | `bun run db:migrate` or `migrate:storage` against a database you did not create |
| `task prompts:push`, which checks | the same task with `-- --apply`, which publishes the platform prompt to Langfuse |
| `task langfuse:provision`, which checks | the same task with `-- --apply`, which creates score configs, the review queue, judges and the golden dataset in Langfuse |
| a commit, a branch, a push to your own branch | a force-push, or any history rewrite on a branch someone else may have checked out |
| merging a pull request an owner approved, once `CI OK` is green | merging past the required review, which a code owner ([`CODEOWNERS`](.github/CODEOWNERS)) may do once `CI OK` is green |

Anything else that destroys what you cannot regenerate needs the same yes: `rm -rf`,
`git clean -fdx`, a `DROP` or unfiltered `DELETE` against a database anyone else uses, removing a Docker volume.

## Obligations

The rules a CI check enforces are in [`obligations.md`](docs/contributing/obligations.md),
and their checks fail loudly. Only review catches these:

- A change a customer can see gets a capture attached to the PR, never committed
  ([`visual-screenshots.md`](docs/ux/visual-screenshots.md)).
- A change to what shapes an answer runs the golden run on dev before and after
  ([which run](docs/contributing/testing-and-verification.md#which-run-gates-a-change)).
- A model call, check or agent step is observable in Langfuse; the tests see
  only part of it ([`langfuse.md`](docs/observability/langfuse.md)).
- A change to behaviour a doc describes updates the doc in the same commit.
