# Code conventions

House rules that are not obvious from the code, each one written down because
somebody already paid for it. Language defaults and formatting live in the
tooling (`ruff`, `oxlint`, `tsconfig`), not here.

## Size limits

A source file (`.py`, `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`) has at most
**600 lines**, and a Python
function at most **60**, from its `def` to its last line. Files reached three
to seven thousand lines and one function 962 one reasonable hunk at a time,
and review passed every hunk, so the limit is a check rather than a request:
`scripts/check_file_size.py`, the `file-size` hook in `task lint:repo`, which
CI's **Repo checks** job runs.

**Import statements are not counted**, nor the blank lines between two of
them: `import` and `from … import` in Python, `import … from` and
`export … from` in TypeScript and JavaScript, a multi-line one whole. An import
names a dependency; it is not logic anyone has to read through. While they
counted, the precise import cost lines: importing the one i18n namespace or the
one schema table a module uses, instead of a barrel that drags in every other,
grew a giant by a line per import and failed the check, so the ratchet
punished exactly the decoupling that keeps a change's test selection small
([`docs/audit/blast-radius-2026-10.md`](../audit/blast-radius-2026-10.md)).
A dynamic `import()` is an expression and counts.

**Comments are not counted either**: a line that holds only a `//`, `/* … */`
or `#` comment, and a Python docstring (a function's own docstring is also left
out of its sixty lines). An explanation is not logic. While it counted, a file
sitting at its baseline could take a new comment only by losing an old one, and
on 2026-11-11 three doc blocks were squeezed to one line each to make room for
a five-line fix: the ratchet was being satisfied by deleting explanation. It is
a ratchet on code. A line of code with a trailing comment counts, as code.

**TypeScript and JavaScript have no baseline: the limit is absolute**, specs
and test helpers included. Wave B1 (2026-11) split every TS/JS file that was
over, 166 of them, so `ci/size_baseline.json` holds none, and an entry for one
fails the check. A spec of three thousand lines is split by feature like any
other file: one `<subject>-<feature>.spec.ts` per group beside the subject,
shared builders in `<subject>.fixtures.ts`, and `vi.mock` in every spec that
needs it (vitest hoists it only within the spec file).

**Python keeps a ratchet** while Wave B2 splits it. `ci/size_baseline.json`
records every Python file and function that was over when the check arrived,
at its size then:

- A file or function **not in the baseline** may not pass the limit. Split it.
- One **in the baseline** may not grow past its recorded count. Adding to a
  giant means taking the same lines out of it, or moving the part you touch
  into a module of its own first.
- When one **shrinks**, the check passes and notes the slack. Lock the gain in
  with `task baselines:tighten` (every ratchet's `--update`, which lowers and
  removes entries and never raises or adds one), in the same PR or a later one.
  Until then the slack could be spent again; that is the price of not failing a
  good change.
- A **move or rename** re-keys entries, so the baseline conflicts or reports
  the old path as gone and the new one as new. Regenerate it with
  `--rebaseline`, which re-keys an entry to the moved file or function of the
  same name and no larger size, and refuses to add, raise or hold a TS/JS entry.

**Where the pieces go** matters as much as their size. A piece lands where the
layout already puts its kind: in `ui/features/<feature>/`, a hook in `hooks/`,
logic without React in `lib/`, a store slice in `stores/`; three or more pieces
of one component in a folder named for it inside `components/`, with the
original file kept as the entry point; in `bff/<domain>/`, flat modules named
`<noun>-<job>.ts`; a dev page's data in `fixtures.ts` beside its `page.tsx`.
Each module is named for its one job ([`naming.md`](naming.md)), never
`helpers`, `utils2` or `part-2`, and the module seams hold
([`module-seams.md`](module-seams.md)).

