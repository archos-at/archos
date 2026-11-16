from __future__ import annotations

from agent.common.source_kinds import Shelf
from agent.knowledge.inventory import allocate_inventory
from agent.knowledge.inventory import allocate_inventory_detailed
from agent.knowledge.inventory import document_identity
from agent.knowledge.inventory import render_inventory_block
from agent.knowledge.inventory import set_inventory_drops
from agent.knowledge.inventory import set_norm_families
from agent.knowledge.inventory import shelf_hint_from_query
from agent.knowledge.inventory import stamp_document
from agent.knowledge.schema import AvailableDocument
from agent.knowledge.scoping import ScopedCollection


def _doc(
    name: str,
    *,
    collection: str | None = None,
    shelf: str | None = None,
    summary: str | None = None,
    folder_path: str | None = None,
):
    return AvailableDocument(
        file_name=name,
        summary=summary or f"Summary of {name}",
        collection=collection,
        shelf=shelf,
        folder_path=folder_path,
    )


class TestFoldersInTheInventory:
    def test_a_filed_document_shows_its_folder(self):
        text = render_inventory_block(
            [_doc("plan.pdf", collection="proj_1", shelf="project", folder_path="Brandschutz/Fluchtwege")]
        )
        assert "**plan.pdf** (Ordner: Brandschutz/Fluchtwege)" in text

    def test_a_document_at_the_root_shows_no_folder(self):
        text = render_inventory_block([_doc("plan.pdf", collection="proj_1", shelf="project")])
        assert "Ordner:" not in text
        assert "**plan.pdf**" in text

    def test_the_folder_convention_is_explained_when_a_folder_is_present(self):
        text = render_inventory_block(
            [_doc("plan.pdf", collection="proj_1", shelf="project", folder_path="Brandschutz")]
        )
        assert "(Ordner: Pfad/Unterpfad)" in text
        assert "`folder=`" in text

    def test_nothing_is_said_about_folders_when_no_file_has_one(self):
        text = render_inventory_block([_doc("oib-rl_2.pdf", collection="oib_knowledge", shelf="base")])
        assert "Ordner" not in text

    def test_the_folder_sits_before_the_tags(self):
        text = render_inventory_block(
            [
                AvailableDocument(
                    file_name="plan.pdf",
                    summary="Ein Plan.",
                    tags=["Grundriss"],
                    collection="proj_1",
                    shelf="project",
                    folder_path="Brandschutz",
                )
            ]
        )
        assert "**plan.pdf** (Ordner: Brandschutz) [Grundriss]: Ein Plan." in text


class TestStampDocument:
    def test_copies_collection_and_shelf_without_mutating(self):
        original = _doc("Plan.pdf")
        stamped = stamp_document(original, collection="archiv_org", shelf=Shelf.OFFICE_SHELF)
        assert stamped.collection == "archiv_org"
        assert stamped.shelf == "office_shelf"
        assert original.collection is None
        assert original.shelf is None

    def test_unknown_shelf_stays_none(self):
        stamped = stamp_document(_doc("x.pdf"), collection="custom", shelf=None)
        assert stamped.collection == "custom"
        assert stamped.shelf is None


class TestDocumentIdentity:
    def test_same_filename_on_two_shelves_is_two_documents(self):
        project = _doc("Plan.pdf", collection="proj_1", shelf="project")
        office_shelf = _doc("Plan.pdf", collection="archiv_org", shelf="office_shelf")
        assert document_identity(project) != document_identity(office_shelf)

    def test_identity_is_collection_and_name(self):
        assert document_identity(_doc("a.pdf", collection="proj_1")) == ("proj_1", "a.pdf")


