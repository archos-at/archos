# The libraries under `packages/`

What lives in `packages/`, how each family is installed and tested, and the
producer rules the retrieval plugins follow. The short, act-on-it form is
[`packages/AGENTS.md`](../../packages/AGENTS.md).

## Three families

- **The IFC engine**, `ifc-spatial-py`: the spatial engine over IFC on
  IfcOpenShell, and the one engine. The agent reaches it through
  `packages/agent/src/agent/knowledge/ifc_spatial_client.py` (ADR-0045). It sits
  outside the root uv workspace with its own `uv.lock`, so IfcOpenShell stays out
  of the root lock.
- **The Python packages of the root uv workspace**: `agent`, `knowledge-layer`,
  `public-sources`, `ris-adapter`, `tavily-web-search`.
- **`brand/`**, the shared corporate design. Neither of the above; its
  [`README.md`](../../packages/brand/README.md) is the reference.

## `brand/`

`tokens.json` is the source. `build-tokens.mjs` renders `dist/`, and `sync.mjs`
writes committed copies into `apps/website` and `apps/workspace`, each only its
layer: a token with `"scope": "app"` reaches the workspace only. `--check` fails
on drift and on a file a copy should not hold. `sync.mjs` also writes
`identity.json` into `packages/agent/src/agent/common/` and the product's name
into the literal copies `name-copies.mjs` lists (ADR-0149). The brand rules a
machine can hold run in `scripts/check_brand_rules.mjs`. Brand strings live in
`identity.json` only, the React components in `react/`, AuthKit's stylesheet in
`authkit/` (pasted into WorkOS branding per environment). `mark.svg` and
`build-brand-assets.mjs` render the icons into both apps with `apps/website`'s
sharp; `email-signatures.mjs` writes the founders' signatures from
`identity.json`; `art/riso/` is the riso print kit whose committed outputs are
the app's vignettes.

## The IFC engine

A TypeScript twin, `ifc-spatial`, was deleted on 2026-11-04: it answered nothing
in the product and only cross-checked this engine, and two engines are two
definitions of every operator. The reference numbers it produced stay in
`ifc-spatial-py/tests/test_parity.py` as frozen regressions; its fixtures live in
`ifc-spatial-py/tests/fixtures/`.

**The gate.** CI runs the suite in the `packages` job of
[`ci.yml`](../../.github/workflows/ci.yml), behind a `packages/ifc-spatial-py/**`
paths filter; `CI OK` requires the job. It is its own job because the package's
own `uv.lock` means the backend tier's install cannot run it.

```bash
task pkg:install    # its toolchain; `task setup` does this too
task pkg:test       # pkg:test:py (636 tests, 1m40s on four workers, measured 2026-10-22), then infra:test
```

`task verify` does not run it: it is a per-commit tax on a directory most changes
never touch, and CI pays it on the commits that earn it. The task syncs with
`--all-extras`, not `--extra dev`: pytest is the `dev` extra, and the suite also
collects `test_ids_export.py`, which needs `ifctester` from the `ids` extra. Plain
`uv run pytest` installs neither.

**Measurements.** Every answer goes through `ifc_spatial.envelope`: a provenance
(`declared`, `computed`, `inferred`, `undecidable`), a tolerance and a method on
every measurement, elements by GlobalId, a German `missing.what` and `remedy` on
every refusal, and an exception, never an undecidable, for a GlobalId the file
does not contain. A measurement without provenance is a number the agent cannot
defend, and it is not a citable source.

**Dependencies.** The `shapely>=2.1` floor in `ifc-spatial-py/pyproject.toml` is
for the test suite's GEOS cross-checks, not for the operators (the comment above
the pin names the two functions). `ifc-spatial-py/COVERAGE.md` and `CORPUS.md`
record what the engine actually covers, which is less than the operator list
suggests.

## The Python packages

`agent` (`packages/agent/src/agent`, distribution `agent`) has its suite in
`packages/agent/tests`, which runs in the core suite (`be:test`, with the coverage
gate) beside `tests/`, not in `be:test:sources`; `tests/test_python_packages.py`
knows that.

`knowledge-layer` (ingestion and retrieval), `ris-adapter` (the legal adapter)
and `tavily-web-search` (web search) are agent-runtime plugins. `public-sources`
(legal and geodata sources as configured records over protocol access types and
format engines, ADR-0162) is a library and the sandboxed fetcher, no plugin. A new
country's source is a record under `configs/sources/`, not a package. Each is its
own uv workspace member with its own `pyproject.toml` and tests, installed into
the shared venv.

