from __future__ import annotations

import argparse
import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path

COHORT_OVERVIEW = "overview"
COHORT_EXACT_ID = "exact-id"
COHORT_PARAPHRASE = "paraphrase"
COHORTS = (COHORT_OVERVIEW, COHORT_EXACT_ID, COHORT_PARAPHRASE)

RETRIEVE_DEPTH = 120

_FIXTURE_BOILERPLATE = (
    "Österreichisches Institut für Bautechnik. Ausgabe Mai 2023. "
    "Diese Richtlinie gilt für Gebäude. Die Anforderungen müssen eingehalten werden. "
    "Was hier steht, gilt für alle: wer baut, muss prüfen, kann fragen und darf vorschlagen, "
    "wie es werden soll. Der die das den dem einen einer eines und oder aber denn doch aus bei "
    "bis ins zum zur vom mit von nach über unter zwischen sein sind ein eine nicht kein sehr nur "
    "auch schon noch als zu im am beim."
)


FIXTURE_TEXTS: dict[str, str] = {
    "oib-rl_1_ausgabe_mai_2023.pdf": (
        "OIB-Richtlinie 1 Standsicherheit. " + _FIXTURE_BOILERPLATE + " Das Tragwerk muss alle Lasten "
        "sicher abtragen. Die Tragfähigkeit ist für ständige und veränderliche Einwirkungen "
        "nachzuweisen. Unzulässige Verformung und Setzung sind zu vermeiden. Punkt 2 Standsicherheit."
    ),
    "oib-rl_1_leitfaden_ausgabe_mai_2023.pdf": (
        "Leitfaden zur OIB-Richtlinie 1. " + _FIXTURE_BOILERPLATE + " Anwendungshinweise zum Nachweis "
        "von Tragwerk und Standsicherheit bei üblichen Hochbauten."
    ),
    "erlaeuterungen_oib-rl_1_ausgabe_mai_2023.pdf": (
        "Erläuterungen zur OIB-Richtlinie 1. " + _FIXTURE_BOILERPLATE + " Begründung der Anforderungen "
        "an Standsicherheit und Dauerhaftigkeit des Tragwerks."
    ),
    "oib-rl_2_ausgabe_mai_2023.pdf": (
        "OIB-RL 2 (OIB-Richtlinie 2) Brandschutz. " + _FIXTURE_BOILERPLATE + " Gebäude werden nach "
        "Fluchtniveau in Gebäudeklassen eingeteilt. Brandabschnitte begrenzen die Brandausbreitung. "
        "Fluchtwege führen über Treppenhäuser ins Freie. Punkt 3 Gebäudeklassen. Punkt 5.1.1 "
        "Gehweglänge höchstens 40 m bis zum Ausgang. Punkt 5.1.2 Messung ab der Wohnungseingangstüre. "
        "Punkt 5.1.4 zweiter Fluchtweg aus der Wohnung. Das Wohnhaus braucht sichere Fluchtwege."
    ),
    "oib-rl_2_leitfaden_ausgabe_mai_2023.pdf": (
        "Leitfaden zur OIB-RL 2 (OIB-Richtlinie 2). " + _FIXTURE_BOILERPLATE + " Anwendung des Brandschutzes "
        "im Wohnhaus: Gebäudeklasse bestimmen, Gehweglänge messen, Fluchtwege freihalten."
    ),
    "oib-rl_2.1_ausgabe_mai_2023.pdf": (
        "OIB-RL 2.1 (OIB-Richtlinie 2.1) Brandschutz beim Wohnhaus. " + _FIXTURE_BOILERPLATE + " Ergänzende "
        "Anforderungen für Wohngebäude der Gebäudeklassen 1 bis 3. Jede Wohnung braucht einen sicheren "
        "Fluchtweg; ab einer gewissen Größe ist ein zweiter Fluchtweg nötig. Das Haus muss im Brandfall "
        "rasch verlassen werden können."
    ),
    "oib-rl_2.2_ausgabe_mai_2023.pdf": (
        "OIB-RL 2.2 (OIB-Richtlinie 2.2) Brandschutz. " + _FIXTURE_BOILERPLATE + " Ergänzende Anforderungen "
        "für Garagen und Stellplätze. Brandabschnitte in Garagen, Rauchableitung, tragbare Feuerlöscher."
    ),
    "oib-rl_2.3_ausgabe_mai_2023.pdf": (
        "OIB-RL 2.3 (OIB-Richtlinie 2.3) Brandschutz. " + _FIXTURE_BOILERPLATE + " Ergänzende Anforderungen "
        "für Versammlungsstätten. Fluchtwege für Publikum, Bestuhlung, Sicherheitsbeleuchtung."
    ),
    "erlaeuterungen_oib-rl_2_ausgabe_mai_2023.pdf": (
        "Erläuterungen zur OIB-Richtlinie 2. " + _FIXTURE_BOILERPLATE + " Warum Gebäudeklassen, "
        "Brandabschnitte und die Gehweglänge von 40 m so festgelegt sind."
    ),
    "erlaeuterungen_oib-rl_2.1_ausgabe_mai_2023.pdf": (
        "Erläuterungen zur OIB-Richtlinie 2.1. " + _FIXTURE_BOILERPLATE + " Hintergründe zu den Wohnhaus-Regelungen."
    ),
    "erlaeuterungen_oib-rl_2.2_ausgabe_mai_2023.pdf": (
        "Erläuterungen zur OIB-Richtlinie 2.2. " + _FIXTURE_BOILERPLATE + " Hintergründe zu den Garagen-Regelungen."
    ),
    "erlaeuterungen_oib-rl_2.3_ausgabe_mai_2023.pdf": (
        "Erläuterungen zur OIB-Richtlinie 2.3. " + _FIXTURE_BOILERPLATE + " Hintergründe zu den "
        "Versammlungsstätten-Regelungen."
    ),
    "oib-rl_3_ausgabe_mai_2023.pdf": (
        "OIB-Richtlinie 3 Hygiene, Gesundheit und Umweltschutz. " + _FIXTURE_BOILERPLATE + " Trinkwasser muss "
        "in ausreichender Menge zur Verfügung stehen. Aufenthaltsräume brauchen Belichtung und Lüftung. "
        "Feuchtigkeit ist zu vermeiden. Punkt 3 Trinkwasser und Abwasser."
    ),
    "erlaeuterungen_oib-rl_3_ausgabe_mai_2023.pdf": (
        "Erläuterungen zur OIB-Richtlinie 3. " + _FIXTURE_BOILERPLATE + " Warum Trinkwasser, Hygiene und "
        "Belichtung so geregelt sind."
    ),
    "oib-rl_4_ausgabe_mai_2023.pdf": (
        "OIB-Richtlinie 4 Nutzungssicherheit und Barrierefreiheit. " + _FIXTURE_BOILERPLATE + " Die nutzbare "
        "Breite von Fluchtwegen muss mindestens 1,20 m betragen. Treppen brauchen Geländer. Barrierefreie "
        "Türen müssen ausreichend breit sein; Rampen ersetzen Stufen. Punkt 2.4.1 Fluchtwegbreite."
    ),
    "erlaeuterungen_oib-rl_4_ausgabe_mai_2023.pdf": (
        "Erläuterungen zur OIB-Richtlinie 4. " + _FIXTURE_BOILERPLATE + " Hintergründe zu Nutzungssicherheit, "
        "Breite der Fluchtwege und barrierefreien Türen."
    ),
    "oib-rl_5_ausgabe_mai_2023.pdf": (
        "OIB-Richtlinie 5 Schallschutz. " + _FIXTURE_BOILERPLATE + " Wohnungstrennwände müssen ausreichende "
        "Schalldämmung gegen Luftschall bieten. Der Trittschall aus der Nachbarwohnung ist zu begrenzen. "
        "Das Wohnhaus braucht ruhige Wohnungen. Punkt 2 Schallschutz im Wohngebäude."
    ),
    "erlaeuterungen_oib-rl_5_ausgabe_mai_2023.pdf": (
        "Erläuterungen zur OIB-Richtlinie 5. " + _FIXTURE_BOILERPLATE + " Messung von Schallschutz und "
        "Trittschall zwischen Wohnungen."
    ),
    "oib-rl_6_ausgabe_mai_2023.pdf": (
        "OIB-Richtlinie 6 Energieeinsparung und Wärmeschutz. " + _FIXTURE_BOILERPLATE + " Beim Neubau dürfen "
        "die Wärmedurchgangskoeffizienten nicht überschritten werden. Jeder Wert der Gebäudehülle zählt: "
        "Wände, Fenster, Dach. Der Heizwärmebedarf ist zu begrenzen. Sommerlicher Wärmeschutz ist "
        "einzuhalten. Punkt 3 Wärmeschutz im Neubau."
    ),
    "oib-rl_6-leitfaden_ausgabe_mai_2023.pdf": (
        "Leitfaden zur OIB-Richtlinie 6. " + _FIXTURE_BOILERPLATE + " Rechenbeispiele für Wärmeschutz, "
        "Werte der Bauteile und Heizwärmebedarf im Neubau."
    ),
    "erlaeuterungen_oib-rl_6_ausgabe_mai_2023.pdf": (
        "Erläuterungen zur OIB-Richtlinie 6. " + _FIXTURE_BOILERPLATE + " Warum jeder Wert so festgelegt ist."
    ),
    "oib-rl_begriffsbestimmungen_ausgabe_mai_2023.pdf": (
        "OIB-Begriffsbestimmungen. " + _FIXTURE_BOILERPLATE + " Gebäudeklasse nach Fluchtniveau. "
        "Fluchtniveau ist der Höhenunterschied zum Gelände. Gebäudehöhe, Bruttogeschossfläche, Bauweise."
    ),
    "oib-rl_zitierte_normen_und_sonstige_technische_regelwerke_ausgabe_mai_2023_rev.1.pdf": (
        "Zitierte Normen und sonstige technische Regelwerke, revidiert. " + _FIXTURE_BOILERPLATE + " Liste "
        "der ÖNORMEN und Richtlinien, auf die verwiesen wird. Jede Norm ist mit Ausgabedatum genannt."
    ),
    "oib-rl_zitierte_normen_und_sonstige_technische_regelwerke_ausgabe_mai_2023.pdf": (
        "Zitierte Normen und sonstige technische Regelwerke, ersetzte Ausgabe. " + _FIXTURE_BOILERPLATE + " "
        "Durch rev.1 ersetzt; wird in der Abfrage herausgefiltert."
    ),
    "aenderungen_oib-rl_1_ausgabe_mai_2023.pdf": (
        "Änderungen OIB-Richtlinie 1 gegenüber Ausgabe 2019. Punkt 2 redaktionell angepasst, Tabelle neu."
    ),
    "aenderungen_oib-rl_1_leitfaden_ausgabe_mai_2023.pdf": (
        "Änderungen Leitfaden OIB-Richtlinie 1 gegenüber Ausgabe 2019. Beispiele aktualisiert."
    ),
    "aenderungen_oib-rl_2_ausgabe_mai_2023.pdf": (
        "Änderungen OIB-Richtlinie 2 gegenüber Ausgabe 2019. Brandschutz redaktionell angepasst, "
        "Gehweglänge klargestellt, Punkt 5.1.1 neu gefasst."
    ),
    "aenderungen_oib-rl_2_leitfaden_ausgabe_mai_2023.pdf": (
        "Änderungen Leitfaden OIB-Richtlinie 2 gegenüber Ausgabe 2019."
    ),
    "aenderungen_oib-rl_2.1_ausgabe_mai_2023.pdf": ("Änderungen OIB-Richtlinie 2.1 gegenüber Ausgabe 2019."),
    "aenderungen_oib-rl_2.2_ausgabe_mai_2023.pdf": ("Änderungen OIB-Richtlinie 2.2 gegenüber Ausgabe 2019."),
    "aenderungen_oib-rl_2.3_ausgabe_mai_2023.pdf": ("Änderungen OIB-Richtlinie 2.3 gegenüber Ausgabe 2019."),
    "aenderungen_oib-rl_3_ausgabe_mai_2023.pdf": (
        "Änderungen OIB-Richtlinie 3 gegenüber Ausgabe 2019. Hygiene redaktionell angepasst."
    ),
    "aenderungen_oib-rl_4_ausgabe_mai_2023.pdf": ("Änderungen OIB-Richtlinie 4 gegenüber Ausgabe 2019."),
    "aenderungen_oib-rl_5_ausgabe_mai_2023.pdf": ("Änderungen OIB-Richtlinie 5 gegenüber Ausgabe 2019."),
    "aenderungen_oib-rl_6_ausgabe_mai_2023.pdf": ("Änderungen OIB-Richtlinie 6 gegenüber Ausgabe 2019."),
    "aenderungen_oib-rl_6-leitfaden_ausgabe_mai_2023.pdf": (
        "Änderungen Leitfaden OIB-Richtlinie 6 gegenüber Ausgabe 2019."
    ),
    "aenderungen_oib-rl_begriffsbestimmungen_ausgabe_mai_2023.pdf": (
        "Änderungen Begriffsbestimmungen gegenüber Ausgabe 2019."
    ),
    "aenderungen_oib-rl_zitierte_normen_und_sonstige_technische_regelwerke_ausgabe_mai_2023.pdf": (
        "Änderungen zitierte Normen gegenüber Ausgabe 2019."
    ),
    "aenderungen_oib-rl_zitierte_normen_und_sonstige_technische_regelwerke_ausgabe_mai_2023_rev.1.pdf": (
        "Änderungen zitierte Normen revidiert gegenüber Ausgabe 2019."
    ),
}

