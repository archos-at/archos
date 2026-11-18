from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from typing import Literal

Provenance = Literal["declared", "computed", "inferred"]


@dataclass(frozen=True)
class MissingFact:
    what: str
    remedy: str
    elements: list[str] | None = None


@dataclass
class Answer[T]:
    value: T | None
    unit: str | None
    tolerance: float | None
    provenance: Provenance
    from_: list[str]
    method: str
    decidable: bool
    missing: MissingFact | None = None
    confidence: float | None = None
    because: list[str] | None = None
    caveat: str | None = None
    agreement: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "value": self.value,
            "unit": self.unit,
            "tolerance": self.tolerance,
            "provenance": self.provenance,
            "from": list(self.from_),
            "method": self.method,
            "decidable": self.decidable,
        }
        if self.missing is not None:
            missing: dict[str, Any] = {"what": self.missing.what, "remedy": self.missing.remedy}
            if self.missing.elements is not None:
                missing["elements"] = list(self.missing.elements)
            out["missing"] = missing
        if self.confidence is not None:
            out["confidence"] = self.confidence
        if self.because is not None:
            out["because"] = list(self.because)
        if self.caveat is not None:
            out["caveat"] = self.caveat
        if self.agreement is not None:
            out["agreement"] = self.agreement
        return out


def declared[T](
    value: T,
    *,
    from_: list[str],
    method: str,
    unit: str | None = None,
    caveat: str | None = None,
) -> Answer[T]:
    return Answer(
        value=value,
        unit=unit,
        tolerance=None,
        provenance="declared",
        from_=list(from_),
        method=method,
        decidable=True,
        caveat=caveat,
    )


def computed[T](
    value: T,
    *,
    from_: list[str],
    method: str,
    unit: str | None = None,
    tolerance: float | None = None,
    caveat: str | None = None,
) -> Answer[T]:
    return Answer(
        value=value,
        unit=unit,
        tolerance=tolerance,
        provenance="computed",
        from_=list(from_),
        method=method,
        decidable=True,
        caveat=caveat,
    )


def inferred[T](
    value: T,
    *,
    from_: list[str],
    method: str,
    confidence: float,
    because: list[str],
    unit: str | None = None,
    caveat: str | None = None,
) -> Answer[T]:
    return Answer(
        value=value,
        unit=unit,
        tolerance=None,
        provenance="inferred",
        from_=list(from_),
        method=method,
        decidable=True,
        confidence=confidence,
        because=list(because),
        caveat=caveat,
    )


def undecidable(
    *,
    from_: list[str],
    method: str,
    missing: MissingFact,
    provenance: Provenance = "declared",
) -> Answer[Any]:
    return Answer(
        value=None,
        unit=None,
        tolerance=None,
        provenance=provenance,
        from_=list(from_),
        method=method,
        decidable=False,
        missing=missing,
    )


def triangulate(
    a: Answer[float],
    b: Answer[float],
    *,
    method: str = "triangulate",
    relative_tolerance: float = 0.02,
) -> Answer[float]:
    both = a.decidable and b.decidable and isinstance(a.value, (int, float)) and isinstance(b.value, (int, float))

    if not both:
        present = a if a.decidable else (b if b.decidable else None)
        if present is None:
            out = undecidable(
                from_=[*a.from_, *b.from_],
                method=method,
                missing=a.missing
                or b.missing
                or MissingFact(what="both routes", remedy="no route to this value in this file"),
            )
            out.agreement = "single"
            return out
        out = _copy(present)
        out.method = method
        out.agreement = "single"
        return out

    av = float(a.value)  # type: ignore[arg-type]
    bv = float(b.value)  # type: ignore[arg-type]
    scale = max(abs(av), abs(bv), 2.220446049250313e-16)
    delta = abs(av - bv) / scale

    winner = a if delta <= relative_tolerance else (a if a.provenance == "computed" else b)

    out = _copy(winner)
    out.method = method
    out.from_ = list(dict.fromkeys([*a.from_, *b.from_]))
    out.agreement = "agree" if delta <= relative_tolerance else "disagree"
    if delta > relative_tolerance:
        verdict = (
            f"Zwei Wege zu dieser Zahl widersprechen sich: {_fmt(av)} ({a.provenance}) gegen "
            f"{_fmt(bv)} ({b.provenance}), Abweichung {delta * 100:.1f} %. "
            "Das ist ein Befund über den Export, nicht über das Gebäude."
        )
    else:
        declared_side = "declared" in (a.provenance, b.provenance)
        verdict = (
            f"Zwei unabhängige Wege bestätigen diese Zahl: {_fmt(av)} ({a.provenance}) und "
            f"{_fmt(bv)} ({b.provenance}), Abweichung {delta * 100:.1f} %. "
            + (
                "Die Datei DEKLARIERT diesen Wert und die Geometrie bestätigt ihn — das ist belastbarer "
                "als jeder der beiden Wege allein."
                if declared_side
                else "Beide Wege führen zum selben Ergebnis."
            )
        )
    out.caveat = f"{out.caveat} {verdict}" if out.caveat else verdict
    return out


def _copy[T](answer: Answer[T]) -> Answer[T]:
    return Answer(
        value=answer.value,
        unit=answer.unit,
        tolerance=answer.tolerance,
        provenance=answer.provenance,
        from_=list(answer.from_),
        method=answer.method,
        decidable=answer.decidable,
        missing=answer.missing,
        confidence=answer.confidence,
        because=list(answer.because) if answer.because is not None else None,
        caveat=answer.caveat,
        agreement=answer.agreement,
    )


def _fmt(n: float) -> str:
    if float(n).is_integer():
        return str(int(n))
    return f"{n:.3f}".rstrip("0").rstrip(".")


@dataclass(frozen=True)
class ElementRef:
    global_id: str
    ifc_type: str
    name: str | None
    kind: str
    via: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out = {
            "globalId": self.global_id,
            "ifcType": self.ifc_type,
            "name": self.name,
            "kind": self.kind,
        }
        if self.via:
            out["via"] = self.via
        return out


__all__ = [
    "Answer",
    "ElementRef",
    "MissingFact",
    "Provenance",
    "computed",
    "declared",
    "inferred",
    "triangulate",
    "undecidable",
]