class TestAllocateInventory:
    def test_same_filename_on_two_collections_is_kept_twice(self):
        docs = [
            _doc("Plan.pdf", collection="proj_1", shelf="project"),
            _doc("Plan.pdf", collection="archiv_org", shelf="office_shelf"),
        ]
        out = allocate_inventory(docs, max_documents=50)
        assert len(out) == 2
        assert {d.collection for d in out} == {"proj_1", "archiv_org"}

    def test_user_shelves_are_not_evicted_by_the_oib_corpus(self):
        base = [_doc(f"oib-rl_{i}.pdf", collection="oib_knowledge", shelf="base") for i in range(40)]
        office_shelf = [_doc("Buero-Standard.pdf", collection="archiv_org", shelf="office_shelf")]
        project = [_doc("Lacknergasse.pdf", collection="proj_1", shelf="project")]
        out = allocate_inventory(base + office_shelf + project, max_documents=20)
        names = {d.file_name for d in out}
        assert "Buero-Standard.pdf" in names
        assert "Lacknergasse.pdf" in names
        assert sum(1 for d in out if d.shelf == "base") == 18

    def test_cap_of_zero_keeps_everything(self):
        docs = [_doc(f"{i}.pdf", collection="oib_knowledge", shelf="base") for i in range(5)]
        assert len(allocate_inventory(docs, max_documents=0)) == 5

    def test_within_a_shelf_the_cut_is_filename_sorted(self):
        docs = [
            _doc("m.pdf", collection="oib_knowledge", shelf="base"),
            _doc("a.pdf", collection="oib_knowledge", shelf="base"),
            _doc("z.pdf", collection="oib_knowledge", shelf="base"),
        ]
        out = allocate_inventory(docs, max_documents=2)
        assert [d.file_name for d in out] == ["a.pdf", "m.pdf"]

    def test_fair_share_when_user_shelves_overflow_the_cap(self):
        project = [_doc(f"p{i:02d}.pdf", collection="proj_1", shelf="project") for i in range(30)]
        office_shelf = [_doc(f"a{i:02d}.pdf", collection="archiv_org", shelf="office_shelf") for i in range(5)]
        out = allocate_inventory(project + office_shelf, max_documents=10)
        assert any(d.shelf == "office_shelf" for d in out)
        assert any(d.shelf == "project" for d in out)
        assert len(out) == 10

    def test_unknown_shelf_is_not_treated_as_base(self):
        unknown = [_doc("mystery.pdf", collection="custom_x", shelf=None)]
        base = [_doc(f"oib-{i}.pdf", collection="oib_knowledge", shelf="base") for i in range(10)]
        out = allocate_inventory(unknown + base, max_documents=3)
        assert "mystery.pdf" in {d.file_name for d in out}


