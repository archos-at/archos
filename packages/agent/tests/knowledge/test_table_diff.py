from __future__ import annotations

from agent.knowledge.revision_diff import diff_revisions
from agent.knowledge.revision_diff import render_diff
from agent.knowledge.table_diff import MAX_ROWS_SHOWN
from agent.knowledge.table_diff import TableChunk
from agent.knowledge.table_diff import diff_tables
from agent.knowledge.table_diff import render_tables
from agent.knowledge.table_diff import same_cell
from agent.knowledge.table_diff import table_chunk_from_store

HEADER = ["Nr.", "Raum", "Fläche"]


def _markdown(header: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    lines.extend("| " + " | ".join(row) + " |" for row in rows)
    return "\n".join(lines)


def _sheet(
    rows: list[list[str]], *, header: list[str] = HEADER, sheet: str = "Raumliste", part: str = ""
) -> TableChunk:
    locator = f"{sheet}: Zeilen 2-{len(rows) + 1}{part}"
    return TableChunk(
        page=sheet, locator=locator, text=f"Tabellenblatt „{sheet}“, {locator}\n\n{_markdown(header, rows)}"
    )


ROOMS = [["1.01", "Wohnen", "23,40 m²"], ["1.02", "Küche", "9,80 m²"], ["1.03", "Bad", "5,10 m²"]]


class TestRowsByKey:
    def test_identical_lists_have_no_deviation(self) -> None:
        diff = diff_tables([_sheet(ROOMS)], [_sheet(ROOMS)])

        assert not diff.differs
        assert diff.tables[0].equal_rows == 3
        assert diff.tables[0].key_column == "Nr."

    def test_a_changed_cell_names_its_row_its_column_and_both_places(self) -> None:
        second = [ROOMS[0], ["1.02", "Küche", "10,20 m²"], ROOMS[2]]

        table = diff_tables([_sheet(ROOMS)], [_sheet(second)]).tables[0]

        assert [(c.key, [(x.column, x.first, x.second) for x in c.cells]) for c in table.changed] == [
            ("1.02", [("Fläche", "9,80 m²", "10,20 m²")])
        ]
        assert table.changed[0].first_place == "Raumliste: Zeilen 2-4"
        assert table.equal_rows == 2

    def test_a_reordered_list_is_matched_by_its_key_not_by_its_order(self) -> None:
        table = diff_tables([_sheet(ROOMS)], [_sheet(list(reversed(ROOMS)))]).tables[0]

        assert not table.differs and table.equal_rows == 3

    def test_a_row_in_one_file_only_is_said_for_that_file(self) -> None:
        second = [ROOMS[0], ROOMS[2], ["1.04", "Abstellraum", "2,00 m²"]]

        table = diff_tables([_sheet(ROOMS)], [_sheet(second)]).tables[0]

        assert [row.key for row in table.only_first] == ["1.02"]
        assert [row.key for row in table.only_second] == ["1.04"]
        assert table.changed == ()

    def test_the_key_is_the_column_that_identifies_rows_in_both_files(self) -> None:
        header = ["Geschoss", "Raum", "Fläche"]
        first = [["EG", "Wohnen", "23,40"], ["EG", "Küche", "9,80"]]
        second = [["EG", "Küche", "9,80"], ["EG", "Wohnen", "24,00"]]

        table = diff_tables([_sheet(first, header=header)], [_sheet(second, header=header)]).tables[0]

        assert table.key_column == "Raum"
        assert [c.key for c in table.changed] == ["Wohnen"]

    def test_the_parts_of_one_sheet_are_one_table(self) -> None:
        first = [_sheet(ROOMS[:2], part=" (Teil 1 von 2)"), _sheet(ROOMS[2:], part=" (Teil 2 von 2)")]

        diff = diff_tables(first, [_sheet(ROOMS)])

        assert len(diff.tables) == 1 and not diff.differs


def _pdf_page(page: int, rows: list[list[str]]) -> TableChunk:
    return TableChunk(page=str(page), locator="", text=f"[TABLE from page {page}]\n\n{_markdown(HEADER, rows)}")


def _pdf_pages(rows: list[list[str]], per_page: int) -> list[TableChunk]:
    return [_pdf_page(n // per_page + 1, rows[n : n + per_page]) for n in range(0, len(rows), per_page)]


class TestAListOverSeveralPages:
    rooms = [[f"1.{n:02d}", f"Raum {n}", "10,00 m²"] for n in range(1, 9)]

    def test_shifted_page_breaks_report_no_row_as_missing(self) -> None:
        longer = [["0.01", "Windfang", "4,00 m²"], *self.rooms]

        diff = diff_tables(_pdf_pages(self.rooms, 4), _pdf_pages(longer, 4))

        assert len(diff.tables) == 1 and not diff.unpaired_first and not diff.unpaired_second
        table = diff.tables[0]
        assert table.only_first == () and table.changed == () and table.equal_rows == 8
        assert [(row.key, row.place) for row in table.only_second] == [("0.01", "page 1")]

    def test_a_row_keeps_the_page_it_stands_on(self) -> None:
        moved = [["0.01", "Windfang", "4,00 m²"], *self.rooms[:7], ["1.08", "Raum 8", "11,00 m²"]]

        table = diff_tables(_pdf_pages(self.rooms, 4), _pdf_pages(moved, 4)).tables[0]

        assert [(c.key, c.first_place, c.second_place) for c in table.changed] == [("1.08", "page 2", "page 3")]

    def test_the_list_is_one_table_named_by_its_pages(self) -> None:
        rooms = [[f"{n}", f"Raum {n}", "10"] for n in range(40)]

        text = "\n".join(render_tables(diff_tables(_pdf_pages(rooms, 2), _pdf_pages(rooms[:-1], 3)), "A.pdf", "B.pdf"))

        assert "Table pages 1–20 ↔ pages 1–13: rows matched by column „Nr.“; 39 equal" in text
        assert "more tables" not in text and "Tables only in" not in text

    def test_two_captioned_tables_with_one_header_stay_two(self) -> None:
        first = [
            TableChunk("2", "Tabelle 1", _markdown(HEADER, ROOMS[:2])),
            TableChunk("3", "Tabelle 2", _markdown(HEADER, ROOMS[2:])),
        ]

        assert len(diff_tables(first, first).tables) == 2


class TestSheetsNamedWithDigits:
    def test_each_sheet_is_its_own_table_matched_by_its_key(self) -> None:
        rooms = [["1.01", "Wohnen", "20"], ["1.02", "Bad", "5"]]
        first = [_sheet(rooms, sheet="2025"), _sheet(rooms, sheet="2026")]
        second = [_sheet(rooms, sheet="2025"), _sheet(list(reversed(rooms)), sheet="2026")]

        diff = diff_tables(first, second)

        assert [(t.first_label, t.second_label, t.key_column) for t in diff.tables] == [
            ("„2025“", "„2025“", "Nr."),
            ("„2026“", "„2026“", "Nr."),
        ]
        assert not diff.differs and [t.equal_rows for t in diff.tables] == [2, 2]

    def test_a_sheet_only_one_file_has_is_named_as_a_sheet(self) -> None:
        rooms = [["1.01", "Wohnen", "20"]]
        other = _sheet([["T1", "Tür", "EI2 30"]], header=["Pos.", "Bauteil", "Klasse"], sheet="2")

        diff = diff_tables([_sheet(rooms, sheet="1"), other], [_sheet(rooms, sheet="1")])

        assert diff.unpaired_first == ("„2“",)


class TestCells:
    def test_the_same_number_written_two_ways_is_no_deviation(self) -> None:
        assert same_cell("12,50 m²", "12.5 m²")
        assert same_cell("1.234,50", "1234.5")
        assert same_cell(" Wohnen ", "wohnen")

    def test_another_unit_or_another_number_is_a_deviation(self) -> None:
        assert not same_cell("12,50 m²", "12,50 m")
        assert not same_cell("12,50", "12,51")

    def test_a_dot_before_three_digits_is_not_read_as_a_decimal_point(self) -> None:
        assert not same_cell("1.250", "1,25")
        assert not same_cell("1.01", "1.010")
        assert same_cell("1.250.000", "1250000")
        assert same_cell("1.250", "1.250")

    def test_a_code_with_a_leading_zero_is_no_number(self) -> None:
        assert not same_cell("01", "1")
        assert same_cell("0,50", "0.5")

    def test_a_trailing_zero_is_ignored_only_with_a_unit_or_another_decimal_mark(self) -> None:
        assert not same_cell("0.1", "0.10")
        assert not same_cell("1.1", "1.10")
        assert same_cell("12.50 m²", "12.5 m²")
        assert same_cell("12,50", "12.5")
        assert same_cell("12", "12,0")

    def test_an_escaped_pipe_stays_inside_its_cell(self) -> None:
        rows = [["1.01", "Wohnen \\| Essen", "23,40"]]

        table = diff_tables([_sheet(rows)], [_sheet([["1.01", "Wohnen", "23,40"]])]).tables[0]

        assert [(x.column, x.first) for x in table.changed[0].cells] == [("Raum", "Wohnen | Essen")]


class TestWithoutAKey:
    def test_rows_are_matched_in_their_order(self) -> None:
        header = ["Geschoss", "Nutzung"]
        first = [["EG", "Wohnen"], ["EG", "Wohnen"], ["OG", "Büro"]]
        second = [["EG", "Wohnen"], ["EG", "Wohnen"], ["OG", "Lager"], ["DG", "Technik"]]

        table = diff_tables([_sheet(first, header=header)], [_sheet(second, header=header)]).tables[0]

        assert table.key_column is None
        assert table.equal_rows == 2
        assert [[(x.column, x.first, x.second) for x in c.cells] for c in table.changed] == [
            [("Nutzung", "Büro", "Lager")]
        ]
        assert [row.key for row in table.only_second] == ["DG | Technik"]


class TestPairingTables:
    def test_a_column_only_one_file_has_is_named_and_not_compared(self) -> None:
        wider = [[*row, "Parkett"] for row in ROOMS]

        table = diff_tables([_sheet(ROOMS)], [_sheet(wider, header=[*HEADER, "Belag"])]).tables[0]

        assert table.columns_only_second == ("Belag",)
        assert table.changed == () and table.equal_rows == 3

    def test_a_table_without_a_counterpart_is_listed_not_compared(self) -> None:
        other = _sheet([["T1", "Tür", "EI2 30"]], header=["Pos.", "Bauteil", "Klasse"], sheet="Türliste")

        diff = diff_tables([_sheet(ROOMS), other], [_sheet(ROOMS)])

        assert diff.unpaired_first == ("„Türliste“",)
        assert len(diff.tables) == 1

    def test_text_that_is_no_markdown_table_is_no_table(self) -> None:
        assert not diff_tables([TableChunk("3", "", "[TABLE from page 3]\n\nNr Raum Fläche")], []).found


class TestRendering:
    def test_each_deviation_carries_the_place_in_both_files(self) -> None:
        second = [ROOMS[0], ["1.02", "Küche", "10,20 m²"]]

        text = "\n".join(render_tables(diff_tables([_sheet(ROOMS)], [_sheet(second)]), "A.xlsx", "B.xlsx"))

        assert "rows matched by column „Nr.“; 1 equal, 1 differ, 1 only in „A.xlsx“, 0 only in „B.xlsx“." in text
        assert (
            "- Row „1.02“: Fläche 9,80 m² → 10,20 m². "
            "[„A.xlsx“: Raumliste: Zeilen 2-4 · „B.xlsx“: Raumliste: Zeilen 2-3]"
        ) in text
        assert "- Only in „A.xlsx“: row „1.03“ (1.03 | Bad | 5,10 m²). [Raumliste: Zeilen 2-4]" in text

    def test_a_cut_list_says_that_it_is_cut(self) -> None:
        first = [[str(n), f"Raum {n}", "10"] for n in range(MAX_ROWS_SHOWN + 5)]
        second = [[str(n), f"Raum {n}", "11"] for n in range(MAX_ROWS_SHOWN + 5)]

        text = "\n".join(render_tables(diff_tables([_sheet(first)], [_sheet(second)]), "A.xlsx", "B.xlsx"))

        assert "… and 5 more deviating rows in this table that are NOT listed here" in text

    def test_a_pdf_table_is_placed_by_its_page(self) -> None:
        first = TableChunk("12", "Tabelle 3", "Tabelle 3: Räume\n\n" + _markdown(HEADER, ROOMS))
        second = TableChunk("14", "Tabelle 3", "Tabelle 3: Räume\n\n" + _markdown(HEADER, [ROOMS[0]]))

        text = "\n".join(render_tables(diff_tables([first], [second]), "A.pdf", "B.pdf"))

        assert "Table Tabelle 3, page 12 ↔ Tabelle 3, page 14:" in text


class TestInTheComparison:
    def test_two_spreadsheets_are_compared_by_their_tables_alone(self) -> None:
        tables = diff_tables([_sheet(ROOMS)], [_sheet([ROOMS[0], ROOMS[1]])])

        text = render_diff(diff_revisions([], []), "A.xlsx", "B.xlsx", tables=tables, related=False)

        assert "Comparison of two different documents, first „A.xlsx“ → second „B.xlsx“" in text
        assert "Pages:" not in text
        assert "Only in „A.xlsx“: row „1.03“" in text
        assert "do not differ" not in text and "Neither file" not in text
        assert "name both as its basis" in text

    def test_equal_tables_are_said_to_be_equal(self) -> None:
        tables = diff_tables([_sheet(ROOMS)], [_sheet(ROOMS)])

        text = render_diff(diff_revisions([], []), "A.xlsx", "B.xlsx", tables=tables, related=False)

        assert "In the read content the two files do not differ." in text


class TestFromTheStore:
    def test_a_table_chunk_keeps_its_page_and_its_locator(self) -> None:
        chunk = table_chunk_from_store(
            "x", {"content_type": "table", "page_label": "Raumliste", "clause_id": "Raumliste: Zeilen 2-4"}
        )

        assert chunk == TableChunk(page="Raumliste", locator="Raumliste: Zeilen 2-4", text="x")

    def test_a_text_chunk_is_no_table(self) -> None:
        assert table_chunk_from_store("x", {"content_type": "text", "page_label": "1"}) is None
