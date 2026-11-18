import argparse
import json
from collections.abc import Sequence
from pathlib import Path
from typing import get_args

from public_sources.access import ACCESS_TYPES
from public_sources.engines import ENGINES

from agent.cards.workspace_cards import TaskKind
from agent.common.source_kinds import OFFICE_SHELF_COLLECTION_PREFIXES
from agent.common.source_kinds import SOURCE_KINDS
from agent.common.source_kinds import Shelf
from agent.knowledge.doc_class_vocabulary import DEFAULT_DOC_CLASS
from agent.knowledge.doc_class_vocabulary import DOCUMENT_CLASS_LABELS
from agent.knowledge.doc_class_vocabulary import DOCUMENT_CLASSES
from agent.knowledge.doc_class_vocabulary import LEGACY_DOC_CLASSES
from agent.knowledge.document_classification import DOCUMENT_TYPE_TAGS
from agent.skills.legacy_brand_names import LEGACY_METADATA_KEYS
from agent.skills.legacy_brand_names import LEGACY_PLATFORM_SKILL_NAMES
from agent.skills.legacy_names import LEGACY_SKILL_NAMES

WORKSPACE = Path(__file__).resolve().parent.parent / "apps" / "workspace"
OUT_PATH = WORKSPACE / "shared" / "vocabularies.generated.ts"
LEGACY_BRAND_OUT_PATH = WORKSPACE / "bff" / "skills" / "legacy-brand-names.generated.ts"
LEGACY_BRAND_RELEASE = "2026-W50"

DOC_CLASS_VOCABULARY = "`packages/agent/src/agent/knowledge/doc_class_vocabulary.py`"
LEGACY_BRAND_NAMES = "`packages/agent/src/agent/skills/legacy_brand_names.py`"

Vocabularies = tuple[tuple[str, tuple[str, ...] | dict[str, str] | str, str], ...]

VOCABULARIES: Vocabularies = (
    (
        "DELEGATABLE_TASK_KINDS",
        get_args(TaskKind),
        "The kinds a person may delegate: `TaskKind` in `packages/agent/src/agent/cards/workspace_cards.py`.",
    ),
    (
        "SOURCE_KINDS",
        tuple(SOURCE_KINDS),
        "The coarse source kinds: the keys of `SOURCE_KINDS` in `packages/agent/src/agent/common/source_kinds.py`.",
    ),
    (
        "SHELVES",
        tuple(shelf.value for shelf in Shelf),
        "The shelves a retrieved chunk can come from: `Shelf` in `packages/agent/src/agent/common/source_kinds.py`.",
    ),
    (
        "SOURCE_PROTOCOLS",
        tuple(ACCESS_TYPES),
        "A source record's protocols: the keys of `ACCESS_TYPES` in "
        "`packages/public-sources/src/public_sources/access`.",
    ),
    (
        "SOURCE_FORMATS",
        tuple(ENGINES),
        "A source record's formats: the keys of `ENGINES` in `packages/public-sources/src/public_sources/engines`.",
    ),
    (
        "DOCUMENT_TYPE_TAGS",
        DOCUMENT_TYPE_TAGS,
        "The document types a person may file a document as: `DOCUMENT_TYPE_TAGS` in "
        "`packages/agent/src/agent/knowledge/document_classification.py`.",
    ),
    (
        "DOCUMENT_CLASSES",
        DOCUMENT_CLASSES,
        f"The classes of a base-knowledge document, in order: `DOCUMENT_CLASSES` in {DOC_CLASS_VOCABULARY}.",
    ),
    (
        "DOCUMENT_CLASS_LABELS",
        DOCUMENT_CLASS_LABELS,
        f"Each document class's German label: `DOCUMENT_CLASS_LABELS` in {DOC_CLASS_VOCABULARY}.",
    ),
    (
        "DEFAULT_DOC_CLASS",
        DEFAULT_DOC_CLASS,
        f"The class of a document nobody classified: `DEFAULT_DOC_CLASS` in {DOC_CLASS_VOCABULARY}.",
    ),
    (
        "LEGACY_DOC_CLASSES",
        LEGACY_DOC_CLASSES,
        f"The keys stored before the English names, each with its current class: `LEGACY_DOC_CLASSES` in "
        f"{DOC_CLASS_VOCABULARY}.",
    ),
    (
        "OFFICE_SHELF_COLLECTION_PREFIXES",
        OFFICE_SHELF_COLLECTION_PREFIXES,
        "The prefixes of an office shelf's collection, the target name first and the stored one after it: "
        "`OFFICE_SHELF_COLLECTION_PREFIXES` in `packages/agent/src/agent/common/source_kinds.py`.",
    ),
    (
        "LEGACY_SKILL_NAMES",
        LEGACY_SKILL_NAMES,
        "Each builtin skill's name before the English names, with its current name: `LEGACY_SKILL_NAMES` in "
        "`packages/agent/src/agent/skills/legacy_names.py`.",
    ),
)

LEGACY_BRAND_VOCABULARIES: Vocabularies = (
    (
        "LEGACY_PLATFORM_SKILL_NAMES",
        LEGACY_PLATFORM_SKILL_NAMES,
        f"Each house skill's stored name, with its current name: `LEGACY_PLATFORM_SKILL_NAMES` in "
        f"{LEGACY_BRAND_NAMES}.",
    ),
    (
        "LEGACY_METADATA_KEYS",
        LEGACY_METADATA_KEYS,
        f"Each skill metadata key, with the spelling it is stored under: `LEGACY_METADATA_KEYS` in "
        f"{LEGACY_BRAND_NAMES}.",
    ),
)


def render(vocabularies: Vocabularies = VOCABULARIES, *, expiry: str | None = None) -> str:
    blocks = [f"// drop after release {expiry}"] if expiry else []
    blocks += [
        "// AUTO-GENERATED from the Python sources named below — do not edit; "
        "run `uv run python scripts/generate_vocabularies.py`"
    ]
    for name, value, doc in vocabularies:
        blocks.append(f"/** {doc} */\nexport const {name} = {json.dumps(value, ensure_ascii=False)} as const")
    return "\n\n".join(blocks) + "\n"


def render_legacy_brand_names() -> str:
    return render(LEGACY_BRAND_VOCABULARIES, expiry=LEGACY_BRAND_RELEASE)


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=f"Regenerate {OUT_PATH.relative_to(OUT_PATH.parents[4])} from the Python sources."
    )
    parser.parse_args(argv)
    OUT_PATH.write_text(render(), encoding="utf-8", newline="\n")
    LEGACY_BRAND_OUT_PATH.write_text(render_legacy_brand_names(), encoding="utf-8", newline="\n")
    print(f"Wrote the shared vocabularies to {OUT_PATH} and {LEGACY_BRAND_OUT_PATH}")


if __name__ == "__main__":
    main()
