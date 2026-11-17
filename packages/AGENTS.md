# Libraries: `packages/`

The IFC engine, the shared design (`brand/`) and the Python packages of the root
uv workspace. How they fit and how they are tested:
[`python-packages.md`](../docs/architecture/python-packages.md).

- `brand/`: edit `tokens.json`, `identity.json` or `css/`, never an app's copy,
  then run `node packages/brand/sync.mjs` (`--check` fails on drift in CI).
- `ifc-spatial-py` has its own `uv.lock`. Run its suite with `task pkg:test`;
  plain `uv run pytest` lacks the `dev` and `ids` extras.
- The agent's suites that call the engine skip in the root environment. The
  `agent-engine` job installs the engine there and runs them, on a change to
  either side, so a change to an operator's text or a tool's rendering can turn
  it red. Its install floats, like the image's, so a new engine release can too.
- An IFC measurement goes through `ifc_spatial.envelope`: provenance, tolerance
  and method on every value. `tests/test_parity.py` numbers are frozen; nothing
  regenerates them.

## The Python packages: `agent`, `knowledge-layer`, `public-sources`, `ris-adapter`, `tavily-web-search`

- A new package is listed in three places: the root `pyproject.toml`'s workspace
  members and `testpaths`, and `PY_PACKAGES` in `taskfiles/backend.yml`
  (`tests/test_python_packages.py`).
- A package's `tests/` has no `__init__.py`. Shared test helpers live in
  `<package>/testing/<package>_testing/` and are imported by that name
  (`tests/test_test_imports.py`).
- Tests run in parallel by file: write only under `tmp_path`. For Qdrant take
  `qdrant_store`, or `fresh_qdrant_store` for a collection's own life, and keep no
  collection past its module (`test_vector_store_test_pairs.py`).
- A tool's `nat.plugins` entry point goes in its **own package's**
  `pyproject.toml`, one per registering module; a tool on an optional extra gets
  its own (`bim_measure`). Nothing reports a missing one.
- From outside `knowledge_layer`, import a subpackage's names from its surface
  and patch the module object (the `package-surfaces` hook).
- Read a third-party key from the tool's config at build time, never from
  `os.environ` at import.
- Return citable evidence as `GroundingHit` records through
  `render_grounding_block`, every body inside the `passage_fence` fence. Before
  you change a producer, read
  [Returning evidence](../docs/architecture/python-packages.md#returning-evidence).
- Say "no supporting passage" only through `GroundingBlock.coverage_gap`, and
  never withhold a passage (ADR-0064).