class TestRenderInventoryBlock:
    def test_groups_by_shelf_and_refuses_to_call_oib_the_office_shelf(self):
        docs = [
            _doc("oib-rl_2.pdf", collection="oib_knowledge", shelf="base", summary="Brandschutz."),
            _doc("Lacknergasse.pdf", collection="proj_1", shelf="project", summary="Ansichten."),
            _doc("Buero-Standard.pdf", collection="archiv_org", shelf="office_shelf", summary="Detail."),
        ]
        text = render_inventory_block(docs)

        assert "Büroablage" in text
        assert "Projektwissen" in text
        assert "Basiswissen" in text
        assert "Buero-Standard.pdf" in text
        assert "Lacknergasse.pdf" in text
        assert "oib-rl_2.pdf" not in text

        office_shelf = text.split("### Büroablage", 1)[1].split("### ", 1)[0]
        assert "Buero-Standard.pdf" in office_shelf
        assert "oib-rl_2.pdf" not in office_shelf
        assert "Lacknergasse.pdf" not in office_shelf

        base = text.split("### Basiswissen", 1)[1]
        assert "Buero-Standard.pdf" not in base
        assert "Lacknergasse.pdf" not in base

        assert "NOT base/OIB" in text
        assert "Never the Büroablage" in text or "never the Büroablage" in text
        assert "always on this request" in text
        assert "on every project" in text
        assert "on every session of this project" in text
        assert "only this chat" in text

    def test_empty_in_scope_office_shelf_is_shown_empty_not_omitted(self):
        docs = [_doc("oib-rl_2.pdf", collection="oib_knowledge", shelf="base")]
        text = render_inventory_block(docs, in_scope_shelves=[Shelf.OFFICE_SHELF, Shelf.BASE])
        assert "### Büroablage" in text
        office_shelf = text.split("### Büroablage", 1)[1].split("### ", 1)[0]
        assert "empty" in office_shelf.lower()
        assert "oib-rl_2.pdf" not in office_shelf

    def test_listing_rule_is_in_the_block(self):
        text = render_inventory_block([_doc("a.pdf", collection="proj_1", shelf="project")])
        assert "which files" in text.lower() or "welche Dateien" in text
        assert "ONLY from that shelf" in text or "only from that shelf" in text

    def test_index_not_sources_banner_survives(self):
        text = render_inventory_block([_doc("a.pdf", collection="proj_1", shelf="project")])
        assert "NOT sources" in text
        assert "not a citable source" in text.lower() or "not evidence" in text.lower()

    def test_nothing_to_show_when_no_docs_and_no_scope(self):
        assert render_inventory_block([]) == ""

    def test_project_docs_without_scope_still_show_empty_office_shelf(self):
        docs = [_doc("Lacknergasse.pdf", collection="proj_1", shelf="project")]
        text = render_inventory_block(docs)
        assert "### Büroablage" in text
        office_shelf = text.split("### Büroablage", 1)[1].split("### ", 1)[0]
        assert "empty" in office_shelf.lower()
        assert "Lacknergasse.pdf" not in office_shelf

    def test_base_only_does_not_invent_an_empty_office_shelf(self):
        text = render_inventory_block([_doc("oib-rl_2.pdf", collection="oib_knowledge", shelf="base")])
        assert "### Büroablage" not in text

    def test_listing_focus_hides_other_shelves(self):
        docs = [
            _doc("oib-rl_2.pdf", collection="oib_knowledge", shelf="base"),
            _doc("Lacknergasse.pdf", collection="proj_1", shelf="project"),
            _doc("Buero-Standard.pdf", collection="archiv_org", shelf="office_shelf"),
        ]
        text = render_inventory_block(docs, focus_shelf=Shelf.OFFICE_SHELF)
        assert "Buero-Standard.pdf" in text
        assert "oib-rl_2.pdf" not in text
        assert "Lacknergasse.pdf" not in text
        assert "### Büroablage" in text
        assert "### Basiswissen" not in text
        assert "other shelves" in text.lower()


class TestShelfHintFromQuery:
    def test_office_shelf_typos_and_german(self):
        assert shelf_hint_from_query("welche datein hast du im Bro archiv") == Shelf.OFFICE_SHELF
        assert shelf_hint_from_query("nicht im projekt was hast du im archiv") == Shelf.OFFICE_SHELF
        assert shelf_hint_from_query("was liegt in der Büroablage") == Shelf.OFFICE_SHELF
        assert shelf_hint_from_query("was liegt im Büroarchiv") == Shelf.OFFICE_SHELF

    def test_the_new_name_is_a_listing_in_every_phrasing(self):
        assert shelf_hint_from_query("was ist in der Büroablage") == Shelf.OFFICE_SHELF
        assert shelf_hint_from_query("welche Dateien hast du in der Bueroablage") == Shelf.OFFICE_SHELF
        assert shelf_hint_from_query("und in der Büroablage?") == Shelf.OFFICE_SHELF
        assert shelf_hint_from_query("Büroablage?") == Shelf.OFFICE_SHELF
        assert shelf_hint_from_query("what files are in office filing") == Shelf.OFFICE_SHELF

    def test_project_vs_base(self):
        assert shelf_hint_from_query("welche Dateien hast du im Projekt") == Shelf.PROJECT
        assert shelf_hint_from_query("welche OIB-Richtlinien hast du") == Shelf.BASE

    def test_content_question_is_not_a_shelf_listing(self):
        assert shelf_hint_from_query("was sagt OIB-RL 2 zum Brandschutz") is None
        assert shelf_hint_from_query("zeig mir den Schnitt Lacknergasse") is None

    def test_nearby_german_listings_are_not_research(self):
        assert shelf_hint_from_query("zeig mir die dateien im archiv") == Shelf.OFFICE_SHELF
        assert shelf_hint_from_query("liste das büroarchiv") == Shelf.OFFICE_SHELF
        assert shelf_hint_from_query("hast du was im archiv") == Shelf.OFFICE_SHELF
        assert shelf_hint_from_query("und im archiv?") == Shelf.OFFICE_SHELF


