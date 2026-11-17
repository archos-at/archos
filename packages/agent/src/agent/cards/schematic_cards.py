"""The schematic cards and the sub-structures they share.

Sections, stairs, dimensions, setbacks, egress, daylight, guardrails and fire access.
"""

from typing import Literal

from pydantic import ConfigDict
from pydantic import Field
from pydantic import model_validator

from agent.cards.card_model import CardModel

DimStatus = Literal["pass", "fail", "warning", "needs_input"]


Provenance = Literal["declared", "computed", "inferred"]


class NormReference(CardModel):
    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "A verifiable pointer into a regulation (the atom of grounding).\n"
                "\n"
                "Every required value MUST carry one so the architect can verify it against\n"
                "the source. Never fabricate a reference."
            )
        }
    )

    document: str = Field(min_length=1, description="Regulation name, e.g. 'OIB-Richtlinie 2', 'ÖNORM B 1600'")
    section: str | None = Field(default=None, description="Clause/table, e.g. 'Pkt. 5.1.1', 'Tabelle 1b'")
    edition: str | None = Field(default=None, description="Edition/year, e.g. 'Ausgabe Mai 2023'")
    excerpt: str | None = Field(default=None, description="Literal quoted sentence grounding the value (<= ~200 chars)")


class DimensionCheck(CardModel):
    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "One measured dimension drawn on a schematic and checked against a limit.\n"
                "\n"
                "`value` is the project's actual measurement (drawn to scale); `required` is\n"
                "the OIB limit. If `value` is unknown, leave it null and set status\n"
                "'needs_input'.\n"
                "\n"
                "## Why a number here carries where it came from\n"
                "\n"
                "This block used to be `label / value / required / unit / comparator /\n"
                "status` and nothing else, and that made the card the least honest surface in\n"
                "the product. `ifc_measure` answers „gemessen: 2.47 m (±5 mm) — aus der\n"
                "Geometrie berechnet, nicht deklariert“, the assistant repeats that in the\n"
                "prose, and the card beside it drew **2.47 m ✓** — indistinguishable from a\n"
                "figure the architect had stated in their own file. The card is the part a\n"
                "reviewer screenshots into a submission, so the surface that dropped the\n"
                "qualifier was the surface most likely to be forwarded without it.\n"
                "\n"
                "Three fields close that, and all three are OPTIONAL: a card built from the\n"
                "Bestimmung alone (a limit with no model behind it) has nothing to put in\n"
                'them, and a null here means "not stated", never "declared".'
            )
        }
    )

    label: str = Field(min_length=1, description="What is measured, e.g. 'lichte Durchgangsbreite'")
    value: float | None = Field(default=None, description="Actual measurement (drawn); null if unknown")
    required: float | None = Field(default=None, description="OIB limit for this dimension")
    unit: str = Field(default="cm", description="Unit for both value and required, e.g. 'cm', 'm', '%'")
    comparator: Literal["<=", ">="] | None = Field(default=None, description="How actual must relate to required")
    status: DimStatus = Field(description="Verdict for this dimension")
    provenance: Provenance | None = Field(
        default=None,
        description=(
            "Where `value` came from, copied from the ifc_measure answer's own provenance: 'declared' "
            "(the IFC file states it), 'computed' (we measured it off the geometry), 'inferred' (a "
            "heuristic, offered for confirmation). Leave null when the number did not come from the "
            "model at all — a figure the user typed, or one taken from the Bestimmung. NEVER guess it: "
            "labelling our own measurement 'declared' turns our tolerance into the architect's claim."
        ),
    )
    tolerance: float | None = Field(
        default=None,
        ge=0,
        description=(
            "The ± band on `value`, in the SAME unit — copied from the ifc_measure answer. Only "
            "meaningful with provenance 'computed': a declared figure is the file's statement and has "
            "no band of ours. A measured dimension without its band reads as exact, and the band is "
            "what decides whether 2.49 m clears a 2.50 m minimum."
        ),
    )
    missing: str | None = Field(
        default=None,
        description=(
            "With status 'needs_input': what the export does not provide and WHAT TO CHANGE IN THE CAD "
            "to make it answerable — copied verbatim from the ifc_measure answer's missing.remedy. This "
            "is the sentence the architect acts on, and a card that shows an empty slot instead of it "
            "turns a finding about the export into a blank the reader reads as a fact about the building."
        ),
    )