assert len(FIXTURE_TEXTS) == 39, f"fixture must cover all 39 data/oib files, has {len(FIXTURE_TEXTS)}"


@dataclass(frozen=True)
class FixtureDoc:
    file_name: str
    text: str


@dataclass(frozen=True)
class GoldenEntry:
    id: str
    cohort: str
    question: str
    expected: tuple[str, ...]
    notes: str
    calibration_pending: bool


@dataclass(frozen=True)
class QueryResult:
    entry: GoldenEntry
    exact_terms: tuple[str, ...]
    sparse_terms: tuple[str, ...]
    ranked: tuple[str, ...]
    recall: float
    mrr: float
    missing: tuple[str, ...]
    hyde_fired: bool = False
    vector_ranked: tuple[str, ...] = ()
    vector_recall: float = 0.0


@dataclass
class CohortScores:
    label: str
    n: int
    recall: float
    mrr: float
    empty_share: float
    vector_recall: float = 0.0


@dataclass
class Report:
    k: int
    results: list[QueryResult] = field(default_factory=list)
    cohorts: list[CohortScores] = field(default_factory=list)


def package_root() -> Path:
    return Path(__file__).resolve().parents[2]


def default_golden_path() -> Path:
    return package_root() / "fixtures" / "oib_golden_overview.json"


