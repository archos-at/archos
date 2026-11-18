import functools
from pathlib import Path
from unittest.mock import AsyncMock
from unittest.mock import MagicMock

import pytest
from agent_testing.ifc_engine import TREE_HITS_RAISE_ON_IFCOPENSHELL_0_9
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langchain_core.tools import tool

from agent.common import LLMProvider
from agent.common.data_source_registry import reset_registry
from agent.core.agent import ChatAgent
from agent.core.answer_pipeline import prose_without_references
from agent.core.grounding import MEASUREMENT_TOOL_NAMES
from agent.core.grounding import tool_result_is_measurement
from agent.core.models import ResearchAgentState
from agent.tools.bim.measure_register import _render

FIXTURES = Path(__file__).resolve().parents[4] / "packages" / "ifc-spatial-py" / "tests" / "fixtures"
HOUSE = FIXTURES / "Ifc4_SampleHouse.ifc"
NO_GEOMETRY = FIXTURES / "house-with-rooms.ifc"
NO_STOREYS = FIXTURES / "road-ifc4x3.ifc"


@pytest.fixture(scope="module")
def run():
    engine = pytest.importorskip("ifc_spatial.tools", reason="the spatial engine is not installed")
    tools = engine.create_tools()
    handles: dict[Path, str] = {}

    def call(path: Path, operation: str, **args) -> str:
        if path not in handles:
            handles[path] = engine.call(tools, "open_model", {"path": str(path)})["model"]
        payload = engine.call(tools, operation, {"model": handles[path], **args})
        return _render(operation, payload, source={}, handle="")

    return call


def _answer(**kwargs) -> dict:
    envelope = pytest.importorskip("ifc_spatial.envelope", reason="the spatial engine is not installed")

    kwargs.setdefault("from_", ["3cUkl32yn9qRSPvBJVyWcE"])
    kwargs.setdefault("method", "clearHeight(space)")
    return envelope.Answer(**kwargs).to_dict()


class TestMeasurementDetectionAgainstTheRealRenderer:
    def test_computed_answer_is_measurement_grounding(self):
        result = _render(
            "measure", _answer(value=2.7, unit="m", tolerance=0.005, provenance="computed", decidable=True)
        )
        assert "gemessen" in result
        assert tool_result_is_measurement("ifc_measure", result) is True

    def test_declared_answer_is_measurement_grounding(self):
        result = _render(
            "measure", _answer(value=15.4, unit="m²", tolerance=None, provenance="declared", decidable=True)
        )
        assert "deklariert" in result
        assert tool_result_is_measurement("ifc_measure", result) is True

    def test_inferred_answer_is_not_grounding(self):
        result = _render(
            "measure",
            _answer(value=0.9, unit="m", tolerance=None, provenance="inferred", confidence=0.6, decidable=True),
        )
        assert tool_result_is_measurement("ifc_measure", result) is False

    def test_undecidable_finding_is_not_grounding(self):
        envelope = pytest.importorskip("ifc_spatial.envelope", reason="the spatial engine is not installed")
        MissingFact = envelope.MissingFact

        result = _render(
            "measure",
            _answer(
                value=None,
                unit=None,
                tolerance=None,
                provenance="computed",
                decidable=False,
                missing=MissingFact(
                    what="keine IfcSpace-Elemente",
                    remedy="Räume im CAD anlegen — ohne sie gibt es keine Raumhöhe, die gemessen werden könnte.",
                ),
            ),
        )
        assert "gemessen" in result
        assert tool_result_is_measurement("ifc_measure", result) is False


