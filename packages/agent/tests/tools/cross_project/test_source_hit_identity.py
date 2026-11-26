from agent.tools.cross_project.source_hits import _hit


def _raw(**extra):
    return {
        "project": {"id": "p-2", "name": "Wohnbau Nord"},
        "filename": "Plan.pdf",
        "collection": "proj_p2",
        "page": 3,
        "snippet": "Traufe",
        "score": 0.8,
        **extra,
    }


def test_a_cross_project_hit_names_its_document_by_id():
    assert _hit(_raw(documentId="doc-1")).document_id == "doc-1"


def test_a_hit_without_an_id_names_none():
    assert _hit(_raw()).document_id is None