### Running their tests

`task be:test:sources` runs them, and CI's Backend suites job runs the same task.
Each package is named in three places, because `packages/` also holds the IFC
package, which no glob may catch: the root `pyproject.toml`'s
`[tool.uv.workspace]` members and pytest `testpaths`, and `PY_PACKAGES` in
`taskfiles/backend.yml`. `tests/test_python_packages.py` fails a package listed in
one and not the others. A new package then needs `uv sync --group dev`.

No package carries a `tests/__init__.py`. With one, pytest names its conftest
`tests.conftest`, the same name as the repo's own `tests/` suite, and a run over
both aborts with "Plugin already registered under a different name". A helper a
test needs from another file lives in the package's support package,
`<package>/testing/<package>_testing/`, which pytest's `pythonpath` lists, and is
imported by that name (`from ris_adapter_testing.lookup import LookupHarness`).
`tests/test_test_imports.py` fails a dotted path through a `tests` directory,
because a hyphenated `packages/<distribution>/` has no dotted path. A conftest
only registers fixtures, imported from there.

The run is parallel (`--dist loadfile`), so a test may not write into the
repository or share state with a test in another file;
`test_qdrant_import_boundary.py` plants its offenders under `tmp_path` for that
reason. The Qdrant fixtures and their cost (one payload index per indexed field,
about 300 MiB of storage per empty collection, CI's tmpfs full at about 27
collections) are documented in
`packages/knowledge-layer/testing/knowledge_layer_testing/vector_store.py`, and
`test_vector_store_test_pairs.py` holds one module's pair per process. A test
asserts what our code sends and gets back, not what Qdrant does on its own.
Locally, a run without `QDRANT_TEST_URL` skips them (on CI it fails); a Qdrant
1.19 release binary on port 6333 is enough.

### Registering a plugin

`@register_function` with a `FunctionBaseConfig` subclass, plus a `nat.plugins`
entry point in the package's own `pyproject.toml`, one per module that registers
a tool. A tool on an optional dependency (ifcopenshell, shapely) gets an entry
point of its own rather than importing from a neighbour's `register`, or one
missing extra takes the whole plugin down; `bim_measure` is the worked example.
A tool the UI can toggle is in the `data_sources` registry in
`configs/config_oib_openrouter.yml` (entry shape `DataSourceEntry` in
`agent/common/data_source_registry.py`). A third-party key is read from the tool's
config when the tool is built, so a deployment that does not use the plugin can
still import it.

### Returning evidence

A producer builds `GroundingHit` records and calls `render_grounding_block`
(`agent/common/grounding_block.py`, ADR-0061). It never writes `Source:`,
`Citation:` or `Relevance Score:` lines itself, and never puts a body outside the
renderer's `<document_content>` fence (`agent/common/passage_fence.py`): that
fence keeps an instruction inside a document or a filed mail from reading as one.
A trailer that prints a document's own lines goes through `fence()` too, and code
that splits rendered text on `--- Result N ---` or `## Trace-Lanes` finds them
with `passage_fence.unfenced`, or a body spelling them forges a hit. The renderer
files the records under the bytes it returns, and
`extract_sources_from_tool_result` reads them back; text it did not render falls
to the regex parser, which recovers less.

**The family overview.** A query that names a Richtlinie and nothing else returns
the whole family: `norm_registry.family_query_number` detects it,
`read_passage.family_overview` reads every member the corpus holds, and
`ranked_search.RankedSearch` renders their scope passages ahead of the ranked hits
with one `## Gliederung` per member as the block's trailer. It keeps at most four
ranked hits (`family_branch.FAMILY_RANKED_HITS`), and the requery judge does not
run on a query whose overview was built (`search_input["requery_skipped"] =
"family"`); a family the corpus lacks is judged as usual. Membership is derived
from what is indexed, never listed.

**The coverage gap.** A ranked search the requery judge found insufficient is
re-read by the `jev` decider after the requery round (`requery.judge_coverage`). A
complete "no" adds a `Coverage: insufficient — …` line
(`GroundingBlock.coverage_gap`) and keeps the pool whole (ADR-0064: a decision
never withholds a passage); anything less claims nothing. A producer says
"insufficient" through that field, never as its own text: the line also says what
it means (`COVERAGE_GAP_LABEL`, `COVERAGE_GAP_NOTE`), which the system prompt no
longer does. The full walk-through is in
[`backend-deep-dive.md`](backend-deep-dive.md#agentic-retrieval-quality-package-adr-0039).
