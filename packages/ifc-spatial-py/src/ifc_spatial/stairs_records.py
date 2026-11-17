from __future__ import annotations

from dataclasses import dataclass

import numpy as np



@dataclass(frozen=True)
class _Tread:

    z: float
    area: float
    centre: np.ndarray
    span: tuple[float, float, float, float]


@dataclass(frozen=True)
class _Flight:

    global_id: str
    treads: list[_Tread]
    risers: list[float]
    base_riser_used: bool
    goings: list[float]
    clear_width: float
    total_going: float
    total_rise: float
    along: np.ndarray
    across: np.ndarray
    nosings: np.ndarray
    landing_below: bool = False
    landing_above: bool = False


@dataclass(frozen=True)
class _Body:

    flights: list[_Flight]
    landings: int
    refusals: list[str]
    levels: int




@dataclass(frozen=True)
class _Running:

    global_id: str
    normal: np.ndarray
    rise: float
    run: float
    width: float
    uphill: np.ndarray | None
    corners: np.ndarray




@dataclass(frozen=True)
class _Rake:

    global_id: str
    corners: np.ndarray
    normal: np.ndarray
    pitch: np.ndarray
    length: float
    width: float