class SectionStorey(CardModel):
    model_config = ConfigDict(
        json_schema_extra={"description": "One storey in a building cross-section, drawn as a band to scale."}
    )

    label: str = Field(min_length=1, description="Storey label, e.g. 'EG', '1.OG', 'KG'")
    height_m: float = Field(gt=0, description="Clear storey height in metres (drawn to scale)")
    below_grade: bool = Field(default=False, description="True for basements/underground storeys")


class SectionMarker(CardModel):
    model_config = ConfigDict(
        json_schema_extra={"description": "A horizontal reference line at a given height in the section."}
    )

    label: str = Field(min_length=1, description="What the line marks, e.g. 'Fluchtniveau', 'GK4-Grenze'")
    height_m: float = Field(description="Height above ground datum in metres")
    kind: Literal["escape_level", "threshold", "reference"] = Field(default="reference", description="Styling role")


class SetbackSide(CardModel):
    model_config = ConfigDict(
        json_schema_extra={"description": "A required distance from the building footprint to one parcel edge."}
    )

    side: Literal["front", "back", "left", "right"] = Field(description="Which edge")
    required_m: float = Field(description="Required setback in metres (OIB/Bauordnung)")
    actual_m: float | None = Field(default=None, description="Actual distance in metres; null if unknown")
    status: DimStatus = Field(description="Verdict for this side")


class EgressSegment(CardModel):
    model_config = ConfigDict(
        json_schema_extra={"description": "One straight run of an escape path, drawn end-to-end with the next."}
    )

    label: str = Field(min_length=1, description="Segment label, e.g. 'Raum → Gang', 'Gang → Treppenhaus'")
    length_m: float = Field(gt=0, description="Run length in metres (drawn to scale)")
    turn: Literal["straight", "left", "right"] = Field(default="straight", description="Turn AFTER this run")


class BuildingSectionCard(CardModel):
    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "A to-scale building cross-section (schematic) drawn from storey heights.\n"
                "\n"
                "Emit for height/Gebäudeklasse/Fluchtniveau questions where seeing the\n"
                "building against threshold lines helps (e.g. 'am I below the GK4 limit with\n"
                "a Fluchtniveau of 9.8 m?'). Draws stacked storeys, the ground line, and\n"
                "dashed marker lines (Fluchtniveau, GK/Hochhaus limits) with labels."
            )
        }
    )

    type: Literal["building_section"]
    title: str = Field(min_length=1, description="Title, e.g. 'Gebäudeschnitt – Höhenprüfung'")
    storeys: list[SectionStorey] = Field(description="Storeys bottom-to-top; basements flagged below_grade")
    markers: list[SectionMarker] | None = Field(default=None, description="Reference lines: Fluchtniveau, GK/Hochhaus")
    reference: NormReference = Field(description="Source of the threshold heights")
    note: str | None = Field(default=None, description="Optional clarification")


class StairDiagramCard(CardModel):
    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "A staircase drawn to scale (schematic section) with step-geometry checks.\n"
                "\n"
                "Emit for stair questions (e.g. 'does a flight of 17 steps with 18 cm\n"
                "Steigung, 27 cm Auftritt and 100 cm width fit?'). Draws the step profile to\n"
                "scale and checks riser/going/width and the comfort rule (2×Steigung +\n"
                "Auftritt ≈ 59–65 cm) against OIB 4."
            )
        }
    )

    type: Literal["stair_diagram"]
    title: str = Field(min_length=1, description="Title, e.g. 'Treppenlauf – Steigungsverhältnis'")
    riser_count: int = Field(gt=0, description="Number of steps in the flight (drawn)")
    riser_height: DimensionCheck = Field(description="Steigung (rise) per step; typical limit <= 18 cm")
    tread_depth: DimensionCheck = Field(description="Auftritt (going) per step; typical limit >= 28 cm")
    width: DimensionCheck = Field(description="Usable flight width; limit depends on Gebäudeklasse")
    comfort_note: str | None = Field(default=None, description="Result of the 2×Steigung + Auftritt comfort check")
    reference: NormReference = Field(description="Source of the step-geometry limits")


