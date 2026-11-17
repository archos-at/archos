import time
import uuid

import pytest
from knowledge_layer.ingest import LlamaIndexIngestor
from knowledge_layer.ingest import filed_document_type
from knowledge_layer.ingest import with_document_type
from langchain_core.messages import AIMessage

from agent.knowledge.document_classification import DISCIPLINE_TAGS
from agent.knowledge.document_classification import DOCUMENT_TYPE_TAGS
from agent.knowledge.document_classification import MAX_TAGS

CLASSIFIED_TYPE, SECOND_CLASSIFIED_TYPE, CHOSEN_TYPE, LATER_TYPE = DOCUMENT_TYPE_TAGS[2:6]
CLASSIFIED_DISCIPLINE, PERSON_DISCIPLINE = DISCIPLINE_TAGS[:2]


class TestWithDocumentType:
    def test_the_chosen_type_replaces_every_classified_type_and_leads(self):
        tags = [CLASSIFIED_TYPE, CLASSIFIED_DISCIPLINE, SECOND_CLASSIFIED_TYPE]

        assert with_document_type(tags, CHOSEN_TYPE) == [CHOSEN_TYPE, CLASSIFIED_DISCIPLINE]

    def test_no_tags_at_all_is_the_chosen_type_alone(self):
        assert with_document_type(None, CHOSEN_TYPE) == [CHOSEN_TYPE]
        assert with_document_type([], CHOSEN_TYPE) == [CHOSEN_TYPE]

    def test_the_chosen_type_is_never_stored_twice(self):
        assert with_document_type([CHOSEN_TYPE, CLASSIFIED_DISCIPLINE], CHOSEN_TYPE) == [
            CHOSEN_TYPE,
            CLASSIFIED_DISCIPLINE,
        ]

    def test_the_tag_cap_holds(self):
        result = with_document_type(list(DISCIPLINE_TAGS), CHOSEN_TYPE)

        assert result[0] == CHOSEN_TYPE
        assert len(result) == MAX_TAGS


class TestChosenDocumentType:
    @pytest.mark.parametrize("document_type", DOCUMENT_TYPE_TAGS)
    def test_a_type_of_the_vocabulary_is_honoured(self, document_type):
        assert filed_document_type({"document_type": document_type}) == document_type

    @pytest.mark.parametrize("config", [{}, {"document_type": None}, {"document_type": ""}])
    def test_no_choice_is_none(self, config):
        assert filed_document_type(config) is None

    def test_a_queued_value_outside_the_vocabulary_is_dropped_not_stored(self, caplog):
        assert filed_document_type({"document_type": DISCIPLINE_TAGS[0]}) is None
        assert "outside the vocabulary" in caplog.text


class _SummaryModel:
    def invoke(self, prompt):
        return AIMessage(content="A letter to the building authority.")


@pytest.fixture()
def stores(tmp_path):
    from agent.knowledge import configure_summary_db
    from agent.knowledge import factory

    factory._document_metadata_store = None
    configure_summary_db(f"sqlite:///{tmp_path / 'summaries.db'}")
    yield
    factory._document_metadata_store = None


@pytest.fixture()
def classified(monkeypatch):
    from agent.knowledge import document_classification

    reading = [CLASSIFIED_TYPE, CLASSIFIED_DISCIPLINE]
    monkeypatch.setattr(document_classification, "classify_document_tags", lambda *_a, **_k: list(reading))
    return reading


@pytest.fixture()
def ingestor(qdrant_store, classified):
    from knowledge_layer_testing.vector_store import FakeEmbedder

    ing = LlamaIndexIngestor({"generate_summary": True, "summary_llm": _SummaryModel()})
    ing._embed_model = FakeEmbedder()
    ing._initialized = True
    return ing


def _ingest(ing, tmp_path, collection, file_name, **extra):
    upload = tmp_path / f"tmp_{uuid.uuid4().hex[:8]}.txt"
    upload.write_text("Dear Sir or Madam, please find the documents enclosed.", encoding="utf-8")
    job_id = ing.submit_job(
        [str(upload)],
        collection,
        config={
            "original_filenames": [file_name],
            "extract_tables": False,
            "extract_images": False,
            "extract_charts": False,
            **extra,
        },
    )
    deadline = time.time() + 30
    while time.time() < deadline:
        status = ing.get_job_status(job_id)
        if status.is_terminal:
            assert status.file_details[0].status.value == "success"
            return
        time.sleep(0.05)
    raise AssertionError("ingestion job did not terminate in time")


def _tags(collection, file_name):
    from agent.knowledge import get_available_documents

    return {doc.file_name: doc for doc in get_available_documents(collection)}[file_name].tags


def _person_tags(collection, file_name):
    from agent.knowledge import get_document_person_tags

    return get_document_person_tags(collection, [file_name]).get(file_name)


class TestTheChosenTypeIsAPersonsChoice:
    def test_the_chosen_type_is_stored_as_the_persons_beside_the_classified_disciplines(
        self, tmp_path, ingestor, stores
    ):
        _ingest(ingestor, tmp_path, "proj_a", "letter.txt", document_type=CHOSEN_TYPE)

        assert _tags("proj_a", "letter.txt") == [CHOSEN_TYPE, CLASSIFIED_DISCIPLINE]
        assert _person_tags("proj_a", "letter.txt") == [CHOSEN_TYPE, CLASSIFIED_DISCIPLINE]

    def test_a_later_read_without_a_choice_keeps_it(self, tmp_path, ingestor, stores, classified):
        _ingest(ingestor, tmp_path, "proj_b", "letter.txt", document_type=CHOSEN_TYPE)
        classified[:] = [SECOND_CLASSIFIED_TYPE]

        _ingest(ingestor, tmp_path, "proj_b", "letter.txt")

        assert _tags("proj_b", "letter.txt") == [CHOSEN_TYPE, CLASSIFIED_DISCIPLINE]

    def test_a_new_choice_replaces_the_type_and_keeps_a_persons_disciplines(self, tmp_path, ingestor, stores):
        from agent.knowledge import set_document_tags_by_person

        _ingest(ingestor, tmp_path, "proj_c", "letter.txt", document_type=CHOSEN_TYPE)
        set_document_tags_by_person("proj_c", "letter.txt", [CHOSEN_TYPE, PERSON_DISCIPLINE])

        _ingest(ingestor, tmp_path, "proj_c", "letter.txt", document_type=LATER_TYPE)

        assert _tags("proj_c", "letter.txt") == [LATER_TYPE, PERSON_DISCIPLINE]

    def test_a_filing_that_chose_nothing_is_classified_as_before(self, tmp_path, ingestor, stores):
        _ingest(ingestor, tmp_path, "proj_d", "letter.txt")

        assert _tags("proj_d", "letter.txt") == [CLASSIFIED_TYPE, CLASSIFIED_DISCIPLINE]
        assert _person_tags("proj_d", "letter.txt") is None