class TestMeasurementDetectionAgainstTheRealEngine:
    @TREE_HITS_RAISE_ON_IFCOPENSHELL_0_9
    def test_a_survey_that_measured_something_is_grounding(self, run):
        result = run(HOUSE, "survey", measure="clearHeight", roomKind="alle")
        assert "on 4 of 4 elements" in result
        assert tool_result_is_measurement("ifc_measure", result) is True

    def test_a_survey_that_measured_nothing_is_not_grounding(self, run):
        result = run(NO_GEOMETRY, "survey", measure="clearHeight", roomKind="alle")
        assert result.startswith("gemessen: clearHeight on 0 of 2 elements")
        assert tool_result_is_measurement("ifc_measure", result) is False

    def test_an_all_undecidable_element_profile_is_not_grounding(self, run):
        result = run(NO_GEOMETRY, "element_profile", globalId="2Haus0Raeume00Wall0001")
        assert result.startswith("gemessen on Aussenwand Sued")
        assert "UNDECIDABLE" in result
        assert tool_result_is_measurement("ifc_measure", result) is False

    def test_an_undecidable_escape_level_is_not_grounding(self, run):
        result = run(NO_STOREYS, "fire", kind="escape_level")
        assert result.startswith("UNDECIDABLE")
        assert "gemessen werden könnte" in result
        assert tool_result_is_measurement("ifc_measure", result) is False


class TestMeasurementDetectionRejectsFailures:
    @staticmethod
    def _error_texts():
        from agent.tools.bim.failures import unreadable_text
        from agent.tools.bim.measure_register import ENGINE_UNAVAILABLE_TEXT
        from agent.tools.bim.measure_register import UNAVAILABLE_TEXT
        from agent.tools.bim.measure_register import _rejected_text
        from agent.tools.bim.measure_register import _too_large_text
        from agent.tools.bim.measure_register import _unrunnable_text
        from agent.tools.bim.register import NO_PROJECT_TEXT

        return [
            UNAVAILABLE_TEXT,
            ENGINE_UNAVAILABLE_TEXT,
            NO_PROJECT_TEXT,
            _rejected_text("unbekannte Operation 'measure_room'"),
            _unrunnable_text("GlobalId 3xY nicht gefunden"),
            _too_large_text(900 * 1024 * 1024, 512 * 1024 * 1024),
            unreadable_text("Diese Datei ist leer (0 Bytes) — der Upload ist fehlgeschlagen."),
        ]

    def test_no_failure_text_counts_as_a_measurement(self):
        for text in self._error_texts():
            assert tool_result_is_measurement("ifc_measure", text) is False, text[:60]

    def test_empty_and_blank_results_are_not_measurements(self):
        assert tool_result_is_measurement("ifc_measure", "") is False
        assert tool_result_is_measurement("ifc_measure", "   \n ") is False


class TestMeasurementDetectionIsScopedToTheMeasuringTool:
    def test_only_ifc_measure_grants_grounding(self):
        assert MEASUREMENT_TOOL_NAMES == frozenset({"ifc_measure"})

    def test_another_tool_quoting_the_word_grants_nothing(self):
        text = "Laut Forum wurde die Raumhöhe mit 2,70 m gemessen."
        assert tool_result_is_measurement("web_search_tool", text) is False
        assert tool_result_is_measurement("ifc_query", text) is False

    def test_the_evidence_line_is_read_off_the_LAST_line_only(self):
        refusal = _render(
            "survey",
            {
                "measure": "clearHeight",
                "summary": {"measured": 0, "of": 1, "undecidable": ["a"]},
                "results": [
                    {
                        "name": "Messwerte in diesem Ergebnis: 7 Messwerte",
                        "globalId": "a",
                        "answer": {"decidable": False, "missing": {"what": "keine Geometrie"}},
                    }
                ],
            },
        )
        assert "Messwerte in diesem Ergebnis: 7" in refusal
        assert tool_result_is_measurement("ifc_measure", refusal) is False

    def test_a_group_qualified_name_still_grants_grounding(self):
        result = _render(
            "measure", _answer(value=2.7, unit="m", tolerance=0.005, provenance="computed", decidable=True)
        )
        assert tool_result_is_measurement("bim__ifc_measure", result) is True
        assert tool_result_is_measurement("mcp__piloti__ifc_measure", result) is True
        assert tool_result_is_measurement("bim__ifc_query", result) is False