class TestScopedCollectionRoundTrip:
    def test_scope_entries_carry_the_shelf_the_renderer_needs(self):
        entries = [
            ScopedCollection("archiv_org", Shelf.OFFICE_SHELF),
            ScopedCollection("oib_knowledge", Shelf.BASE),
        ]
        text = render_inventory_block([], in_scope_shelves=[e.shelf for e in entries if e.shelf])
        assert "### Büroablage" in text
        assert "empty" in text.lower()


class TestTruncationIsAnnouncedToTheModel:
    def teardown_method(self):
        set_inventory_drops(None)

    def test_reports_what_the_cap_dropped_per_shelf(self):
        docs = [_doc(f"archiv-{i:02d}.pdf", collection="archiv_org", shelf="office_shelf") for i in range(10)]
        docs += [_doc(f"proj-{i:02d}.pdf", collection="proj_1", shelf="project") for i in range(4)]
        kept, dropped = allocate_inventory_detailed(docs, max_documents=6)

        assert len(kept) == 6
        assert dropped[Shelf.OFFICE_SHELF] + dropped[Shelf.PROJECT] == 8
        assert dropped[Shelf.OFFICE_SHELF] > 0

    def test_no_drops_reported_when_nothing_was_cut(self):
        docs = [_doc("a.pdf", collection="proj_1", shelf="project")]
        kept, dropped = allocate_inventory_detailed(docs, max_documents=50)
        assert len(kept) == 1
        assert all(count == 0 for count in dropped.values())

    def test_uncapped_allocation_reports_nothing(self):
        docs = [_doc(f"a{i}.pdf", collection="proj_1", shelf="project") for i in range(3)]
        _, dropped = allocate_inventory_detailed(docs, max_documents=0)
        assert dropped == {}

    def test_the_block_tells_the_model_the_shelf_is_incomplete(self):
        docs = [_doc(f"archiv-{i:02d}.pdf", collection="archiv_org", shelf="office_shelf") for i in range(10)]
        kept, dropped = allocate_inventory_detailed(docs, max_documents=4)
        set_inventory_drops(dropped)

        rendered = render_inventory_block(kept)
        assert "6 more file(s)" in rendered
        assert "incomplete" in rendered

    def test_a_complete_shelf_carries_no_notice(self):
        docs = [_doc("only.pdf", collection="proj_1", shelf="project")]
        kept, dropped = allocate_inventory_detailed(docs, max_documents=50)
        set_inventory_drops(dropped)

        rendered = render_inventory_block(kept)
        assert "more file" not in rendered

    def test_the_notice_lands_in_the_truncated_shelf_section(self):
        docs = [_doc(f"archiv-{i:02d}.pdf", collection="archiv_org", shelf="office_shelf") for i in range(10)]
        docs += [_doc("proj.pdf", collection="proj_1", shelf="project")]
        kept, dropped = allocate_inventory_detailed(docs, max_documents=5)
        set_inventory_drops(dropped)

        rendered = render_inventory_block(kept)
        office_shelf_section = rendered.split("### ")[1]
        assert "Büroablage" in office_shelf_section
        assert "more file(s)" in office_shelf_section

    def test_a_stale_count_from_a_previous_turn_cannot_leak(self):
        set_inventory_drops({Shelf.OFFICE_SHELF: 99})
        set_inventory_drops(None)
        rendered = render_inventory_block([_doc("a.pdf", collection="proj_1", shelf="project")])
        assert "99" not in rendered


