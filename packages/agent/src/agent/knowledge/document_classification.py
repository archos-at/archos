from __future__ import annotations

import json
import logging
import re
from collections.abc import Iterable
from collections.abc import Sequence

from agent.common.message_utils import response_text
from agent.knowledge.doc_class_vocabulary import DEFAULT_DOC_CLASS  # noqa: F401
from agent.knowledge.doc_class_vocabulary import DOCUMENT_CLASS_LABELS  # noqa: F401
from agent.knowledge.doc_class_vocabulary import DOCUMENT_CLASS_LANES  # noqa: F401
from agent.knowledge.doc_class_vocabulary import DOCUMENT_CLASSES  # noqa: F401
from agent.knowledge.doc_class_vocabulary import LEGACY_DOC_CLASSES  # noqa: F401
from agent.knowledge.doc_class_vocabulary import QDRANT_DOC_CLASSES  # noqa: F401
from agent.knowledge.doc_class_vocabulary import canonical_doc_class  # noqa: F401
from agent.knowledge.doc_class_vocabulary import is_valid_doc_class  # noqa: F401
from agent.knowledge.doc_class_vocabulary import qdrant_doc_class  # noqa: F401

logger = logging.getLogger(__name__)

CLASSIFY_MAX_INPUT_CHARS = 4000


CORRESPONDENCE_TAG = "correspondence"

DOCUMENT_TYPE_TAGS: tuple[str, ...] = (
    "Bebauungsplan",
    "Flächenwidmungsplan",
    "Grundriss",
    "Schnitt",
    "Ansicht",
    "Detail",
    "Gutachten",
    "Bescheid",
    "Norm/Richtlinie",
    "Vertrag",
    CORRESPONDENCE_TAG,
    "Foto",
    "Sonstiges",
)

DISCIPLINE_TAGS: tuple[str, ...] = (
    "Standsicherheit",
    "Brandschutz",
    "Hygiene/Gesundheit/Umweltschutz",
    "Nutzungssicherheit/Barrierefreiheit",
    "Schallschutz",
    "Energieeinsparung/Wärmeschutz",
)

ALLOWED_TAGS: frozenset[str] = frozenset(DOCUMENT_TYPE_TAGS) | frozenset(DISCIPLINE_TAGS)

MAX_TAGS = 5


DOCUMENT_CLASS_CRITERIA: dict[str, str] = {
    "oib_guideline": (
        "An OIB-Richtlinie itself: the binding technical guideline text (OIB-Richtlinie 1 to 6, 2.1, 2.2, "
        "2.3), with numbered Punkte and requirements."
    ),
    "oib_guide": "An OIB-Leitfaden: guidance published by the OIB on how to apply or deviate from a Richtlinie.",
    "oib_explanatory_note": (
        "Erläuternde Bemerkungen: the OIB's explanatory remarks on a Richtlinie, point by point, saying why a "
        "requirement is as it is."
    ),
    "oib_definitions": "The OIB-Richtlinien Begriffsbestimmungen: the list of defined terms used by all Richtlinien.",
    "oib_reference": (
        "An OIB reference or supporting document to a Richtlinie (a national plan, reference values, a "
        "calculation basis), not the Richtlinie itself."
    ),
    "oib_amendment": "An OIB change document: what changed in a Richtlinie between two editions.",
    "external_standard": "A technical standard not issued by the OIB: an ÖNORM, an EN or Eurocode, a DIN.",
    "law": (
        "A law or ordinance: a Bauordnung, a Bautechnikgesetz, a Verordnung of a Land or the federal state, with §§."
    ),
    "other": (
        "Anything else: a leaflet, a presentation, a letter, a checklist, a publication that is none of the above."
    ),
}

DOC_CLASS_SUGGESTION_THRESHOLD = 0.8
DOC_CLASS_DECISION_SLOT = "doc_class"
DOC_CLASS_QUESTION = (
    "What kind of document is this, in the hierarchy of Austrian building regulations? "
    "Read the text, then the file name."
)


def suggest_doc_class(text: str, file_name: str, *, organization_id: str | None = None) -> str | None:
    if not text or not text.strip():
        return None
    try:
        from agent.common.decisions import choice
        from agent.common.decisions import decide_blocking

        decision = decide_blocking(
            {"file_name": file_name, "text": text[:CLASSIFY_MAX_INPUT_CHARS]},
            {"doc_class": choice(DOC_CLASS_QUESTION, {key: DOCUMENT_CLASS_CRITERIA[key] for key in DOCUMENT_CLASSES})},
            slot=DOC_CLASS_DECISION_SLOT,
            timeout=TAG_DECISION_TIMEOUT_S,
            organization_id=organization_id,
        )
    except Exception as e:  # noqa: BLE001 — a suggestion is worth less than the ingestion
        logger.warning("Dokumentart decision failed for %s: %s", file_name, type(e).__name__)
        return None
    if decision is None:
        return None
    chosen, distribution = decision.choice("doc_class")
    if not is_valid_doc_class(chosen) or chosen == DEFAULT_DOC_CLASS:
        return None
    return chosen if distribution.get(chosen, 0.0) >= DOC_CLASS_SUGGESTION_THRESHOLD else None