class DimensionDiagramCard(CardModel):
    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "A parametric accessibility/geometry schematic with dimension arrows.\n"
                "\n"
                "Emit for clearance questions (door width, ramp gradient, turning circle,\n"
                "corridor width, threshold, a barrier-free lift cabin). The renderer picks a\n"
                "prebuilt template for `shape` and draws each dimension arrow where it is\n"
                "measured, coloured by status — preventing the Stocklichte-vs-Durchgangslichte\n"
                "misread. `lift_cabin` took over the cabin half of the retired\n"
                "`elevator_requirement` card: Kabinenbreite, Kabinentiefe and lichte\n"
                "Türbreite, drawn on a cabin plan."
            )
        }
    )

    type: Literal["dimension_diagram"]
    title: str = Field(min_length=1, description="Title, e.g. 'Rampe – Neigung & Breite'")
    shape: Literal["door", "ramp", "corridor", "turning_circle", "threshold", "parking_space", "lift_cabin"] = Field(
        description=(
            "Which schematic template to draw; 'lift_cabin' takes Kabinenbreite, Kabinentiefe and lichte "
            "Türbreite (cm) as its dimensions"
        )
    )
    dimensions: list[DimensionCheck] = Field(description="The measured dimensions to annotate on the schematic")
    reference: NormReference = Field(description="Source of the dimension limits (e.g. OIB 4 / ÖNORM B 1600)")
    note: str | None = Field(default=None, description="Optional clarification")


class SetbackPlanCard(CardModel):
    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "A top-down site plan (schematic): parcel, footprint, setbacks, coverage and GFZ.\n"
                "\n"
                "Emit for Abstandsflächen/Bauwich questions ('does the building keep the\n"
                "required Abstände?') and for Bebauungsdichte/Bebauungsgrad/GFZ questions.\n"
                "Draws the parcel, the required-setback envelope, and the building\n"
                "footprint, with a distance arrow per side coloured by status, and — where\n"
                "`coverage` or `density` is given — a readout of Bebauungsgrad (built area /\n"
                "parcel) and GFZ (BGF / parcel) against the Bebauungsplan's limits. The\n"
                "renderer computes the ratios from the areas; the model supplies areas and\n"
                "limits only. The readout took over the retired `density_check` card."
            )
        }
    )

    type: Literal["setback_plan"]
    title: str = Field(min_length=1, description="Title, e.g. 'Abstandsflächen – Lageplan'")
    parcel_width_m: float | None = Field(
        default=None,
        gt=0,
        description="Parcel width in metres (drawn to scale); required unless a pure density question",
    )
    parcel_depth_m: float | None = Field(
        default=None,
        gt=0,
        description="Parcel depth in metres (drawn to scale); required unless a pure density question",
    )
    building_width_m: float | None = Field(
        default=None, gt=0, description="Building footprint width in metres; required unless a pure density question"
    )
    building_depth_m: float | None = Field(
        default=None, gt=0, description="Building footprint depth in metres; required unless a pure density question"
    )
    sides: list[SetbackSide] = Field(description="Required/actual distance per parcel edge")
    parcel_area_m2: float | None = Field(
        default=None, gt=0, description="Parcel (Grundstück) area in m², where it is not the drawn rectangle"
    )
    footprint_area_m2: float | None = Field(
        default=None, gt=0, description="Built (bebaute) area in m², where it is not the drawn rectangle"
    )
    gross_floor_area_m2: float | None = Field(default=None, gt=0, description="Bruttogeschossfläche (BGF) in m²")
    coverage: DimensionCheck | None = Field(
        default=None, description="Bebauungsgrad (built/parcel) vs the limit; value null = renderer derives"
    )
    density: DimensionCheck | None = Field(
        default=None, description="GFZ (BGF/parcel) vs the limit; value null = renderer derives"
    )
    reference: NormReference = Field(description="Source of the setback requirements")

    @model_validator(mode="after")
    def _plan_or_areas(self) -> SetbackPlanCard:
        """The plan needs its four dimensions; a pure density question needs the parcel area instead.

        A Bebauungsgrad or GFZ question with no parcel geometry leaves ``sides``
        empty and gives ``parcel_area_m2``: the card draws the readout and no
        plan. Requiring the dimensions there would leave a model (or the
        repair model) only one way to pass, inventing a parcel the renderer
        then draws to scale (``_CARD_HONESTY``).
        """
        dimensions = (self.parcel_width_m, self.parcel_depth_m, self.building_width_m, self.building_depth_m)
        if all(value is not None for value in dimensions):
            return self
        if self.sides or self.parcel_area_m2 is None or (self.coverage is None and self.density is None):
            raise ValueError(
                "parcel_width_m, parcel_depth_m, building_width_m and building_depth_m are required to draw the "
                "plan; only a pure density question (no sides, parcel_area_m2 and coverage or density) may omit them"
            )
        return self

    @model_validator(mode="after")
    def _ratio_units(self) -> SetbackPlanCard:
        """A ratio's unit, when the model gave none: ``%`` for Bebauungsgrad, none for GFZ (never ``cm``)."""
        if self.coverage is not None and "unit" not in self.coverage.model_fields_set:
            self.coverage = self.coverage.model_copy(update={"unit": "%"})
        if self.density is not None and "unit" not in self.density.model_fields_set:
            self.density = self.density.model_copy(update={"unit": ""})
        return self


