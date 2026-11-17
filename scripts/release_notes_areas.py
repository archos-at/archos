from __future__ import annotations

import re
from pathlib import Path

AREAS: dict[str, str] = {
    "projects": "Projects and setup",
    "documents": "Files and the office shelf",
    "answers": "Questions and answers",
    "search": "Search",
    "building-law": "Building law and norms",
    "bim": "Building models",
    "collaboration": "Working as a team",
    "tasks": "Tasks and research",
    "office-knowledge": "What the office knows",
    "administration": "Administration",
    "agents": "Your own agents",
    "general": "General",
}

FALLBACK_AREA = "general"

AREA_LINE = re.compile(r"^#\s*area\s*:\s*(?P<value>.*?)\s*$", re.MULTILINE | re.IGNORECASE)
TEMPLATE_AREA = "choose one"

_RULES: tuple[tuple[str, str], ...] = (
    (
        "agents",
        r"\bmcp\b|agent door|\bagents\b|outside agent|your own agent|claude|chatgpt|"
        r"connect (an|your) agent|\ba2a\b|agent links|zapier",
    ),
    (
        "bim",
        r"\bifc\b|\bbim\b|building model|ifc.modell|geb(ä|ae)udemodell|modellbereich|3d.modell|raumbuch|"
        r"\bbcf\b|archicad|revit|pr(ü|ue)fbuch|3d view|section box|storey|geschoss",
    ),
    (
        "building-law",
        r"\boib\b|richtlinie|\bris\b|building law|baurecht|bauordnung|bebauungsplan|"
        r"\blaw\b|\blegal\b|statute|\bnorms?\b|\bnorm register|\b(ö|oe)norm|garage|stellpl|fluchtweg|"
        r"barrierefrei|setback|abstand|kataster|dxf|zoning|widmung|geb(ä|ae)udeklasse",
    ),
    (
        "tasks",
        r"\btasks?\b|aufgabe|auftr(a|ä|ae)g|\bskills?\b|schedule|zeitplan|\bruns?\b|\blauf\b|l(ä|ae)ufe|"
        r"research|recherche|tiefenrecherche|\breports?\b|bericht|automation|automatisierung|\bjobs?\b",
    ),
    (
        "office-knowledge",
        r"similar (closed )?projects?|(ä|ae)hnliche|precedent|referenz|reference projects?|"
        r"memory|ged(ä|ae)chtnis|standing instruction|office knowledge|experience|erfahrung|lessons?|"
        r"office conventions?|konvention",
    ),
    (
        "search",
        r"\bsearch\w*|\bsuche\b|find every|finds? (the|a|every)|full text|volltext|schlagw(ö|oe)rter|"
        r"keyword",
    ),
    (
        "collaboration",
        r"\bmentions?\b|erw(ä|ae)hn|\binbox\b|postfach|notif|benachrichtig|presence|"
        r"anmerkung|\bmarks?\b|comment|kommentar|shared? (chat|conversation)|colleague|kolleg|"
        r"assign|verantwortlich|\bteam\b|members?|mitglied|invite|einlad|sagen bescheid|"
        r"pr(ü|ue)fansicht|\breview\b",
    ),
    (
        "administration",
        r"\broles?\b|\brollen?\b|permission|berechtigung|budget|\bpoints\b|punkte|usage|"
        r"verbrauch|organi[sz]ation|\borg\b|sign[ -]?in|log ?in|anmeld|retention|aufbewahr|legal hold|"
        r"download log|admin|billing|kontingent|quota|ai act",
    ),
    (
        "projects",
        r"project (setup|profile|settings|overview)|einrichtung|intake|steckbrief|projekterfassung|"
        r"new project|neues projekt|close (a|the|your)? ?project|abgeschlossen|closed project|clean ?up|"
        r"aufr(ä|ae)um|project address|address field|bundesland|projektliste|projects? (list|page)|"
        r"all projects|alle projekte",
    ),
    (
        "documents",
        r"upload|hochlad|\bfiles?\b|datei|folders?|ordner|documents?|dokument|fassung|versions?|"
        r"revision|\bpdf\b|\bword\b|excel|powerpoint|\bzip\b|scan|preview|vorschau|papierkorb|\btrash\b|"
        r"archiv|quarant(ä|ae)ne|quarantine|screening|b(ü|ue)roablage|office shelf|drawing|plan|zeichnung|"
        r"outlook|\bmails?\b|aktenvermerk|protokoll|freigabe|approv|draft|entwurf",
    ),
    (
        "answers",
        r"answer|antwort|\bchat\b|question|frage|cit(e|ation|ed)|zitat|source|quelle|beleg|"
        r"cards?\b|karte|diagram|stream|herleitung|derivation|einsch(ä|ae)tzung",
    ),
    (
        "general",
        r"website|landing|phone|telefon|mobile|dark mode|theme|sidebar|seitenleiste|navigation|"
        r"keyboard|tastatur|shortcut|language|sprache|english|englisch",
    ),
)
_COMPILED = tuple((area, re.compile(pattern)) for area, pattern in _RULES)


def area_line(raw: str) -> str | None:
    match = AREA_LINE.search(raw)
    return match.group("value").strip().lower() if match else None


SLUG_WEIGHT = 3


def derive_area(filename: str, text: str) -> str:
    slug = re.sub(r"-[0-9a-f]{16}$", "", Path(filename).stem).replace("-", " ").replace("_", " ").lower()
    body = text.lower()
    best, best_score = FALLBACK_AREA, 0
    for area, pattern in _COMPILED:
        score = SLUG_WEIGHT * len(pattern.findall(slug)) + len(pattern.findall(body))
        if score > best_score:
            best, best_score = area, score
    return best


def note_area(filename: str, raw: str | None, text: str) -> str:
    declared = area_line(raw) if raw else None
    if declared in AREAS:
        return declared
    return derive_area(filename, text)


def lint_area(filename: str, raw: str) -> list[str]:
    lines = AREA_LINE.findall(raw)
    if not lines:
        return []
    known = ", ".join(AREAS)
    if len(lines) > 1:
        return [f"{filename}: {len(lines)} `# area:` lines. Fix: keep one; a note belongs to one area."]
    value = lines[0].strip().lower()
    if TEMPLATE_AREA in value:
        return [f"{filename}: the `# area:` line still holds the template text. Fix: write one of {known}."]
    if value not in AREAS:
        return [f"{filename}: unknown area `{value}`. Fix: write one of {known}."]
    return []
