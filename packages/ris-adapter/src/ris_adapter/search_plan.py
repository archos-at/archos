from typing import Literal

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

from ris_adapter import descriptions


class RisSearchPlan(BaseModel):
    model_config = ConfigDict(json_schema_extra={"description": descriptions.SEARCH_PLAN_DESCRIPTION})

    application: Literal[
        "BrKons",
        "LrKons",
        "BgblAuth",
        "LgblAuth",
        "Begut",
        "RegV",
        "Vfgh",
        "Vwgh",
        "Justiz",
        "Bvwg",
        "Lvwg",
        "Dsk",
        "Erlaesse",
    ] = Field(description="RIS application to search")
    suchworte: str = Field(description="German full-text search terms (precise legal terminology)")
    titel: str = Field(default="", description="Optional filter on the norm/decision title, empty if unused")
    federal_state: Literal[
        "",
        "Burgenland",
        "Kärnten",
        "Niederösterreich",
        "Oberösterreich",
        "Salzburg",
        "Steiermark",
        "Tirol",
        "Vorarlberg",
        "Wien",
    ] = Field(default="", description="State filter for Landesrecht searches, empty if not state-specific")
    date_from: str = Field(default="", description="YYYY-MM-DD or empty")
    date_to: str = Field(default="", description="YYYY-MM-DD or empty")
    reasoning: str = Field(default="", description="One short sentence: why this application and these terms")
