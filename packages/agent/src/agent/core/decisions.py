from __future__ import annotations

import logging
import re
from collections.abc import Mapping
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from agent.common.estate_paths import MOUNT_ROOTS
from agent.common.estate_paths import SHELF_MOUNTS
from agent.common.estate_paths import estate_path

logger = logging.getLogger(__name__)

SLOT = "turn"

KNOWLEDGE_SEARCH = "knowledge_search"
GREP = "grep"

NEEDS_EVIDENCE_THRESHOLD = 0.5
FAMILY_THRESHOLD = 0.5
MAX_FAMILY_PREFETCH = 2
CARD_THRESHOLD = 0.6
MAX_CARD_SHAPES = 2
CORPUS_THRESHOLD = 0.5
PRECEDENT_THRESHOLD = 0.55
PRECEDENT_THRESHOLD_LAW = 0.7
PROJECT_LOOKUP = "project_lookup"
SKILL_THRESHOLD = 0.6
SKILL_FIT_THRESHOLD = 0.1
SELF_CONTAINED_THRESHOLD = 0.5
MAX_ATTACHED_SHAPES = 5

CORPUS_OPTIONS: Mapping[str, str] = {
    "baurecht": (
        "Austrian building law and standards: an OIB-Richtlinie, a Bauordnung of a Land, an ÖNORM, "
        "a Verordnung — a requirement, a limit, a class, a procedure, or what a regulation says."
    ),
    "projekt": (
        "The files of THIS project: a drawing, a Bescheid, a report, a model, a submission, or what the "
        "project's own documents contain, show or require."
    ),
    "buero": "The office's archive: templates, standard details, house documents, office guidelines.",
    "referenz": (
        "The office's OTHER projects: how an earlier or comparable project of this office solved something, "
        "what the authority demanded or granted there, a detail, Gutachten or Bescheid from a past project, "
        "or which past projects resemble this one."
    ),
    "modell": (
        "The building model (IFC/BIM): storeys, rooms, elements, dimensions, quantities, areas, heights, "
        "or anything measured or counted in the model."
    ),
    "none": (
        "No reading needed: a greeting, thanks, small talk, a request to remember or note something, a "
        "question about the assistant itself, or a task that only rewrites text already in the conversation."
    ),
}

FAMILY_SCOPE: Mapping[str, str] = {
    "1": "OIB-Richtlinie 1 — mechanical resistance and stability: load-bearing structure, Standsicherheit.",
    "2": (
        "OIB-Richtlinie 2 — fire safety: Brandschutz, Gebäudeklasse, Brandabschnitte, Fluchtwege, "
        "Feuerwiderstand, Rauchwarnmelder, fire brigade access; part 2.1 Betriebsbauten (industrial and "
        "commercial buildings), 2.2 Garagen (garages, parking), 2.3 Hochhäuser (high-rise)."
    ),
    "3": (
        "OIB-Richtlinie 3 — hygiene, health and environmental protection: Belichtung, Belüftung, "
        "daylight, ventilation, sanitary rooms, water, moisture, radon, waste."
    ),
    "4": (
        "OIB-Richtlinie 4 — safety in use and accessibility: Nutzungssicherheit, Barrierefreiheit, "
        "stairs, railings (Absturzsicherung), door widths, ramps, lifts, glazing."
    ),
    "5": "OIB-Richtlinie 5 — sound insulation: Schallschutz, airborne and impact sound, Luftschall, Trittschall.",
    "6": (
        "OIB-Richtlinie 6 — energy saving and thermal insulation: Wärmeschutz, Energieausweis, U-Werte, "
        "heating demand, thermal envelope."
    ),
}