def _k() -> int:
    try:
        from oib_retrieval.corpus import production_retrieval_settings

        return int(production_retrieval_settings().top_k)
    except Exception:  # pragma: no cover - config absence must not break the harness
        return 16


def fixture_docs() -> list[FixtureDoc]:
    return [FixtureDoc(file_name=name, text=FIXTURE_TEXTS[name]) for name in sorted(FIXTURE_TEXTS)]


def production_excluded() -> frozenset[str]:
    try:
        from oib_retrieval.corpus import production_excluded_file_names

        return production_excluded_file_names()
    except Exception:  # pragma: no cover - config absence must not break the harness
        return frozenset()


def load_golden(path: str | Path, *, known_files: frozenset[str] | None = None) -> list[GoldenEntry]:
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)

    raw_entries = payload["entries"]
    entries: list[GoldenEntry] = []
    seen: set[str] = set()
    for raw in raw_entries:
        entry_id = raw["id"]
        if entry_id in seen:
            raise ValueError(f"duplicate golden entry id: {entry_id!r}")
        seen.add(entry_id)
        cohort = raw["cohort"]
        if cohort not in COHORTS:
            raise ValueError(f"{entry_id!r}: unknown cohort {cohort!r}; expected one of {COHORTS}")
        question = raw["question"]
        if not question or not question.strip():
            raise ValueError(f"{entry_id!r}: empty question")
        expected = tuple(raw["expected_files"])
        if not expected:
            raise ValueError(f"{entry_id!r}: no expected files")
        if len(set(expected)) != len(expected):
            raise ValueError(f"{entry_id!r}: duplicate expected files")
        for name in expected:
            if not name.endswith(".pdf"):
                raise ValueError(f"{entry_id!r}: expected file {name!r} is not a PDF name")
        entries.append(
            GoldenEntry(
                id=entry_id,
                cohort=cohort,
                question=question,
                expected=expected,
                notes=raw.get("notes", ""),
                calibration_pending=bool(raw.get("calibration_pending", True)),
            )
        )

    if known_files is not None:
        for entry in entries:
            for name in entry.expected:
                if name not in known_files:
                    raise ValueError(f"{entry.id!r}: expected file {name!r} is not in the fixture corpus")

    excluded = production_excluded()
    for entry in entries:
        for name in entry.expected:
            if name in excluded:
                raise ValueError(
                    f"{entry.id!r}: expected file {name!r} is on production's exclude_file_names "
                    "list and can never be retrieved — the label is unanswerable by design"
                )

    by_cohort: dict[str, int] = {cohort: 0 for cohort in COHORTS}
    for entry in entries:
        by_cohort[entry.cohort] += 1
    if not (25 <= len(entries) <= 40):
        raise ValueError(f"golden set has {len(entries)} entries; expected 25-40 (~30)")
    for cohort in COHORTS:
        if by_cohort[cohort] < 8:
            raise ValueError(f"cohort {cohort!r} has only {by_cohort[cohort]} entries; expected >= 8")

    return entries