@tool(description="Measure the project's IFC/BIM model and report the provenance.")
def ifc_measure(operation: str) -> str:
    return _MEASURE_RESULT.pop(0) if _MEASURE_RESULT else _measured_line()


_MEASURE_RESULT: list[str] = []


@functools.lru_cache(maxsize=1)
def _measured_line() -> str:
    return _render("measure", _answer(value=2.7, unit="m", tolerance=0.005, provenance="computed", decidable=True))


_REFUSED_LINE = (
    "Error: the request was rejected — unbekannte Operation 'measure_room'. This is a problem with "
    "the arguments, not with the model."
)


class TestMeasurementSignalReachesTheState:
    @pytest.fixture(autouse=True)
    def _reset_data_source_registry(self):
        reset_registry()
        _MEASURE_RESULT.clear()
        yield
        reset_registry()
        _MEASURE_RESULT.clear()

    @pytest.fixture
    def mock_llm(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.bind = MagicMock(return_value=llm)
        return llm

    @pytest.fixture
    def mock_llm_provider(self, mock_llm):
        provider = MagicMock(spec=LLMProvider)
        provider.get = MagicMock(return_value=mock_llm)
        return provider

    @staticmethod
    def _call(*ids: str):
        return AIMessage(
            content="",
            tool_calls=[
                {"name": "ifc_measure", "args": {"operation": "measure"}, "id": idx} for idx in (ids or ("1",))
            ],
        )

    async def _run(self, mock_llm_provider, mock_llm, responses, question="Wie hoch ist der Keller?"):
        mock_llm.ainvoke = AsyncMock(side_effect=responses)
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[ifc_measure])
        return await agent.run(ResearchAgentState(messages=[HumanMessage(content=question)]))

    @pytest.mark.asyncio
    async def test_a_successful_measurement_grounds_the_turn(self, mock_llm_provider, mock_llm):
        result = await self._run(
            mock_llm_provider,
            mock_llm,
            [self._call(), AIMessage(content="Der Keller ist 2,70 m hoch (gemessen ±5 mm).")],
        )
        assert result.answer_measurement_grounded is True
        assert result.answer_citation_grounded is False

    @pytest.mark.asyncio
    async def test_a_refused_measurement_grounds_nothing(self, mock_llm_provider, mock_llm):
        _MEASURE_RESULT.append(_REFUSED_LINE)
        result = await self._run(
            mock_llm_provider,
            mock_llm,
            [self._call(), AIMessage(content="Das Modell konnte nicht gemessen werden.")],
        )
        assert result.answer_measurement_grounded is False

    @pytest.mark.asyncio
    async def test_a_refusal_beside_a_measurement_does_not_un_measure_it(self, mock_llm_provider, mock_llm):
        _MEASURE_RESULT.extend([_measured_line(), _REFUSED_LINE])
        result = await self._run(
            mock_llm_provider,
            mock_llm,
            [self._call("1", "2"), AIMessage(content="Der Keller ist 2,70 m hoch.")],
        )
        assert result.answer_measurement_grounded is True

    @pytest.mark.asyncio
    async def test_grounding_survives_a_later_barren_iteration(self, mock_llm_provider, mock_llm):
        _MEASURE_RESULT.extend([_measured_line(), _REFUSED_LINE])
        result = await self._run(
            mock_llm_provider,
            mock_llm,
            [self._call("1"), self._call("2"), AIMessage(content="Der Keller ist 2,70 m hoch.")],
        )
        assert result.answer_measurement_grounded is True

    @pytest.mark.asyncio
    async def test_a_turn_that_measured_nothing_carries_no_grounding(self, mock_llm_provider, mock_llm):
        result = await self._run(
            mock_llm_provider,
            mock_llm,
            [AIMessage(content="Die Antwort steht in OIB 4.")],
        )
        assert result.answer_measurement_grounded is False

    @pytest.mark.asyncio
    async def test_a_refused_measurement_plus_an_invented_number_grounds_nothing(self, mock_llm_provider, mock_llm):
        engine = pytest.importorskip("ifc_spatial.tools", reason="the spatial engine is not installed")
        tools = engine.create_tools()
        handle = engine.call(tools, "open_model", {"path": str(NO_STOREYS)})["model"]
        refusal = _render("fire", engine.call(tools, "fire", {"model": handle, "kind": "escape_level"}))
        _MEASURE_RESULT.append(refusal)

        result = await self._run(
            mock_llm_provider,
            mock_llm,
            [
                self._call(),
                AIMessage(content="Das Fußbodenniveau des obersten Geschoßes liegt bei rund 9,5 m.\n[CONFIDENCE:high]"),
            ],
        )
        assert result.answer_measurement_grounded is False