@dataclass(frozen=True)
class TurnDecisions:
    decided: bool = False
    needs_evidence: float | None = None
    corpus: str | None = None
    corpus_p: float = 0.0
    families: tuple[tuple[str, float], ...] = ()
    cards: tuple[tuple[str, float], ...] = ()
    skill: str | None = None
    skill_p: float = 0.0
    skill_fit: float | None = None
    self_contained: float | None = None
    precedent: float | None = None
    latency_ms: int = 0

    @staticmethod
    def none() -> TurnDecisions:
        return TurnDecisions()

    @property
    def wants_evidence(self) -> bool:
        return self.decided and (self.needs_evidence or 0.0) >= NEEDS_EVIDENCE_THRESHOLD

    @property
    def chosen_skill(self) -> str | None:
        if not self.decided or not self.skill or self.skill == "none":
            return None
        if self.skill_p < SKILL_THRESHOLD or (self.skill_fit or 0.0) < SKILL_FIT_THRESHOLD:
            return None
        return self.skill

    @property
    def wants_reference(self) -> bool:
        confident = self.corpus_p >= CORPUS_THRESHOLD
        if self.corpus == "referenz" and confident:
            return True
        law = self.corpus == "baurecht" and confident
        return (self.precedent or 0.0) >= (PRECEDENT_THRESHOLD_LAW if law else PRECEDENT_THRESHOLD)

    @property
    def searchable(self) -> bool:
        return self.self_contained is None or self.self_contained >= SELF_CONTAINED_THRESHOLD

    def chosen_families(self) -> list[str]:
        ranked = sorted((f for f in self.families if f[1] >= FAMILY_THRESHOLD), key=lambda f: -f[1])
        return [key for key, _ in ranked[:MAX_FAMILY_PREFETCH]]

    def chosen_cards(self) -> list[str]:
        ranked = sorted((c for c in self.cards if c[1] >= CARD_THRESHOLD), key=lambda c: -c[1])
        return [card_type for card_type, _ in ranked[:MAX_CARD_SHAPES]]


@dataclass(frozen=True)
class TurnFacts:
    question: str
    focus_file_name: str | None = None
    project_facts: Mapping[str, str] = field(default_factory=dict)
    families: Sequence[Any] = ()
    project_files: int = 0
    archive_files: int = 0
    card_types: Sequence[tuple[str, str]] = ()
    skills: Sequence[tuple[str, str]] = ()
    previous_message: str | None = None
    previous_answer: str | None = None
    reference_projects: int = 0
    reference_catalog: str | None = None

    def state(self) -> dict[str, Any]:
        state: dict[str, Any] = {"message": self.question[:1000], "language": "de"}
        if self.previous_message:
            state["previous_message"] = self.previous_message[:300]
        if self.previous_answer:
            state["previous_answer"] = self.previous_answer[:300]
        if self.focus_file_name:
            state["open_document"] = self.focus_file_name
        if self.project_facts:
            state["project"] = dict(list(self.project_facts.items())[:12])
        state["corpus"] = {
            "regulation_families": [f"{family.label}: parts {', '.join(family.members)}" for family in self.families],
            "project_files": self.project_files,
            "archive_files": self.archive_files,
            "reference_projects": self.reference_projects,
        }
        return state


def corpus_options(facts: TurnFacts) -> dict[str, str]:
    if facts.reference_projects > 0:
        return dict(CORPUS_OPTIONS)
    return {key: text for key, text in CORPUS_OPTIONS.items() if key != "referenz"}


