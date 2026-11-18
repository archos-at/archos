import re
from pathlib import Path

from knowledge_layer.ingest import RENDITION_INDEXED_EXTENSIONS

REPO_ROOT = Path(__file__).resolve().parents[2]
TS_PREVIEW_TYPES = REPO_ROOT / "apps" / "workspace" / "bff" / "documents" / "preview-types.ts"


def _ts_rendition_indexed_extensions() -> set[str]:
    source = TS_PREVIEW_TYPES.read_text(encoding="utf-8")
    match = re.search(r"export const RENDITION_INDEXED_EXTENSIONS = \[(.*?)\] as const", source, re.DOTALL)
    assert match, f"RENDITION_INDEXED_EXTENSIONS not found in {TS_PREVIEW_TYPES}"
    return set(re.findall(r"'([^']+)'", match.group(1)))


def test_spreadsheets_with_their_own_reader_are_not_indexed_from_the_rendition():
    assert ".xlsx" not in RENDITION_INDEXED_EXTENSIONS
    assert ".xlsm" not in RENDITION_INDEXED_EXTENSIONS


def test_bff_and_knowledge_layer_index_the_same_formats_from_the_rendition():
    assert _ts_rendition_indexed_extensions() == set(RENDITION_INDEXED_EXTENSIONS)
