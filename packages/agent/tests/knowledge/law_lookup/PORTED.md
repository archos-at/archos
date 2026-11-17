# The RIS tool's behaviour tests, ported to `law_lookup`

The country-as-data plan (step 4, `docs/design/international/country-as-data.md`)
deletes `packages/ris-adapter/src/lookup/` once `agent.knowledge.law_lookup`
replaces it. This table is the evidence that no behaviour its tests asserted dies
with it: every test in `packages/ris-adapter/tests/test_ris_lookup_*.py`, and every
other test that ran `ris_adapter.lookup`, mapped to the test that now asserts the
same behaviour of `law_lookup`, or to why none is needed.

## How the ported suites run the lookup

Through the parity rig's seams (`agent_testing.law_lookup_parity`): the rig's
`Upstream` at the network edge, scripted planner and picker at the two model
calls, the real tool bound through the agent runtime under a turn that carries a
released record. `agent_testing.law_lookup_portal` adds what a behaviour test
needs and a parity case does not: a **searchable** statute portal of the synthetic
country XA (`XA_STATUTES`: `rest` access, the OGD JSON engine, two provinces,
national and regional collections, a version date parameter, a reference prefix
table), scripted model calls that record whether they ran, a catalog the test
chooses, and one bound tool for several calls. No ported test names Austria; the
Austrian record's own strings stay covered byte for byte by
`test_law_lookup_parity.py`.

What changed between the two suites, apart from the record:

- The RIS tool's tests replaced `RisClient` with a fake that returned plain text.
  The ported tests go through `SourceClient`, the fetcher's transport and the
  format engine, so a page is converted as a real one is (`law_lookup_portal.page`
  says why its pages use line breaks).
- The RIS fixture ingested into the session collection by default; the ported
  session binds `ingest_into_knowledge=False`, as the parity rig does. No RIS
  lookup test asserted the ingest.
- Signatures the new modules take a source in (`in_force_on(..., engine)`,
  `_span_context(..., tool)`, `parse_address(..., law)`) are called with XA's.

## Coverage

Old file → new file, test by test. "Same name" means the test function carries
the old name and its assertions unchanged (checked by diffing the `assert` lines).

### `test_ris_lookup_address.py` (39) → `test_law_lookup_address.py`

Ported in #1624: all 39 tests carry the same name and the same assertions,
against the at-ris record's grammar (the address parser reads that record's
words, which the tests are about). Nothing to add.

### `test_ris_lookup_grammar.py` (20) → `test_law_lookup_grammar.py`

Ported in #1624: all 20 tests, same names and assertions. Nothing to add.

### `test_ris_lookup_bounds.py` (6) → `test_law_lookup_bounds.py`

| Old test | New test |
|---|---|
| `test_a_twelve_hit_catalog_match_reads_at_most_two_documents` | `test_a_twelve_entry_catalog_match_reads_two_documents` (twelve distinct documents; asserts exactly 2, not at most) |
| `test_at_most_three_candidates_are_considered` | `test_at_most_three_candidates_are_considered` (twelve reference-only entries, so the miss names exactly 3) |
| `test_a_live_search_of_twenty_hits_considers_three` | `test_a_live_search_of_twenty_hits_fetches_two` (twenty fetchable hits; exactly 2 fetched) |
| `test_at_most_six_passages_come_back` | `test_at_most_six_passages_come_back` |
| `test_passages_come_from_at_most_two_documents` | `test_passages_come_from_at_most_two_documents` (asserts exactly 2) |
| `test_a_nine_hundred_kilobyte_law_does_not_reach_the_transcript` | same name |

### `test_ris_lookup_repeat.py` (3) → `test_law_lookup_repeat.py`

| Old test | New test |
|---|---|
| `test_the_second_identical_lookup_downloads_nothing` | same name |
| `test_a_second_question_about_the_same_law_downloads_nothing_either` | same name |
| `test_ris_lookup_is_not_signed_by_the_duplicate_fetch_guard` | `test_the_lookup_is_not_signed_by_the_duplicate_fetch_guard`, over `law_lookup`, `ris_lookup` and `ris_lookup_tool` |

### `test_ris_lookup_miss.py` (11) → `test_law_lookup_miss.py`