FALLBACK_SUMMARY_MAX_CHARS = 200


def fallback_summary_from_text(text: str | None, max_chars: int = FALLBACK_SUMMARY_MAX_CHARS) -> str | None:
    if not text:
        return None
    single_line = " ".join(text.split())
    if not single_line:
        return None
    if len(single_line) <= max_chars:
        return single_line
    return single_line[:max_chars].rstrip() + "…"




def summarize_document_text(text_content: str, file_name: str, llm) -> str | None:
    if llm is None:
        return None

    text = text_content[:CLASSIFY_MAX_INPUT_CHARS]
    prompt = (
        "Fasse den Inhalt dieses Baudokuments in EINEM Satz auf Deutsch zusammen. "
        "Beschreibe, WAS das Dokument inhaltlich zeigt (z.B. Zeichnungstyp wie "
        "Grundriss/Schnitt/Ansicht, dargestellte Räume/Bauteile, Maßstab). "
        "Bei technischen Zeichnungen nenne Zeichnungstyp und Maßstab, falls "
        "erkennbar. Ignoriere Wasserzeichen sowie Software-/Lizenzhinweise "
        '(z.B. "VECTORWORKS EDUCATIONAL VERSION") vollständig — sie sind NICHT '
        "der Inhalt. Antworte nur mit dem Satz, ohne Einleitung.\n\n"
        f"{text}"
    )

    try:
        response = llm.invoke(prompt)
        summary = response_text(response).strip()
        logger.info("[SUMMARY] Generated (%d chars)", len(summary))
        return summary or None
    except Exception as e:
        logger.warning("Summary via LLM failed for %s: %s", file_name, e)
        return None




def _build_tag_prompt(text: str, file_name: str) -> str:
    doc_types = ", ".join(DOCUMENT_TYPE_TAGS)
    disciplines = ", ".join(DISCIPLINE_TAGS)
    return (
        "Du klassifizierst ein Baudokument für ein österreichisches "
        "Architekturbüro (OIB-Richtlinien).\n\n"
        f"Dateiname: {file_name}\n\n"
        "Wähle:\n"
        f"- 1 bis 2 Dokumenttyp-Schlagwörter aus: [{doc_types}]\n"
        f"- 0 bis 3 Fachbereich-Schlagwörter aus: [{disciplines}] "
        "(nur wenn der Fachbereich eindeutig zutrifft)\n\n"
        "Regeln:\n"
        "- Verwende AUSSCHLIESSLICH Schlagwörter aus den obigen Listen, "
        "wortgleich.\n"
        "- Maximal 5 Schlagwörter insgesamt.\n"
        "- Erfinde keine neuen Schlagwörter.\n"
        f"- {CORRESPONDENCE_TAG} steht für Korrespondenz: ein Brief oder eine E-Mail "
        "zwischen Beteiligten.\n"
        "- Antworte NUR mit einem JSON-Array von Strings, ohne weiteren Text.\n\n"
        'Beispiel: ["Grundriss", "Brandschutz"]\n\n'
        "Dokumentinhalt:\n"
        f"{text}"
    )


def _parse_tags(raw: str) -> list[str] | None:
    if not raw:
        return None

    text = raw.strip()

    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text).strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError, ValueError:
        return None

    if not isinstance(parsed, list):
        return None

    result: list[str] = []
    for item in parsed:
        if not isinstance(item, str):
            continue
        tag = item.strip()
        if tag in ALLOWED_TAGS and tag not in result:
            result.append(tag)

    result = result[:MAX_TAGS]
    return result or None