Why these numbers: sixty lines is the function bar this file already sets
below. Six hundred lines is about ten such functions, a module a reader can
hold, and it puts the line where the tree already bends. TypeScript functions
have no limit yet: measuring them needs the TypeScript parser, which lives in
the UI's `node_modules` that the Repo checks job does not install.

Not checked, because their length follows their input rather than a design
choice: generated files (the card schemas' `src/shared/cards/generated.ts`,
`*.generated.*`, `*.d.ts`), fixtures, migrations, and copy (the i18n
dictionaries, the site's `src/data/` and `src/i18n/`), and Python tests. The
lists are `EXCLUDED` (Python) and `SCRIPT_EXCLUDED` (TS/JS) in the script.

## Specs test behaviour

A spec imports the code, calls it and asserts on what it returns, renders or
sends. It never reads a source file as text to assert on what the code says:
by 2026-11 about 220 specs opened `bff/x.ts` with `readFileSync` and checked
that a string appeared in it, so they passed while the behaviour was broken
and failed on a rename that changed nothing. Wave B1 rewrote them to test
behaviour, or deleted the ones that only pinned wording.

The one exception is a **structural guard across the tree**: an invariant that
must hold for every file of a kind, including files nobody has written yet
(every `app/api` route declares `authz`, every table runs `secure_table`, only
`dispatch.ts` calls `runAsActingSession`). Such a guard parses the code and
asserts on the syntax tree, never on text, comments or prose:

- TypeScript: `@/test-utils/source-ast` (`parseSource`, `productionSources`,
  `importsOf`, `callsTo`, `exportedNames`), the compiler API from
  `typescript-api`; in `deploy/pulumi` and the site, `typescript` itself.
- SQL migrations: `@/test-utils/sql-statements` (`readSql`, `createdTables`,
  `functionCalls`), which skips comments, strings and dollar-quoted bodies.
- A stylesheet: `postcss`.

Every guard is listed in `ci/ast_guard_specs.txt`. The `spec-source-reads`
hook (`scripts/check_spec_source_reads.py`, in `task lint:repo` and CI's
**Repo checks** job) fails any other spec or test helper that reads files and
names a source file (`.ts`, `.tsx`, `.js`, `.py`, `.css`, `.sql`, a
`Dockerfile`, a `?raw` import), and a listed spec that imports no parser or no
longer reads. Data is not source: a JSON contract, a PDF or IFC fixture, a
stack's YAML, and a generated file a spec compares with its generator all pass.
A spec that checks what a Python file says belongs on the Python side, or
asserts against the shared contract in `contracts/`.

## Comments

Write code that needs no comment. A comment goes stale without a diff, no check
reads it, and it gives an agent a place to justify a workaround that the next
agent then copies ([the rule and its sources](working-style.md#code-is-memory-a-comment-is-a-liability)).
Fix the code instead: a clearer name, a smaller function, a type, or a check
whose message names the rule.

- **Three lines per file are free**: room for a one-line contract, a dated
  measurement, a vendor bug with its link, or a legal constraint. Never a
  paragraph, never "why this workaround is acceptable", never history ("used
  to …"), never a pointer to a doc by name that will move.
- **A file already over three may not grow.** A new comment there is paid for
  by deleting another. A shrink passes; `task baselines:tighten` locks it in.
- **Lines a tool reads do not count**: lint and type suppressions (`noqa`,
  `eslint-disable`, `@ts-expect-error`), test-environment pragmas, JSDoc types
  in plain JavaScript, bundler hints, `@disk-inputs`.
- A design rationale longer than a line belongs in an ADR or the area's doc,
  linked from the code only if the code would mislead without it.

The check is `scripts/check_comments.py` against `ci/comment_baseline.json`,
run by the `comments` pre-commit hook on the files you commit and by CI's
**Repo checks** job on all of them. It counts what
`scripts/check_file_size.py`'s `comment_lines` counts: lines that hold only a
comment, and Python docstrings. On 2026-11-16, when it arrived, the tree held
323,379 such lines in 7,452 files over the allowance; the audit that removes
them is planned in the brand-free sweep.

## No brand names

No code or infrastructure name carries a brand, and the product's name is copy
read from `packages/brand/identity.json` (ADR-0149). The rule, its two
ratchets, "rename when you touch it" and the steps for a stored or external
name are in [`naming.md`](naming.md#no-brand-in-a-name), with every other
naming rule.

## Python

Ruff, line length 120, Python 3.14. New tools use `@register_function` with a
`FunctionBaseConfig` subclass.

### Shape of a function

The agent tier grew to nineteen thousand lines with functions that ran two
hundred lines deep and four `if`s wide, and the cost was not aesthetic: a fix
in the middle of one of them could not be tested on its own, and a reader had
to hold the whole thing to know which branch they were in. These rules are the
floor for anything under `packages/agent/src/agent`, the Python packages under `packages/` and `apps/agent-host`,
new or touched:

- **Two levels of nesting inside a function, at most.** A third `if`/`for`/
  `try` inside a function body is a function waiting to be named. Ruff's
  `PLR1702` (`max-nested-blocks = 2`) is the check, run by the `nesting` hook
  (`scripts/check_nesting.py`) over `packages/*/src` and `apps/agent-host/src`.
  `pyproject.toml` still ignores the rule, and Ruff 0.17 keeps it in preview, so
  a bare `ruff check` never reports it. The hook is a ratchet on
  `ci/nesting_baseline.json`: a file there may not gain a finding, every other
  file may have none, and `--update` lowers an entry when you name an inner
  block.
- **Early exit, never an `else` ladder.** Guard clauses first, the happy path
  last and unindented. `if not x: return` beats wrapping the body in `if x:`.
- **Sixty lines is long.** Past that, the function is doing two things.
  Split at the point where you would write a comment saying what the next
  block does; the comment is the function's name. Over sixty fails
  [the size check](#size-limits).
- **Pure where it can be.** Take inputs, return outputs. A function that reads
  or writes module-level state cannot be tested without resetting the world,
  and cannot run twice in one process safely. Module-level mutable state is
  reserved for the registries the agent runtime populates at boot, and each one has a
  `reset_*` for tests.
- **Never swallow.** `except Exception: pass`, or a bare `except` that logs
  and continues, hides the fault the next reader needs. Catch the exception
  you can handle, and re-raise or return a typed failure for the rest.
- **Gather what is independent.** Two `await`s that do not depend on each
  other are one `asyncio.gather`. The staged pipelines already do this with a
  bounded `Semaphore`; a sequential loop of awaits is the smell.
- **Data in, data out.** Prefer a small frozen dataclass or Pydantic model over
  a dict with agreed keys, and over a class that carries state between
  methods. A method that only uses `self` to reach one field is a function.

None of this is a licence to rewrite a file you are passing through. Touch a
function, leave it meeting the bar; leave the neighbours alone unless the
change needs them.

### A package is imported by its surface

The knowledge layer is laid out by job: `knowledge_layer.ingest`, `.search`,
`.read_passage`, `.browse`, `.estate` and `.vector_store`. Each package's
`__init__.py` exports what code outside it uses, as a `_LAZY` map
(`agent.lazy_exports`, `cache=False`): a name loads on first use and is read
from its submodule every time, so a test that patches the submodule is seen
through the package too. Outside the package, import the name from the
package:

```python
from knowledge_layer.search import RankedSearch  # yes
from knowledge_layer.search.ranked_search import RankedSearch  # no: the file's path is now a contract
```

Before the surfaces, laying the layer out by job rewrote nearly a thousand
references, most in tests, and the dotted patch strings among them
(`patch("knowledge_layer.….name")`) failed only when the test ran. So:

- **A name outside code needs goes in `_LAZY` and `__all__`**, never a name a
  submodule also has (`tests/test_import_weight.py`).
- **A patch is on the module object**, `monkeypatch.setattr(results, "format_results", …)`
  or `patch.object(scope, "resolve_scoped_collections", …)` with the module
  imported, never a dotted string: a move then fails at import, where a
  rewrite tool sees it. Patch where the name is looked up, which is the
  submodule, not the package.
- **What still names a submodule from outside** (a private helper a test
  calls, a module a test patches, a logger name) is counted per file in
  `ci/package_surface_baseline.json` by `scripts/check_package_surfaces.py`
  (the `package-surfaces` hook), and may only shrink: `--update` lowers it.
  A new package with a surface joins `PACKAGES` there.

## TypeScript

### `any` is not a type we accept, in production code or in tests

`no-explicit-any` (typescript-eslint's rule, run by oxlint as
`typescript/no-explicit-any`) is an **error** in `apps/workspace/.oxlintrc.json`,
and the suite is clean. Reach for the real
type, a `Partial<T>` or `Pick<T, …>` of it, `unknown`, or a deliberate
`as unknown as T` at a single documented boundary.

For spec fixtures use the shared helpers rather than casting:

- `@/test-utils/store-fixtures`: `DeepPartial<TState>` plus `asStoreState` for
  zustand selector mocks. The fixture stays partial and every field is still
  checked against the real store.
- `@/test-utils/db-fixtures`: `makeProject`, `makeDocument`, `makeMemoryItem`
  for whole repository rows, and `asDb` for the one drizzle query-builder-stub
  boundary.

`any` in a test double is how fixtures silently drift from the code they stand
in for.

`no-console` allows `warn`, `error` and `debug`. `console.debug` is the dev-only
diagnostic channel and its call sites are `NODE_ENV`-gated.

### Raw `sql<T>` results are not runtime-validated, so coerce at the repository boundary

Drizzle decodes column values only for direct column references. A raw
``sql<Date>`max(...)` `` or ``sql<number>`count(...)` `` fragment is a
compile-time assertion and nothing more, so `tsc` and the LSP see no error even
when the driver hands back a string.

Convert on the way out of the repository (`new Date(row.x)`, `Number(row.x)`)
and never trust the annotation downstream. A missing coercion here produced the
profiler's `toISOString is not a function` crash; that fix and its
`totalDurationMsRaw` sibling are the reference pattern.

### A general-purpose helper belongs in a shared module

Before writing a text transform, a formatter, a date or number helper, or any
other utility that is not *about* your feature's domain, search for an existing
one. If you write a new one, put it where the next caller will look:
`lib/text/`, `lib/utils/`, `lib/format.ts`. `features/<x>/lib/` is for logic
that really is domain logic.

A private copy inside a feature file is a fork. The copies drift, and the drift
is invisible because each one looks locally correct. German transliteration
(`ä`→`ae`, `ß`→`ss`) existed in `MarkdownRenderer.tsx` and in
`norm-entry-editor.tsx`, and a third was being written into `lib/bim/bcf.ts`,
where its absence had been shipping `Beispielstraße` as the filename
`Beispielstra-e`. All three now call `lib/text/latinize.ts`.

A split moves a module's side-effect imports (a stylesheet, a polyfill) with
the code that needs them. When `ReasoningFlow` was split into modules, no new
module took `import '@xyflow/react/dist/style.css'`, and the Herleitung
rendered as a staircase while every spec passed, because the specs mock React
Flow. `tests/react-flow-stylesheet.spec.ts` now holds that one; for any other
library with a stylesheet, check the import at each render site.

Sharing is not merging. Keep the pieces that genuinely differ separate and say
why: `latinize` splits into `transliterateGerman` and `foldDiacritics` precisely
because Markdown anchors must not gain diacritic folding, since their ids are
already published in links. `bucket.ts`, `MentionPicker` and `passage-highlight`
each document why they keep their own fold. **Document the non-adopters.** An
unexplained holdout reads as an oversight and gets "fixed" later.

## Capability doctrine

Four terms, kept distinct on purpose:

| Term | What it is |
|---|---|
| Feature flag | A product decision |
| Environment variable | A real infrastructure dependency |
| Capability | Derived from a dependency, never a second flag |
| Availability | Flag AND capability |

Image upload is the worked example: the `image-upload` flag AND `vlm_available`,
which is derived from the VLM key. Do not add a redundant environment opt-in for
something the dependency already implies.

**An office capability's on/off switch is a WorkOS flag in `feature-flags.ts`,
never an environment variable.** Environment variables are for operator tuning
(a budget, a delay, a page cap) and wiring (a URL, a token). A flag is decided
per organization, changed in the dashboard with no deploy, and reaches the
Python tier through the BFF (`GET /api/internal/stages`), which has no WorkOS
client of its own. `FOLDER_CARDS` and `OFFICE_CONVENTIONS` were built
as variables and replaced by the `folder-cards` and `office-conventions` flags;
their tuning (`FOLDER_CARDS_MONTHLY_TOKENS`) stayed. One exception remains:
`FILING_SUGGESTIONS=off` (`lib/filing/trigger.ts`) switches filing
suggestions off for a whole deployment. It is still a variable, documented in
[`environment-variables.md`](../deployment/environment-variables.md), and
becomes a flag the next time filing suggestions are touched. Registering a flag:
[`workos-provisioning.md`](../deployment/workos-provisioning.md).

## Rules that span services

**One coarse `SourceKind` drives all rendering** (`building_law | office |
project | web | measurement`), defined in
`packages/agent/src/agent/common/source_kinds.py`. Add a kind there only: the
`vocabularies` pre-commit hook (`scripts/generate_vocabularies.py`) generates
the UI's `SOURCE_KINDS` and `SHELVES` into
`apps/workspace/shared/vocabularies.generated.ts`, and
`apps/workspace/bff/source-kinds.ts` holds what the UI makes of each kind. The
fine `norm_registry` lanes are a sub-label within a kind, and the lane-to-kind
table is still a mirror, held by `test_collection_scope_parity.py`. `doc_class`
is human-set and beats every filename guess.

**Correlated debt in shared code belongs in the change that tripped over it.**
YAGNI forbids unused features, not known defects on the path you are walking. If
B needs A to be generic and A is not, lift A here as its own commits. The test:
would you work around it, switch on your type, or leave a descriptor field
unread? Then it is correlated. The register:
[`adding-a-shareable-resource-type.md`](../architecture/adding-a-shareable-resource-type.md).

**A workspace primitive is one HTTP API with a typed client**
([ADR-0055](../adr/0055-api-first-workspace-primitives.md)). The UI, the agent's
tools, tasks and any later integration are equal clients of it; no service
function is reached from a second path, and no contract is written twice.

**The agent door offers what only we have** (ADR-0122 and its amendment). One
MCP server at `/api/mcp` is the agent surface; Claude, Cursor and our own agent
are clients of it, and the UI is another. Each tool is an operation in
`apps/workspace/bff/agent-api/catalog/` that names a route the UI already calls;
the route stays the gate, so authz, rate limit and body schema apply unchanged.
Writes need the person's yes. The door offers the office's workspace (its data
and the actions on it), our domain knowledge (the legal corpus, BIM/IFC analysis
of the office's models) and our agent itself (`agent-ask-*`). It does not offer
what a calling agent already has or what is how our agent works: a service we
only proxy (web search, geocoding), product configuration (models, keys,
budgets, screening and retention policies, settings), model work whose result is
no office artifact, a person's own screen state. Such an operation stays
catalogued with `withheld: { category, reason }`; deleting the line offers it
again. The operator console is for a separate platform server, never the office
door. A new capability is a route plus an operation, not a Python tool.
[`agent-surface.md`](../architecture/agent-surface.md).