def questions_for(facts: TurnFacts) -> dict[str, dict[str, Any]]:
    from agent.common.decisions import choice
    from agent.common.decisions import noul

    questions: dict[str, dict[str, Any]] = {
        "needs_evidence": noul(
            "Does answering this message require reading a regulation, a project document, the office "
            "archive or the building model?",
            true=(
                "The message asks what a rule requires, what a document contains, what applies to the "
                "project, or for a value, a class, a procedure, a comparison or a check."
            ),
            false=(
                f"{CORPUS_OPTIONS['none']} Also false when the message asks only for the name, folder or "
                "number of a file the inventory lists."
            ),
        ),
        "corpus": choice("Where does the answer to this message most likely live?", corpus_options(facts)),
    }
    for family in facts.families:
        scope = FAMILY_SCOPE.get(str(family.key), family.label)
        questions[f"family_{family.key}"] = noul(
            f"Does answering this message require reading {family.label}?",
            true=f"The message is about the subject of this Richtlinie. {scope}",
            false="The message is about another subject, another regulation, or needs no regulation.",
        )
    for card_type, doc in facts.card_types:
        questions[f"card_{card_type}"] = noul(
            f"Would the answer to this message be best shown, in part, as a '{card_type}' card?",
            true=f"The answer would contain exactly what this card shows: {doc}",
            false="The answer is prose, a value, or a different kind of structure.",
        )
    if facts.reference_projects > 0:
        questions["precedent"] = noul(
            "Has an earlier project of this office likely faced the decision or the question this message is about?",
            true=(
                "The message asks how something was solved, what an authority demanded, which detail, Gutachten or "
                "construction to use, or what is usual: a decision a comparable building project makes."
            ),
            false=(
                "The message asks only what a rule says or defines, a fact of this project's own documents, a "
                "measurement in the model, or needs no reading."
            ),
        )
    questions["self_contained"] = noul(
        "Can this message be searched for on its own, without the previous message, and still find what it asks about?",
        true=("The message names its own subject: the rule, the document, the element, the value it asks about."),
        false=(
            "The message refers to something only the previous message names — 'und in GK 4?', 'was gilt "
            "dort?', 'und das zweite?' — or is a bare follow-up word such as 'warum', 'genauer', 'mehr'."
        ),
    )
    if facts.skills:
        options = {name: description for name, description in facts.skills}
        options["none"] = "No listed working method is about this message, or it needs none."
        questions["skill"] = choice(
            "Which of these working methods, if any, is the one for this message? Read what each does, not its name.",
            options,
        )
        for name, description in facts.skills:
            questions[f"fits_{name}"] = noul(
                f"Does the working method '{name}' do the specific thing this message asks for?",
                true=f"The message is exactly the case this method is written for: {description}",
                false="The message is about something else, or only shares a word with the method's name.",
            )
    return questions


async def decide_turn(facts: TurnFacts, *, organization_id: str | None = None) -> TurnDecisions:
    from agent.common.decisions import decide

    questions = questions_for(facts)
    decision = await decide(facts.state(), questions, slot=SLOT, organization_id=organization_id)
    if decision is None:
        return TurnDecisions.none()
    corpus, distribution = decision.choice("corpus")
    families = tuple(
        (str(family.key), p) for family in facts.families if (p := decision.noul(f"family_{family.key}")) is not None
    )
    cards = tuple(
        (card_type, p) for card_type, _ in facts.card_types if (p := decision.noul(f"card_{card_type}")) is not None
    )
    skill, skill_distribution = decision.choice("skill")
    decided = TurnDecisions(
        decided=True,
        needs_evidence=decision.noul("needs_evidence"),
        corpus=corpus,
        corpus_p=distribution.get(corpus or "", 0.0),
        families=families,
        cards=cards,
        skill=skill,
        skill_p=skill_distribution.get(skill or "", 0.0),
        skill_fit=decision.noul(f"fits_{skill}") if skill and skill != "none" else None,
        self_contained=decision.noul("self_contained"),
        precedent=decision.noul("precedent") if facts.reference_projects > 0 else None,
        latency_ms=decision.latency_ms,
    )
    logger.info(
        "Turn decision in %d ms: evidence=%.2f corpus=%s(%.2f) families=%s skill=%s cards=%s self_contained=%s "
        "precedent=%s",
        decided.latency_ms,
        decided.needs_evidence or 0.0,
        decided.corpus,
        decided.corpus_p,
        decided.chosen_families(),
        decided.chosen_skill,
        decided.chosen_cards(),
        decided.self_contained,
        decided.precedent,
    )
    return decided


def prefetch_query(question: str | None) -> str:
    return " ".join((question or "").split())[:300].rstrip()