DOCUMENT_TYPE_CRITERIA: dict[str, str] = {
    "Bebauungsplan": "A development plan (Bebauungsplan): building lines, heights, density or use for plots.",
    "Flächenwidmungsplan": "A land-use zoning plan (Flächenwidmungsplan): which land may be used for what.",
    "Grundriss": "A floor plan drawing of a storey: rooms, walls, doors, dimensions seen from above.",
    "Schnitt": "A section drawing (Schnitt): the building cut vertically, storey heights and levels.",
    "Ansicht": "An elevation drawing (Ansicht): a facade seen from outside.",
    "Detail": "A construction detail drawing: a joint, a layer build-up, a connection at large scale.",
    "Gutachten": (
        "An expert's report, concept or assessment for the project (Gutachten, Konzept such as a "
        "Brandschutzkonzept, Stellungnahme, Nachweis, Berechnung)."
    ),
    "Bescheid": "An official decision or notice by an authority (Bescheid, Baubewilligung, Auflagen).",
    "Norm/Richtlinie": "A standard, guideline, regulation or law text (OIB-Richtlinie, ÖNORM, Bauordnung).",
    "Vertrag": "A contract or agreement between parties.",
    CORRESPONDENCE_TAG: (
        "Correspondence: a letter or e-mail exchanged between parties (a Schreiben, an E-Mail, a reply, "
        "an authority's letter that is not itself a Bescheid)."
    ),
    "Foto": "A photograph of a building, a site or a situation.",
    "Sonstiges": "Anything else: minutes, a list, a schedule, a form, a presentation.",
}

DISCIPLINE_CRITERIA: dict[str, str] = {
    "Standsicherheit": "Structural stability: load-bearing structure, statics, foundations.",
    "Brandschutz": "Fire safety: fire resistance, compartments, escape routes, fire brigade access.",
    "Hygiene/Gesundheit/Umweltschutz": "Hygiene, health, environment: daylight, ventilation, moisture, sanitary.",
    "Nutzungssicherheit/Barrierefreiheit": "Safety in use and accessibility: stairs, railings, ramps, lifts.",
    "Schallschutz": "Sound insulation: airborne and impact sound, acoustics.",
    "Energieeinsparung/Wärmeschutz": "Energy saving and thermal insulation: U-values, Energieausweis.",
}

TYPE_THRESHOLD = 0.8
DISCIPLINE_THRESHOLD = 0.8
MAX_DISCIPLINE_TAGS = 3
TAG_DECISION_SLOT = "document_tags"
TAG_DECISION_TIMEOUT_S = 5.0


def tag_questions() -> dict[str, dict]:
    from agent.common.decisions import choice
    from agent.common.decisions import noul

    questions = {
        "type": choice(
            "What kind of document is this? Read the content and the file name.",
            {tag: DOCUMENT_TYPE_CRITERIA[tag] for tag in DOCUMENT_TYPE_TAGS},
        )
    }
    for index, tag in enumerate(DISCIPLINE_TAGS):
        questions[f"discipline_{index}"] = noul(
            "Is this document clearly about this building discipline?",
            true=f"The document's subject is, in substantial part: {DISCIPLINE_CRITERIA[tag]}",
            false="The discipline is not the document's subject, or is mentioned only in passing.",
        )
    return questions


def tags_from_decision(decision) -> list[str] | None:
    chosen, distribution = decision.choice("type")
    if chosen not in DOCUMENT_TYPE_TAGS or distribution.get(chosen, 0.0) < TYPE_THRESHOLD:
        return None
    tags = [chosen]
    disciplines = sorted(
        (
            (p, index)
            for index in range(len(DISCIPLINE_TAGS))
            if (p := decision.noul(f"discipline_{index}")) is not None and p >= DISCIPLINE_THRESHOLD
        ),
        reverse=True,
    )
    tags.extend(DISCIPLINE_TAGS[index] for _, index in disciplines[:MAX_DISCIPLINE_TAGS])
    return tags[:MAX_TAGS]


def decide_document_tags(text: str, file_name: str, *, organization_id: str | None = None) -> list[str] | None:
    if not text or not text.strip():
        return None
    try:
        from agent.common.decisions import decide_blocking

        decision = decide_blocking(
            {"file_name": file_name, "text": text[:CLASSIFY_MAX_INPUT_CHARS]},
            tag_questions(),
            slot=TAG_DECISION_SLOT,
            timeout=TAG_DECISION_TIMEOUT_S,
            organization_id=organization_id,
        )
    except Exception as e:  # noqa: BLE001 — a tag is worth less than the ingestion
        logger.warning("Tag decision failed for %s: %s", file_name, type(e).__name__)
        return None
    return tags_from_decision(decision) if decision is not None else None


def classify_document_tags(text: str, file_name: str, llm, *, organization_id: str | None = None) -> list[str] | None:
    decided = decide_document_tags(text, file_name, organization_id=organization_id)
    if decided:
        logger.info("[TAGS] Decided %s -> %s", file_name, decided)
        return decided
    if llm is None:
        return None

    prompt = _build_tag_prompt(text[:CLASSIFY_MAX_INPUT_CHARS], file_name)

    try:
        response = llm.invoke(prompt)
        content = response.content if hasattr(response, "content") else str(response)
    except Exception as e:
        logger.warning("Tag classification via LLM failed for %s: %s", file_name, e)
        return None

    tags = _parse_tags(content)
    if tags:
        logger.info("[TAGS] Classified %s -> %s", file_name, tags)
    return tags


