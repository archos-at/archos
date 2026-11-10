# A local copy of the OIB corpus, for the evals and tests

The running platform does not read this directory. Its base corpus lives in
object storage and is uploaded through the platform-admin UI (or
`scripts/upload_oib_corpus.py data/oib`, which sends every PDF in a directory
through the same admin route); see
[`docs/technical-reference/oib-sync.md`](../../docs/technical-reference/oib-sync.md).

What reads `data/oib` is the offline tooling: the retrieval benchmarks
(`evals/oib-retrieval`), the answer-suite census and the filename
tests in `packages/agent/tests/common/test_norm_registry.py`. They need the
Richtlinien PDFs on disk, and the corpus is licensed material that belongs to
whoever operates the platform, so this directory ships **empty**: 71 MB of
binaries in git made every clone pay for documents that change once a year.
Put the PDFs here yourself; those tests skip when there are none.

`*.pdf` here is gitignored. Do not commit the corpus back.

The filename convention matters: `oib_doc_class` in
`packages/agent/src/agent/common/norm_registry.py` derives a document's class from its
prefix, and `oib_family_member` and `guess_display_title` read the Richtlinie
number from it. Keep the names exactly as oib.or.at publishes them, which is not
one spelling:

| Document | Most parts (2023) | OIB-RL 2.2 |
|---|---|---|
| Richtlinie | `oib-rl_2.1_ausgabe_mai_2023.pdf` | `oib-richtlinie_2.2_ausgabe_mai_2023.pdf` |
| Erläuterungen | `erlaeuterungen_oib-rl_2.1_…` | `erlaeuterungen-zu-oib-richtlinie_2.2_…` |
| Änderungen | `aenderungen_oib-rl_2.1_…` | `aenderungen_oib-richtlinie_2.2_…` |

The other editions a Land still binds keep oib.or.at's names too, which follow
neither column:

| Edition | Published name |
|---|---|
| Ausgabe April 2019 | `oib-rl-2.1-brandschutz-bei-betriebsbauten-2019.pdf` (and RL 2–6 alike); RL 1 is `richtlinie_1_12.04.19_0.pdf` |
| Ausgabe September 2025 | `oib-rl_6_september_2025.pdf` |
| Ausgabe März 2015 | `oib-rl-6-energieeinsparung-und-waermeschutz-2015.pdf` |

`canonical_oib_file_name` (`agent/common/oib_file_names.py`) maps every spelling
onto one before parsing; each of these eleven is a manifestation's `corpusFile`
in `configs/knowledge-packs/at.json`. Tying a passage to its edition by its
file's name is the bridge until retrieval reads the edition from the chunk's
`edition_id`. The
Änderungen diff documents are kept out of retrieval by name
(`knowledge_search.exclude_file_names` in `configs/config_oib_openrouter.yml`),
so a new published name there needs a new line in that list;
`TestPublishedOibFilenames` in `packages/agent/tests/common/test_norm_registry.py`
fails until it has one.
