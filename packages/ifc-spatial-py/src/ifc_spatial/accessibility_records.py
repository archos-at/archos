from __future__ import annotations

from typing import Any

import numpy as np


class _FreeFloor:
    __slots__ = ("footprint", "fixed", "furnished", "floor_z", "obstacles", "triangles")

    def __init__(self, footprint: Any, floor_z: float) -> None:
        self.footprint = footprint
        self.fixed = footprint
        self.furnished = footprint
        self.floor_z = floor_z
        self.obstacles: list[dict[str, Any]] = []
        self.triangles = 0


class _Frame:
    __slots__ = (
        "normal",
        "lateral",
        "u_min",
        "u_max",
        "v_min",
        "v_max",
        "z_min",
        "z_max",
        "host_min",
        "host_max",
    )

    def __init__(self, normal: np.ndarray, lateral: np.ndarray) -> None:
        self.normal = normal
        self.lateral = lateral
        self.host_min: float | None = None
        self.host_max: float | None = None

    def point(self, u: float, v: float) -> np.ndarray:
        return self.lateral * u + self.normal * v

    @property
    def u_centre(self) -> float:
        return (self.u_min + self.u_max) / 2.0

    def outer_face(self, sign: float) -> float:
        own = self.v_max if sign > 0 else self.v_min
        host = self.host_max if sign > 0 else self.host_min
        if host is None:
            return own
        return max(own, host) if sign > 0 else min(own, host)