class TestBaseShelfIsFolded:
    def teardown_method(self):
        set_inventory_drops(None)

    def test_base_filenames_are_not_spelled_out(self):
        docs = [_doc(f"oib-rl_{i}.pdf", collection="oib_knowledge", shelf="base") for i in range(39)]
        text = render_inventory_block(docs)

        assert "oib-rl_7.pdf" not in text
        assert "39 files" in text

    def test_the_fold_names_the_way_to_reach_the_files(self):
        docs = [_doc(f"oib-rl_{i}.pdf", collection="oib_knowledge", shelf="base") for i in range(39)]
        text = render_inventory_block(docs)

        assert "knowledge_search" in text
        assert "Do not invent" in text

    def test_a_listing_turn_about_base_still_gets_every_name(self):
        docs = [_doc(f"oib-rl_{i}.pdf", collection="oib_knowledge", shelf="base") for i in range(39)]
        text = render_inventory_block(docs, focus_shelf=Shelf.BASE)

        assert "oib-rl_7.pdf" in text
        assert "39 files" not in text

    def test_user_shelves_are_still_spelled_out(self):
        docs = [
            _doc("oib-rl_2.pdf", collection="oib_knowledge", shelf="base"),
            _doc("Lacknergasse.pdf", collection="proj_1", shelf="project"),
            _doc("Buero-Standard.pdf", collection="archiv_org", shelf="office_shelf"),
        ]
        text = render_inventory_block(docs)

        assert "Lacknergasse.pdf" in text
        assert "Buero-Standard.pdf" in text

    def test_the_count_includes_what_the_cap_dropped(self):
        docs = [_doc(f"oib-rl_{i:02d}.pdf", collection="oib_knowledge", shelf="base") for i in range(39)]
        kept, dropped = allocate_inventory_detailed(docs, max_documents=10)
        set_inventory_drops(dropped)

        text = render_inventory_block(kept)

        assert "39 files" in text
        assert "10 files" not in text

    def test_an_empty_base_shelf_still_says_it_is_empty(self):
        text = render_inventory_block([], in_scope_shelves=[Shelf.BASE])
        assert "empty" in text.lower()


class TestTruncationEdgesTheFirstPassMissed:
    def teardown_method(self):
        set_inventory_drops(None)

    def test_base_still_names_itself_when_the_cap_took_every_row(self):
        docs = [_doc(f"proj-{i:02d}.pdf", collection="proj_1", shelf="project") for i in range(6)]
        docs += [_doc(f"oib-{i:02d}.pdf", collection="oib_knowledge", shelf="base") for i in range(39)]
        kept, dropped = allocate_inventory_detailed(docs, max_documents=6)
        set_inventory_drops(dropped)

        rendered = render_inventory_block(kept, in_scope_shelves=[Shelf.PROJECT, Shelf.BASE])

        assert "39 files" in rendered
        base = rendered.split("### Basiswissen", 1)[1]
        assert "empty" not in base.lower()

    def test_a_truncated_unattributed_list_says_it_is_incomplete(self):
        docs = [_doc(f"mystery-{i:02d}.pdf", collection="unknown_coll") for i in range(9)]
        kept, dropped = allocate_inventory_detailed(docs, max_documents=3)
        set_inventory_drops(dropped)

        rendered = render_inventory_block(kept)

        assert "### Unattributed" in rendered
        assert "more file(s) with no shelf stated" in rendered


