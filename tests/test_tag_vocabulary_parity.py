import re
from pathlib import Path
from typing import get_args

import pytest

from agent.knowledge.document_classification import CORRESPONDENCE_TAG
from agent.knowledge.document_classification import DISCIPLINE_TAGS
from agent.knowledge.document_classification import DOCUMENT_TYPE_CRITERIA
from agent.knowledge.document_classification import DOCUMENT_TYPE_TAGS
from agent.tools.cross_project.register import Discipline
from agent.tools.cross_project.register import DocumentType

REPO_ROOT = Path(__file__).resolve().parents[1]
TS_VOCAB = REPO_ROOT / "apps" / "workspace" / "bff" / "documents" / "tag-vocabulary.ts"


def _extract_ts_array(source: str, const_name: str) -> list[str]:
    match = re.search(rf"export const {const_name} = \[(.*?)\]", source, re.DOTALL)
    assert match, f"{const_name} not found in {TS_VOCAB}"
    return re.findall(r"'([^']*)'", match.group(1))


@pytest.fixture(scope="module")
def ts_source() -> str:
    return TS_VOCAB.read_text(encoding="utf-8")


def test_document_type_tags_match(ts_source):
    assert _extract_ts_array(ts_source, "DOCUMENT_TYPE_TAGS") == list(DOCUMENT_TYPE_TAGS)


def test_discipline_tags_match(ts_source):
    assert _extract_ts_array(ts_source, "DISCIPLINE_TAGS") == list(DISCIPLINE_TAGS)


def test_the_cross_project_tool_offers_the_same_vocabulary():
    assert list(get_args(DocumentType)) == list(DOCUMENT_TYPE_TAGS)
    assert list(get_args(Discipline)) == list(DISCIPLINE_TAGS)


TOKEN = re.compile(r"[a-z][a-z_]*")


def test_every_token_is_labelled_in_the_ui(ts_source):
    tokens = [tag for tag in (*DOCUMENT_TYPE_TAGS, *DISCIPLINE_TAGS) if TOKEN.fullmatch(tag)]
    assert CORRESPONDENCE_TAG in tokens
    assert _extract_ts_array(ts_source, "LABELLED_TAGS") == tokens


def test_correspondence_is_a_type_the_decision_can_choose():
    assert CORRESPONDENCE_TAG in DOCUMENT_TYPE_TAGS
    assert list(DOCUMENT_TYPE_CRITERIA) == list(DOCUMENT_TYPE_TAGS)