| Old test | New test |
|---|---|
| `test_nothing_matched_anywhere_still_says_what_was_searched` | same name |
| `test_an_unresolved_federal_state_is_the_first_thing_the_retry_asks_for` | `test_an_unresolved_province_is_the_first_thing_the_retry_asks_for` |
| `test_a_catalog_entry_with_no_full_text_is_named_and_not_invented` | same name |
| `test_a_web_only_catalog_entry_hands_the_web_tool_its_next_move` | same name |
| `test_a_document_that_was_read_but_answers_nothing_returns_its_index` | same name |
| `test_a_named_paragraph_the_law_does_not_have_is_a_miss_not_a_guess` | `test_a_named_provision_the_law_does_not_have_is_a_miss_not_a_guess` |
| `test_a_failed_live_search_is_a_miss_with_a_retry_not_an_exception` | same name, twice: the format's own refusal and an HTTP 503 |
| `test_a_live_hit_that_cannot_be_fetched_is_named_as_unread` | same name |
| `TestActionRow::test_a_miss_is_an_empty_row` | same name |
| `TestActionRow::test_a_named_paragraph_is_an_ok_row_with_its_passage_count` | `TestActionRow::test_a_named_provision_is_an_ok_row_with_its_passage_count` |
| `TestActionRow::test_an_empty_question_is_refused_without_a_row` | same name, and asserts the refusal's text |

### `test_ris_lookup_as_of.py` (10) → `test_law_lookup_as_of.py`