PHOTO_SEGMENT_TYPE = "photo"
PHOTO_TAG = "Foto"


def reconcile_image_tags(
    tags: list[str] | None,
    *,
    content_type: str | None,
    segment_types: Iterable[str],
) -> list[str] | None:
    if content_type != "image" or PHOTO_SEGMENT_TYPE not in set(segment_types):
        return tags
    rest = [tag for tag in (tags or []) if tag != PHOTO_TAG]
    return [PHOTO_TAG, *rest][:MAX_TAGS]



MAX_TOPICS = 6
TOPIC_THRESHOLD = 0.75
MAX_TOPIC_CHARS = 40
MAX_TOPIC_WORDS = 3
MAX_TOPIC_VOCABULARY = 60

_CONTROLLED_FOLDED = frozenset(tag.casefold() for tag in ALLOWED_TAGS)


def _build_topic_prompt(text: str, file_name: str, existing: Sequence[str]) -> str:
    vocabulary = (
        "Vorhandene Themen in diesem Projekt (verwende eines davon, wenn es passt, in genau dieser Schreibweise):\n"
        + ", ".join(existing[:MAX_TOPIC_VOCABULARY])
        + "\n\n"
        if existing
        else ""
    )
    return (
        "Nenne die Themen dieses Baudokuments: konkrete Fachbegriffe, nach denen ein Architekturbüro "
        "Unterlagen sucht — Bauteile (Attika, Fenster, Stiege), Bauweisen und Materialien "
        "(Holzrahmenbau, Stahlbeton), Räume und Bereiche (Tiefgarage, Fluchtweg), Gewerke und Themen "
        "(Abdichtung, Lüftung).\n"
        "Regeln:\n"
        f"- Höchstens {MAX_TOPICS} Themen, jedes ein Begriff aus 1 bis {MAX_TOPIC_WORDS} Wörtern, "
        "Substantiv im Singular.\n"
        "- KEINE Dokumentart (Grundriss, Schnitt, Gutachten …) und KEIN OIB-Fachbereich (Brandschutz, "
        "Schallschutz …) — die werden getrennt erfasst.\n"
        "- KEINE Namen von Personen, Firmen, Projekten oder Adressen.\n"
        "- Gib zu jedem Thema an, wie sicher du bist, dass es das Dokument wirklich betrifft (0.0 bis 1.0). "
        "Lieber kein Thema als ein geratenes.\n\n"
        f"{vocabulary}"
        'Antworte NUR mit einem JSON-Array, z.B. [{"thema": "Attika", "sicherheit": 0.9}].\n\n'
        f"Dateiname: {file_name}\n\n"
        f"{text[:CLASSIFY_MAX_INPUT_CHARS]}"
    )


def normalize_topic(raw: object) -> str | None:
    if not isinstance(raw, str):
        return None
    term = " ".join(raw.replace(" ", " ").split()).strip(" .,;:-–—\"'„“")
    if not term or len(term) > MAX_TOPIC_CHARS or len(term.split(" ")) > MAX_TOPIC_WORDS:
        return None
    if not any(char.isalpha() for char in term):
        return None
    return term


def parse_topics(content: str, existing: Sequence[str] = ()) -> list[str] | None:
    if not content:
        return None
    body = content.strip()
    fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", body, re.DOTALL)
    if fenced:
        body = fenced.group(1)
    try:
        items = json.loads(body)
    except TypeError, ValueError:
        return None
    if not isinstance(items, list):
        return None
    known = {term.casefold(): term for term in existing if isinstance(term, str)}
    kept: list[str] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        confidence = item.get("sicherheit", item.get("confidence"))
        if isinstance(confidence, bool) or not isinstance(confidence, int | float) or not confidence >= TOPIC_THRESHOLD:
            continue
        term = normalize_topic(item.get("thema", item.get("topic")))
        if term is None:
            continue
        folded = term.casefold()
        if folded in _CONTROLLED_FOLDED or folded in seen:
            continue
        seen.add(folded)
        kept.append(known.get(folded, term))
        if len(kept) >= MAX_TOPICS:
            break
    return kept or None


def suggest_topics(
    text: str,
    file_name: str,
    llm,
    *,
    existing: Sequence[str] = (),
) -> list[str] | None:
    if llm is None or not text or not text.strip():
        return None
    try:
        response = llm.invoke(_build_topic_prompt(text, file_name, existing))
    except Exception as e:  # noqa: BLE001 — a topic is worth less than the ingestion
        logger.warning("Topic suggestion failed for %s: %s", file_name, e)
        return None
    topics = parse_topics(response_text(response), existing)
    if topics:
        logger.info("[TOPICS] %s -> %s", file_name, topics)
    return topics
