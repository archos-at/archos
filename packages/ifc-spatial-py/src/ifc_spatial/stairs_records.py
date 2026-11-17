"""The frozen records a stair is read into: treads, flights, bodies, running surfaces and rakes."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np



@dataclass(frozen=True)
class _Tread:
    """One horizontal step surface, as the mesh shows it."""

    z: float
    area: float
    centre: np.ndarray
    span: tuple[float, float, float, float]


@dataclass(frozen=True)
class _Flight:
    """Everything one flight's solid says about its steps.

    One flight, not one body: a body that runs up, turns at a landing and runs
    up again holds three of these. See :func:`_read_body`.
    """

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
    """What one solid holds: its flights, its landings, and what it refused.

    ``refusals`` is the part of the body the reader would not turn into numbers,
    in German and with the measurement that decided it. It is not an error
    channel — a body can yield two good flights and one refusal — and it is what
    the operators put in front of the reader instead of a number they made up.
    """

    flights: list[_Flight]
    landings: int
    refusals: list[str]
    levels: int




@dataclass(frozen=True)
class _Running:
    """A ramp flight's running surface: the dominant up-facing planar cluster."""

    global_id: str
    normal: np.ndarray
    rise: float
    run: float
    width: float
    uphill: np.ndarray | None
    corners: np.ndarray




@dataclass(frozen=True)
class _Rake:
    """The walking plane of one flight, as a rectangle with a normal."""

    global_id: str
    corners: np.ndarray
    normal: np.ndarray
    pitch: np.ndarray
    length: float
    width: float