def prefetch_calls(
    decisions: TurnDecisions,
    question: str,
    *,
    focus_file_name: str | None = None,
    focus_shelf: str | None = None,
    previous_message: str | None = None,
    reference_projects: int = 0,
    austrian_law: bool = False,
) -> list[dict[str, Any]]:
    if not decisions.decided:
        return [] if previous_message is not None or not austrian_law else _undecided_prefetch(question)
    if not decisions.wants_evidence or not decisions.searchable:
        return []
    query = prefetch_query(question)
    if not query:
        return []
    calls = _corpus_prefetch(decisions, query, focus_file_name, question, focus_shelf, austrian_law)
    if reference_projects > 0 and decisions.wants_reference:
        calls.append(
            {
                "name": PROJECT_LOOKUP,
                "args": {"action": "search", "query": query, "scope": "closed", "open_folders_only": True},
            }
        )
    return calls


MAX_LITERAL_PREFETCH = 2

_LITERAL_SHELF = {"projekt": "project", "buero": "office_shelf"}

_QUOTED = re.compile(r"[„“\"»]([^„“”\"«»\n]{2,60})[“”\"«]|(?<!\w)'([^'\n]{2,60})'(?!\w)")
_CODE = re.compile(
    r"(?<![\w-])(?:[A-Za-z]{1,3}[-_]\d{1,4}(?:[-_]\d{1,3})?|\d{2,3}-\d{2,4})(?![\w-])"
    r"|(?<![\w.])[\w-]+\.(?:pdf|docx?|xlsx?|dwg|dxf|ifc|png|jpe?g|txt|csv)\b",
    re.IGNORECASE,
)


def literal_terms(question: str) -> list[str]:
    found = [m.group(1) or m.group(2) for m in _QUOTED.finditer(question or "")]
    found += [m.group(0) for m in _CODE.finditer(question or "")]
    terms: list[str] = []
    for raw in found:
        term = " ".join(raw.split()).strip()
        if len(term) >= 2 and term.casefold() not in {t.casefold() for t in terms}:
            terms.append(term)
    return terms[:MAX_LITERAL_PREFETCH]


def _corpus_prefetch(
    decisions: TurnDecisions,
    query: str,
    focus_file_name: str | None,
    question: str,
    focus_shelf: str | None = None,
    austrian_law: bool = False,
) -> list[dict[str, Any]]:
    if decisions.corpus not in {"baurecht", "projekt", "buero"} or decisions.corpus_p < CORPUS_THRESHOLD:
        return []
    from agent.common.norm_registry import family_query_number

    shelf = _LITERAL_SHELF.get(decisions.corpus)
    focus = focus_file_name if shelf else None
    focus_shelf = focus_shelf or shelf
    args: dict[str, Any] = {"query": query}
    if focus and (path := estate_path(focus_shelf, None, focus)):
        args["path"] = path
    calls: list[dict[str, Any]] = [{"name": KNOWLEDGE_SEARCH, "args": args}]
    if shelf:
        scope = {"path": MOUNT_ROOTS.get(SHELF_MOUNTS.get(str(focus_shelf), ""), MOUNT_ROOTS[SHELF_MOUNTS[shelf]])}
        if focus:
            from wcmatch import glob as wcglob

            scope["glob"] = wcglob.escape(focus.rsplit("/", 1)[-1])
        calls.extend(
            {"name": GREP, "args": {"pattern": term, "output_mode": "content", **scope}}
            for term in literal_terms(question)
        )
    if decisions.corpus == "baurecht" and austrian_law and family_query_number(query) is None:
        calls.extend(
            {"name": KNOWLEDGE_SEARCH, "args": {"query": f"OIB-Richtlinie {key}"}}
            for key in decisions.chosen_families()
        )
    return calls


def _undecided_prefetch(question: str) -> list[dict[str, Any]]:
    from agent.common.norm_registry import family_query_number

    query = prefetch_query(question)
    if not query or family_query_number(query) is None:
        return []
    return [{"name": KNOWLEDGE_SEARCH, "args": {"query": query}}]


def attached_card_types(decisions: TurnDecisions, skill_cards: Mapping[str, Sequence[str]]) -> list[str]:
    ordered: list[str] = []
    skill = decisions.chosen_skill
    for card_type in [*(skill_cards.get(skill, ()) if skill else ()), *decisions.chosen_cards()]:
        if card_type not in ordered:
            ordered.append(card_type)
    return ordered[:MAX_ATTACHED_SHAPES]