| Old test | New test |
|---|---|
| `test_reads_only_the_version_in_force_on_the_day` | same name (the record's date parameter for the collection is `Version.On`) |
| `test_positive_control_today_reads_the_current_version` | same name |
| `test_no_version_of_the_day_is_a_miss_that_does_not_substitute_today` | same name |
| `test_a_past_day_never_reads_the_catalog_or_the_whole_law` | same name |
| `test_a_malformed_day_is_an_error` | same name |
| `test_the_version_window_holds_its_last_day_and_excludes_unknown_dates` | same name, the window's labels read off the engine |
| `test_the_lookup_span_records_the_day_asked_for_and_the_versions_left_unread` | same name |
| `test_a_date_with_trailing_text_is_no_date_but_a_timestamp_is_its_day` | same name |
| `test_every_turn_is_offered_as_of_and_it_reaches_the_tool` | same name; the description is the bound record's (`describe`) |
| `test_no_switch_decides_the_offer_any_more` | same name, over `law_lookup.as_of` |

### `test_ris_lookup_deterministic_locator.py` (8) → `test_law_lookup_deterministic_locator.py`

| Old test | New test |
|---|---|
| `test_a_named_paragraph_makes_no_picker_call` | `test_a_named_provision_makes_no_picker_call` |
| `test_a_named_paragraph_makes_no_planner_call_either` | `test_a_named_provision_makes_no_planner_call_either` |
| `test_the_paragraph_comes_back_with_its_absaetze` | `test_the_provision_comes_back_with_its_parts` |
| `test_only_the_named_paragraph_comes_back` | `test_only_the_named_provision_comes_back` |
| `test_a_pasted_ris_url_is_an_address_and_needs_no_search` | `test_a_pasted_source_url_is_an_address_and_needs_no_search` |
| `test_a_list_of_paragraphs_comes_back_whole_in_one_call` | `test_a_list_of_provisions_comes_back_whole_in_one_call` |
| `test_a_subsection_the_paragraph_lacks_comes_back_once` | `test_a_part_the_provision_lacks_comes_back_once` |
| `test_a_list_past_the_budget_says_what_it_did_not_read` | same name |

### `test_ris_lookup_format.py` (8) → `test_law_lookup_format.py`

| Old test | New test |
|---|---|
| `test_the_block_carries_every_field_the_grounding_grammar_needs` | same name, plus the consolidated-text note line |
| `test_the_knowledge_parser_reads_it_as_evidence` | same name, under the name `law_lookup` |
| (none) | `test_a_replayed_turn_reads_the_same_sources_off_the_text`: records path and text path agree (see difference 1) |
| `test_only_the_named_subsection_is_returned` | `test_only_the_named_part_is_returned` |
| `test_the_lane_is_the_legal_source_lane_not_unknown` | same name; asserts the kind, not the lane key (see observation 2) |
| `test_a_named_section_arrives_whole` | `test_a_named_provision_arrives_whole` |
| `test_a_named_section_is_still_bounded` | `test_a_named_provision_is_still_bounded` |
| `test_a_named_subsection_comes_with_its_whole_section` | `test_a_named_part_comes_with_its_whole_provision` |
| `test_a_section_too_long_to_hand_over_stays_its_subsection` | `test_a_provision_too_long_to_hand_over_stays_its_part` |

### `test_ris_lookup_jurisdiction.py` (5) → `test_law_lookup_jurisdiction.py`

| Old test | New test |
|---|---|
| `test_a_tyrolean_question_never_reads_viennese_law` | `test_a_southmark_question_never_reads_northmark_law` |
| `test_the_assumed_land_and_its_provenance_are_in_the_output` | `test_the_assumed_province_and_its_provenance_are_in_the_output` |
| `test_the_land_travels_into_the_collection_line` | `test_the_province_travels_into_the_collection_line` |
| `test_the_land_read_off_the_question_is_labelled_as_such` | `test_the_province_read_off_the_question_is_labelled_as_such` |
| `test_the_caller_land_outranks_the_planner_in_a_live_search` | `test_the_caller_province_outranks_the_planner_in_a_live_search` |

### Other tests that ran `ris_adapter.lookup`

| Test | What it used | Now |
|---|---|---|
| `tests/citations/test_roles.py::_read_by_the_lookup` | the RIS producer (`Passage`, `citation_for`, `format_passages`) to build a chat passage | the law lookup's producer, reading the at-ris record, bound as `ris_lookup`; stays in place (it tests role resolution) |
| `tests/common/test_citation_pipeline_contract.py` (`RIS_PASSAGES`, `read_ris_both_ways`) | the same producer, to read one block off the records and off the text | the law lookup's producer, as above; stays in place (it tests the citation seam) |
| `tests/testing/agent_testing/law_lookup_parity.py::run_ris_lookup` and `test_law_lookup_parity.py` | the RIS tool itself, as the parity bar | goes with the RIS tool in the deletion PR: `golden.json` keeps what it returned, and the `law_lookup` runners keep comparing against it |
| `ris_adapter_testing/lookup.py`, `ris-adapter/tests/conftest.py` | the fixtures above | nothing: they only served the suites ported here |

`tests/common/test_grounding_block.py` names `ris_adapter.lookup.render` only as
where its checked-in fixture once came from; it runs nothing of it.

## Differences found

1. **A `law_lookup` result had no text parser.** The RIS tool's format test read
   its output through the citation reader with no capture, which is the text
   parser registered for `ris_lookup`. Bound under its own name (`law_lookup`,
   the config default and the name step 4b renames the model tool to), the
   lookup's text fell to the non-URL fallback: one source called `law_lookup`, no
   citation key, no Punkt. A replayed turn would lose every law citation. Live
   turns read the records and were unaffected. Fixed in
   `agent/citations/text_parsers.py` (register `"law_lookup" in name` with
   `parse_knowledge_layer`); `test_a_replayed_turn_reads_the_same_sources_off_the_text`
   and `test_the_knowledge_parser_reads_it_as_evidence` fail without it.

No other assertion needed weakening, and no test is `xfail`.

## Observed, not changed

Each is the same in the RIS tool (so no ported assertion moved), and each is a
place the lookup is still not country-neutral:

1. **The tool description is the fallback record's.** `law_lookup` builds its
   description from `LawLookupToolConfig.source` at bind time (`tool.py`,
   `describe(fallback)`), so a turn that reads XA's released record is offered a
   description naming RIS, the Bundesland and Austrian examples. The ported
   `as_of` test pins the description to the bound record, as today.
2. **A law passage's lane is `building_law_ris`, "Rechtsquelle (RIS)", for any
   source.** The lane fan-out (`knowledge_layer.search.trace_lanes_for_chunks`,
   through `agent.common.norm_registry`'s lane table) keys a `doc_class: law`
   hit to the RIS lane whatever its collection (`xa/National` included). The ported
   format test asserts the kind (`building_law`) only, and
   `test_a_law_hit_s_lane_is_not_named_for_another_country_s_source` pins the leak
   (`xfail(strict=True)`): it fails loudly the day the lane comes from the record.
3. **A heading a blank line above its provision is not read as its heading.** A
   page with one `<p>` per line converts to text with blank lines between, and
   `sections.split_sections` then finds no heading for `§ 63.`; the parity
   golden's indexes list bare `§ 60`, `§ 63` for that reason, in both tools. Real
   RIS pages state the heading in a block after the marker, which the grammar
   reads (`test_the_header_block_before_each_section_is_folded_into_it`).
4. **`MAX_DOCUMENTS` is never the bound that binds.** `MAX_FETCHES` is 2 and
   passages come only from fetched documents, so the document cap (also 2) is
   never reached; `test_passages_come_from_at_most_two_documents` passes with it
   raised, as the RIS tool's test did. Either cap is redundant while both are 2.
5. **Two lists still name the old tool only.** `common/backend_tools.py` and
   `agents/intake/lookups.py` list `ris_lookup_tool`; the rename (#1643) names
   the tool `law_lookup` in both.