def build_index(docs: list[FixtureDoc]):
    from oib_retrieval.corpus import Chunk
    from oib_retrieval.lexical import build_index

    chunks = [
        Chunk(chunk_id=f"fixture:{doc.file_name}", text=doc.text, file_name=doc.file_name, page=1, arm="fixture")
        for doc in docs
    ]
    return build_index(chunks)


def exact_terms_for(query: str) -> list[str]:
    from agent.common.legal_terms import extract_exact_terms

    return extract_exact_terms(query)


def sparse_terms_for(index, query: str) -> list[str]:
    from oib_retrieval.lexical import selected_terms

    return selected_terms(index, query)


def exact_files_for(terms: list[str], docs: list[FixtureDoc]) -> list[str]:
    if not terms:
        return []
    from knowledge_layer.search import selective_terms

    haystacks = [f"{doc.file_name}\n{doc.text}" for doc in docs]
    frequencies = {term: sum(1 for hay in haystacks if term in hay) for term in terms}
    kept = selective_terms(frequencies, len(docs))
    if not kept:
        return []
    return [doc.file_name for doc, hay in zip(docs, haystacks, strict=True) if any(term in hay for term in kept)]


def default_vector_fixture_path() -> Path:
    return Path(__file__).resolve().parents[2] / "fixtures" / "vector_channel_recorded.json"