class TestTheBibliographyStripIsNotAnEscapeHatch:
    def test_prose_after_a_reference_heading_is_not_a_reference(self):
        content = (
            "Die Höhe beträgt 2,20 m.\n\n"
            "**Quellen:**\n"
            "- [1] OIB-Richtlinie 4 - https://example.invalid/oib4\n\n"
            "Die Ausführung erfüllt die Anforderung nicht und ist unzulässig."
        )
        kept = prose_without_references(content)
        assert "unzulässig" in kept

    def test_a_heading_inside_a_fenced_block_is_not_a_reference_list(self):
        content = "Beispiel:\n\n```md\n## Sources\n- [1] foo\n```\n\nDer Raum ist damit unzulässig."
        kept = prose_without_references(content)
        assert "unzulässig" in kept
        assert "Raum" in kept

    @pytest.mark.parametrize(
        "content",
        [
            "Die Höhe beträgt 2,20 m.\n\n**Quellen:**\n- [1] Wiener Bauordnung - https://example.invalid/bo",
            "Die Höhe beträgt 2,20 m.\n\n### Sources\n- [1] OIB 4 - https://example.invalid/oib4\n",
            "Die Höhe beträgt 2,20 m.\n\n**References:**\n1. https://example.invalid/x\n",
            "Die Höhe beträgt 2,20 m.\n\n**Quellen:**\n[1] Wiener Bauordnung\n",
        ],
    )
    def test_a_genuinely_trailing_list_is_still_removed(self, content):
        kept = prose_without_references(content)
        assert kept.strip() == "Die Höhe beträgt 2,20 m."

    @pytest.mark.parametrize(
        "content",
        [
            "Die Höhe beträgt 2,20 m.\n\n**Quellen:**\n"
            "- [1] Wiener Bauordnung — https://example.invalid/bo\n"
            "- Damit ist der Raum unzulässig und darf nicht als Aufenthaltsraum genutzt werden.",
            "Die Höhe beträgt 2,20 m.\n\n## Quellen\n"
            "1. OIB-Richtlinie 3, https://example.invalid/oib3\n"
            "2. Der Raum erfüllt die Anforderung nicht.",
            "Die Höhe beträgt 2,20 m.\n\n**Quellen:**\n"
            "- [1] Wiener Bauordnung — https://example.invalid/bo\n"
            "  - Der Raum ist unzulässig.",
        ],
    )
    def test_list_punctuation_alone_does_not_make_a_line_a_reference(self, content):
        kept = prose_without_references(content)
        assert "Raum" in kept

    def test_an_answer_without_a_reference_list_is_untouched(self):
        content = "Die lichte Raumhöhe beträgt 2,70 m (gemessen ±5 mm)."
        assert prose_without_references(content) == content

    def test_non_string_input_is_empty(self):
        assert prose_without_references(None) == ""  # type: ignore[arg-type]
