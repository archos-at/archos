from agent.knowledge import folder_cards


class _Store:
    def __init__(self):
        self.asked: list[tuple[list[str], list[str] | None]] = []

    def get_folder_paths_batch(self, collection, filenames, *, document_ids=None):
        self.asked.append((list(filenames), document_ids))
        paths = {"doc-eg": "Einreichung", "doc-og": "Ausführung/OG", "oib-rl_2.pdf": "Normen"}
        return {key: paths[key] for key in [*filenames, *(document_ids or [])] if key in paths}


def _marked(monkeypatch) -> list:
    marked: list = []
    monkeypatch.setattr(folder_cards, "enabled_for_collection", lambda collection: True)
    monkeypatch.setattr(folder_cards, "mark_folders", lambda collection, paths: marked.append(sorted(paths)))
    return marked


def test_two_namesakes_mark_their_own_folders(monkeypatch):
    marked, store = _marked(monkeypatch), _Store()

    folder_cards.mark_files("proj_a", [], store, document_ids=["doc-eg", "doc-og"])

    assert store.asked == [([], ["doc-eg", "doc-og"])]
    assert marked == [["Ausführung/OG", "Einreichung"]]


def test_a_document_without_an_id_is_marked_by_name(monkeypatch):
    marked, store = _marked(monkeypatch), _Store()

    folder_cards.mark_files("base_corpus", ["oib-rl_2.pdf"], store)

    assert store.asked == [(["oib-rl_2.pdf"], None)]
    assert marked == [["Normen"]]


def test_nothing_named_marks_nothing(monkeypatch):
    marked, store = _marked(monkeypatch), _Store()

    folder_cards.mark_files("proj_a", None, store, document_ids=[])

    assert store.asked == [] and marked == []