def load_recorded_vector(path: str | Path | None = None) -> dict:
    fixture = Path(path) if path is not None else default_vector_fixture_path()
    if not fixture.exists():
        return {}
    return json.loads(fixture.read_text())


def vector_files_for(recorded: dict, entry_id: str) -> list[str]:
    ranking = (recorded.get("rankings") or {}).get(entry_id) or []
    return [file_name for file_name, _score in ranking]


def sparse_files_for(index, query: str, *, depth: int = RETRIEVE_DEPTH) -> list[str]:
    from oib_retrieval.lexical import search

    ranked: list[str] = []
    for chunk in search(index, query, depth):
        if chunk.file_name not in ranked:
            ranked.append(chunk.file_name)
    return ranked


def rank_files(query: str, docs: list[FixtureDoc], index, *, depth: int = RETRIEVE_DEPTH) -> list[str]:
    exact = exact_files_for(exact_terms_for(query), docs)
    exclude = set(exact)
    return exact + [name for name in sparse_files_for(index, query, depth=depth) if name not in exclude]


def fuse_file_channels(channels: list[list[str]]) -> list[str]:
    from types import SimpleNamespace

    from knowledge_layer.search import fuse_with_ranks

    doubles = [[SimpleNamespace(chunk_id=name) for name in channel] for channel in channels]
    return [chunk.chunk_id for chunk, _, _ in fuse_with_ranks(doubles)]


