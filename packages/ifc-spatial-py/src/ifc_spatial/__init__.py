"""``ifc-spatial`` on IfcOpenShell — the one IFC engine (ADR-0045).

It began as a port of a TypeScript engine (``packages/ifc-spatial``, deleted
2026-11-04 once this package served every operator and the parity table held;
the docstrings that say "a port of" name that history). Its reference numbers
stay in ``tests/test_parity.py``.

What had to survive the port was not the geometry — it is
:mod:`ifc_spatial.envelope`: ``declared`` / ``computed`` / ``inferred`` /
``undecidable``, a tolerance and a method on every measurement, a German
``missing.what`` and ``remedy`` on every refusal, and an exception — never an
undecidable — for a GlobalId this file does not contain.
"""

from .envelope import Answer
from .envelope import ElementRef
from .envelope import MissingFact
from .envelope import Provenance
from .envelope import computed
from .envelope import declared
from .envelope import inferred
from .envelope import triangulate
from .envelope import undecidable
from .model import ElementGeometry
from .model import SpatialModel
from .model import Storey
from .model import UnknownElementError

__all__ = [
    "Answer",
    "ElementGeometry",
    "ElementRef",
    "MissingFact",
    "Provenance",
    "SpatialModel",
    "Storey",
    "UnknownElementError",
    "computed",
    "declared",
    "inferred",
    "triangulate",
    "undecidable",
]