class EgressDiagramCard(CardModel):
    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "A schematic escape-route (Fluchtweg) path with the total length checked.\n"
                "\n"
                "Emit for escape-route-length questions ('is a Fluchtweg of 12 m + 26 m\n"
                "permitted?'). Draws the path segment-by-segment from the worst-case point to\n"
                "the exit and checks the total against the OIB 2 limit (typically 40 m)."
            )
        }
    )

    type: Literal["egress_diagram"]
    title: str = Field(min_length=1, description="Title, e.g. 'Fluchtweg – Gehweglänge'")
    segments: list[EgressSegment] = Field(description="Path runs from the worst-case point to the exit, in order")
    total_length: DimensionCheck = Field(description="Sum of segment lengths vs the OIB limit (e.g. <= 40 m)")
    start_label: str | None = Field(default="ungünstigster Punkt", description="Label for the path start")
    exit_label: str | None = Field(default="Treppenhaus", description="Label for the path end/exit")
    reference: NormReference = Field(description="Source of the escape-length limit (OIB 2)")


class Obstruction(CardModel):
    model_config = ConfigDict(
        json_schema_extra={"description": "An object blocking daylight (opposing building, own projection)."}
    )

    distance_m: float = Field(gt=0, description="Horizontal distance from the window in metres")
    height_m: float = Field(description="Height of the obstruction above the window sill in metres")
    label: str = Field(min_length=1, description="What it is, e.g. 'Gegenüberliegendes Gebäude'")


class DaylightIncidenceCard(CardModel):
    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "A daylight (Belichtung) schematic: the 45° free-light line vs obstructions.\n"
                "\n"
                "Emit for daylight/Belichtung questions (OIB 3). Draws a window section, the\n"
                "45° free-light-incidence line from the window's lower edge, any obstruction,\n"
                "and a glass-area-vs-floor-area check. The renderer does the 45° geometry —\n"
                "the model supplies distances/heights only."
            )
        }
    )

    type: Literal["daylight_incidence"]
    title: str = Field(min_length=1, description="Title, e.g. 'Belichtung – freier Lichteinfall'")
    room_floor_area_m2: float | None = Field(default=None, description="Aufenthaltsraum floor area in m²")
    glass_area: DimensionCheck = Field(description="Lichteintrittsfläche (m²) vs the ≥10% requirement")
    window_sill_height_m: float | None = Field(default=None, description="Sill (Parapet) height in metres")
    window_head_height_m: float | None = Field(default=None, description="Window head (Sturz) height in metres")
    obstruction: Obstruction | None = Field(default=None, description="Any object intruding into the 45° light cone")
    reference: NormReference = Field(description="Source of the daylight requirement (OIB 3)")
    note: str | None = Field(default=None, description="Optional clarification")