class TestFilesStillBeingRead:
    def test_it_names_a_file_that_is_still_being_read(self):
        block = render_inventory_block(
            [_doc("oib-rl_2.pdf", collection="oib_knowledge")],
            in_scope_shelves=[ScopedCollection("oib_knowledge", Shelf.BASE)],
            in_flight=["grundriss_eg.pdf"],
        )

        assert "grundriss_eg.pdf" in block
        assert "NOT in the inventory above" in block
        assert "still being processed" in block

    def test_it_forbids_presenting_an_answer_that_silently_omits_it(self):
        block = render_inventory_block(
            [_doc("oib-rl_2.pdf", collection="oib_knowledge")],
            in_scope_shelves=[ScopedCollection("oib_knowledge", Shelf.BASE)],
            in_flight=["plan.pdf"],
        )

        assert "do not present an answer that omits it" in block

    def test_a_bulk_upload_carries_the_shape_and_not_the_list(self):
        block = render_inventory_block(
            [_doc("oib-rl_2.pdf", collection="oib_knowledge")],
            in_scope_shelves=[ScopedCollection("oib_knowledge", Shelf.BASE)],
            in_flight=[f"plan_{i}.pdf" for i in range(40)],
        )

        assert "plan_0.pdf" in block
        assert "plan_39.pdf" not in block
        assert "35 weitere" in block

    def test_nothing_in_flight_changes_nothing(self):
        with_none = render_inventory_block(
            [_doc("oib-rl_2.pdf", collection="oib_knowledge")],
            in_scope_shelves=[ScopedCollection("oib_knowledge", Shelf.BASE)],
        )
        with_empty = render_inventory_block(
            [_doc("oib-rl_2.pdf", collection="oib_knowledge")],
            in_scope_shelves=[ScopedCollection("oib_knowledge", Shelf.BASE)],
            in_flight=[],
        )

        assert with_none == with_empty
        assert "still being read" not in with_none.lower()

    def test_a_first_upload_still_gets_a_block(self):
        block = render_inventory_block([], in_flight=["erste_datei.pdf"])

        assert block != ""
        assert "erste_datei.pdf" in block


class TestTheFamiliesAreNamed:
    def teardown_method(self):
        set_inventory_drops(None)
        set_norm_families(None)

    def _base(self, *names: str):
        return [_doc(name, collection="oib_knowledge", shelf="base") for name in names]

    def test_the_folded_shelf_lists_each_family_and_its_members(self):
        from agent.common.norm_registry import oib_families

        names = [
            "oib-rl_2_ausgabe_mai_2023.pdf",
            "oib-rl_2.1_ausgabe_mai_2023.pdf",
            "oib-rl_2.2_ausgabe_mai_2023.pdf",
            "oib-rl_2.3_ausgabe_mai_2023.pdf",
            "oib-rl_4_ausgabe_mai_2023.pdf",
        ]
        set_norm_families(oib_families(names))

        text = render_inventory_block(self._base(*names))

        assert "OIB-Richtlinie 2: 2, 2.1, 2.2, 2.3" in text
        assert "OIB-Richtlinie 4: 4" in text
        assert "oib-rl_2.3_ausgabe_mai_2023.pdf" not in text

    def test_it_says_what_an_unread_member_may_be_called(self):
        from agent.common.norm_registry import oib_families

        set_norm_families(oib_families(["oib-rl_2_x.pdf", "oib-rl_2.1_x.pdf"]))
        text = render_inventory_block(self._base("oib-rl_2_x.pdf", "oib-rl_2.1_x.pdf"))

        assert "was not read" in text

    def test_a_corpus_with_no_families_adds_no_lines(self):
        set_norm_families(None)
        text = render_inventory_block(self._base("Handbuch.pdf"))

        assert "Richtlinien-Familien" not in text

    def test_a_listing_turn_about_base_prints_names_rather_than_families(self):
        from agent.common.norm_registry import oib_families

        names = ["oib-rl_2_x.pdf", "oib-rl_2.3_x.pdf"]
        set_norm_families(oib_families(names))

        text = render_inventory_block(self._base(*names), focus_shelf=Shelf.BASE)

        assert "oib-rl_2.3_x.pdf" in text
        assert "Richtlinien-Familien" not in text