def rank_files_with_hyde(
    query: str, draft: str, docs: list[FixtureDoc], index, *, depth: int = RETRIEVE_DEPTH
) -> list[str]:
    return fuse_file_channels(
        [
            exact_files_for(exact_terms_for(query), docs),
            sparse_files_for(index, query, depth=depth),
            exact_files_for(exact_terms_for(draft), docs),
            sparse_files_for(index, draft, depth=depth),
        ]
    )


def hyde_fires(query: str) -> bool:
    from agent.common.hyde import should_draft

    return should_draft(query, enabled=True)


def apply_production_filter(ranked: list[str]) -> list[str]:
    excluded = production_excluded()
    return [name for name in ranked if name not in excluded]


def run(
    entries: list[GoldenEntry] | None = None,
    docs: list[FixtureDoc] | None = None,
    *,
    k: int | None = None,
    hyde_drafter: Callable[[GoldenEntry], str | None] | None = None,
) -> Report:
    from oib_retrieval.metrics import mean
    from oib_retrieval.metrics import mrr
    from oib_retrieval.metrics import recall_at_k

    cutoff = k if k is not None else _k()
    docs = fixture_docs() if docs is None else docs
    if entries is None:
        entries = load_golden(default_golden_path(), known_files=frozenset(FIXTURE_TEXTS))
    index = build_index(docs)
    recorded_vector = load_recorded_vector()

    results: list[QueryResult] = []
    for entry in entries:
        exact = tuple(exact_terms_for(entry.question))
        sparse = tuple(sparse_terms_for(index, entry.question))
        hyde_fired = False
        if hyde_drafter is not None and hyde_fires(entry.question):
            try:
                draft = hyde_drafter(entry)
            except Exception:
                draft = None
            if draft and draft.strip():
                ranked = tuple(apply_production_filter(rank_files_with_hyde(entry.question, draft, docs, index)))
                hyde_fired = True
            else:
                ranked = tuple(apply_production_filter(rank_files(entry.question, docs, index)))
        else:
            ranked = tuple(apply_production_filter(rank_files(entry.question, docs, index)))
        expected = set(entry.expected)
        vector_ranked = tuple(apply_production_filter(vector_files_for(recorded_vector, entry.id)))
        results.append(
            QueryResult(
                entry=entry,
                exact_terms=exact,
                sparse_terms=sparse,
                ranked=ranked,
                recall=recall_at_k(list(ranked), expected, cutoff),
                mrr=mrr(list(ranked), expected),
                missing=tuple(f for f in entry.expected if f not in list(ranked)[:cutoff]),
                hyde_fired=hyde_fired,
                vector_ranked=vector_ranked,
                vector_recall=recall_at_k(list(vector_ranked), expected, cutoff),
            )
        )

    cohorts: list[CohortScores] = []
    for label, subset in [("all", results)] + [
        (cohort, [r for r in results if r.entry.cohort == cohort]) for cohort in COHORTS
    ]:
        cohorts.append(
            CohortScores(
                label=label,
                n=len(subset),
                recall=mean([r.recall for r in subset]),
                mrr=mean([r.mrr for r in subset]),
                empty_share=(sum(1 for r in subset if not r.ranked) / len(subset)) if subset else 0.0,
                vector_recall=mean([r.vector_recall for r in subset]),
            )
        )
    return Report(k=cutoff, results=results, cohorts=cohorts)