class GuardrailCheckCard(CardModel):
    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "An Absturzsicherung (guardrail) elevation with the interacting limits.\n"
                "\n"
                "Emit for guardrail/railing questions (OIB 4). Draws the railing to scale and\n"
                "checks height (>=100 cm, >=110 cm where Absturzhöhe > 12 m), max opening\n"
                "(<=12 cm cube), bottom gap, and shades the no-climb zone."
            )
        }
    )

    type: Literal["guardrail_check"]
    title: str = Field(min_length=1, description="Title, e.g. 'Absturzsicherung Dachterrasse'")
    context: Literal["balcony", "loggia", "staircase", "window", "roof_terrace"] = Field(description="Railing location")
    fall_height: DimensionCheck = Field(description="Absturzhöhe (m) — decides which height limit applies")
    rail_height: DimensionCheck = Field(description="Geländerhöhe (cm) vs the required minimum")
    max_opening: DimensionCheck = Field(description="Largest opening (cm) vs the <=12 cm cube rule")
    bottom_gap: DimensionCheck | None = Field(default=None, description="Gap at the base (cm)")
    has_horizontal_elements_in_climb_zone: bool | None = Field(default=None, description="Climbable horizontals?")
    reference: NormReference = Field(description="Source of the guardrail limits (OIB 4)")
    note: str | None = Field(default=None, description="Optional clarification")


class StagingAreaPlan(CardModel):
    model_config = ConfigDict(json_schema_extra={"description": "The fire-brigade Aufstellfläche geometry."})

    width: DimensionCheck = Field(description="Aufstellfläche width (m)")
    length: DimensionCheck = Field(description="Aufstellfläche length (m)")
    distance_to_facade: DimensionCheck | None = Field(default=None, description="Distance to the facade (m)")


class FireAccessPlanCard(CardModel):
    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "A fire-brigade access (Feuerwehrzufahrt) site plan schematic.\n"
                "\n"
                "Emit for fire-access questions (OIB 2 / TRVB). Top-down plan: access route\n"
                "from the road, the Aufstellfläche beside the facade, and the reach distance\n"
                "from the Aufstellfläche to the farthest necessary entrance (typically\n"
                "<=80 m). Numeric minimums vary by Land — always corpus-grounded per check."
            )
        }
    )

    type: Literal["fire_access_plan"]
    title: str = Field(min_length=1, description="Title, e.g. 'Feuerwehrzufahrt & Aufstellfläche'")
    parcel_width_m: float = Field(gt=0, description="Parcel width in metres")
    parcel_depth_m: float = Field(gt=0, description="Parcel depth in metres")
    building_width_m: float = Field(gt=0, description="Building footprint width in metres")
    building_depth_m: float = Field(gt=0, description="Building footprint depth in metres")
    route_width: DimensionCheck = Field(description="Zufahrt clear width (m) vs the minimum")
    gate_clearance_height: DimensionCheck | None = Field(default=None, description="Durchfahrt clear height (m)")
    staging_area: StagingAreaPlan = Field(description="The fire-brigade standing-area geometry")
    walk_distance_to_entrance: DimensionCheck = Field(description="Reach to farthest entrance (m), e.g. <=80")
    building_class: str | None = Field(default=None, description="The building's Gebäudeklasse (drives the limit)")
    reference: NormReference = Field(description="Source of the access requirements (OIB 2 / TRVB)")
    note: str | None = Field(default=None, description="Optional clarification")