class TestTopicsAndCaptureInTheInventory:
    LATITUDE = 47.812345
    LONGITUDE = 13.045678

    def _photo(self, *, as_dict: bool = False, **extra):
        row = {
            "file_name": "baustelle.jpg",
            "summary": "Rohbau Ost, Stand Oktober.",
            "collection": "proj_1",
            "shelf": "project",
            **extra,
        }
        if as_dict:
            return row
        return AvailableDocument(
            file_name=row["file_name"],
            summary=row["summary"],
            collection=row["collection"],
            shelf=row["shelf"],
            topics=extra.get("topics"),
            capture=extra.get("capture"),
        )

    def test_topics_are_shown_on_the_row(self):
        text = render_inventory_block([self._photo(topics=["Attika", "Fluchtweg"])])
        assert "**baustelle.jpg** Themen: Attika, Fluchtweg: Rohbau Ost, Stand Oktober." in text

    def test_the_day_a_photo_was_taken_is_shown_and_the_clock_is_not_needed(self):
        capture = {"captured_at": "2026-10-09T14:30:00+02:00", "camera": "Canon EOS R5"}
        text = render_inventory_block([self._photo(capture=capture)])
        assert "- **baustelle.jpg** · aufgenommen 2026-10-09: Rohbau Ost, Stand Oktober." in text
        assert "14:30" not in text

    def test_coordinates_are_never_rendered_for_a_model_object(self):
        capture = {
            "captured_at": "2026-10-09T14:30:00",
            "latitude": self.LATITUDE,
            "longitude": self.LONGITUDE,
            "camera": "Canon EOS R5",
        }
        text = render_inventory_block([self._photo(capture=capture)])
        assert "aufgenommen 2026-10-09" in text
        assert str(self.LATITUDE) not in text
        assert str(self.LONGITUDE) not in text

    def test_coordinates_are_never_rendered_for_a_dict_row(self):
        row = self._photo(
            as_dict=True,
            capture={
                "captured_at": "2026-10-09T14:30:00",
                "latitude": self.LATITUDE,
                "longitude": self.LONGITUDE,
            },
        )
        text = render_inventory_block([row])
        assert "aufgenommen 2026-10-09" in text
        assert str(self.LATITUDE) not in text
        assert str(self.LONGITUDE) not in text

    def test_a_capture_without_a_usable_date_shows_no_date(self):
        text = render_inventory_block([self._photo(capture={"captured_at": "letzte Woche", "latitude": 47.5})])
        assert "aufgenommen" not in text
        assert "47.5" not in text

    def test_a_file_with_no_topics_or_capture_has_neither_bit(self):
        text = render_inventory_block([self._photo()])
        assert "Themen" not in text
        assert "aufgenommen" not in text
        assert "**baustelle.jpg**: Rohbau Ost, Stand Oktober." in text


class TestTheIngestsReading:
    def test_the_type_and_the_unread_pages_are_on_the_line(self):
        doc = _doc("BSK.pdf", collection="proj_1", shelf="project")
        doc.dossier = {"document_type": "fire_safety_concept", "facts": [{"key": "building_class", "value": "4"}]}
        doc.coverage = {"pages": 40, "not_read": 2}

        text = render_inventory_block([doc])

        assert "Typ: fire safety concept" in text
        assert "2 von 40 Seiten nicht vollständig gelesen" in text
        assert "building_class" not in text

    def test_a_document_read_whole_says_nothing_extra(self):
        doc = _doc("BSK.pdf", collection="proj_1", shelf="project")
        doc.dossier = {"document_type": "other"}
        doc.coverage = {"pages": 4, "not_read": 0}

        assert "Typ:" not in render_inventory_block([doc]) and "nicht vollständig" not in render_inventory_block([doc])