def _distinguishability_line(report: Report) -> str:
    siblings = [r for r in report.results if r.entry.id.startswith("ov-rl")]
    if not siblings:
        return "distinguishability: no 'oib N' siblings in this set."
    ranked = [r for r in siblings if r.ranked]
    deterministic = f"{len({r.ranked for r in ranked})}/{len(ranked)} distinct" if ranked else "nothing ranked"
    vector = [r for r in siblings if r.vector_ranked]
    vector_note = f"{len({r.vector_ranked for r in vector})}/{len(vector)} distinct" if vector else "not recorded"
    return (
        f"distinguishability across the {len(siblings)} 'oib N' questions — "
        f"deterministic: {deterministic}; vector: {vector_note}. "
        "One ranking for many questions means the corpus was returned, not searched."
    )


def format_report(report: Report) -> str:
    lines = [
        "OIB OVERVIEW GOLDEN RECALL",
        f"cutoff k={report.k} (production top_k); fixture: {len(FIXTURE_TEXTS)} files; "
        f"excluded per query: {len(production_excluded())}",
        "",
        f"{'cohort':<12}{'n':>4}{'recall@k':>10}{'mrr':>8}{'empty':>8}{'vector@k':>10}",
    ]
    for scores in report.cohorts:
        lines.append(
            f"{scores.label:<12}{scores.n:>4}{scores.recall:>10.3f}{scores.mrr:>8.3f}"
            f"{scores.empty_share:>8.2f}{scores.vector_recall:>10.3f}"
        )
    recorded = load_recorded_vector()
    lines += [
        "",
        "recall@k / mrr / empty = the DETERMINISTIC channels (exact + sparse) only.",
        (
            f"vector@k = the recorded vector channel alone ({recorded.get('model', 'not recorded')}), "
            "reported beside them and never fused: it is measured on the real corpus, they are "
            "measured on the synthetic mirror."
        ),
        _distinguishability_line(report),
        "",
        "empty = share of queries with no firing deterministic channel (ranked nothing).",
        f"hyde drafts fused: {sum(1 for result in report.results if result.hyde_fired)}/{len(report.results)}.",
        "",
        "per-query (expected vs got; missing = expected files outside the ranking):",
    ]
    for result in report.results:
        first_hit = next(
            (rank + 1 for rank, name in enumerate(result.ranked) if name in set(result.entry.expected)),
            None,
        )
        lines.append(
            f"[{result.entry.cohort:<10}] {result.entry.id}: "
            f"recall@{report.k}={result.recall:.2f} mrr={result.mrr:.3f} "
            f"first_hit={first_hit if first_hit is not None else '-'} "
            f"exact={list(result.exact_terms)!r} sparse={list(result.sparse_terms)!r} "
            f"hyde={1 if result.hyde_fired else 0}"
        )
        lines.append(f"  expected: {list(result.entry.expected)}")
        lines.append(f"  got     : {list(result.ranked[:8])}{' …' if len(result.ranked) > 8 else ''}")
        if result.missing:
            lines.append(f"  missing : {list(result.missing)}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="File-level golden recall for broad/exact/paraphrased OIB queries (backlog item 12)."
    )
    parser.add_argument("--golden", default=str(default_golden_path()))
    parser.add_argument("--k", type=int, default=None, help="Cutoff (default: production top_k).")
    args = parser.parse_args(argv)

    started = time.perf_counter()
    entries = load_golden(args.golden, known_files=frozenset(FIXTURE_TEXTS))
    report = run(entries, k=args.k)
    elapsed = time.perf_counter() - started
    print(format_report(report))
    print(f"\n({len(entries)} queries in {elapsed:.1f}s, deterministic, offline.)")
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
