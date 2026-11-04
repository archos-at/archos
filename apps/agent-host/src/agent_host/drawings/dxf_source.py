"""Reading a DXF file without losing what it says (ADR-0152).

## Why the reader defines blocks the file does not

BEV, Austria's cadastre authority, delivers the Katastralmappe in two DXF forms.
The "BEV-DXF+CSV" one is a partial AutoCAD R12 file: a minimal header and the
entities, with no BLOCKS section. Its parcel numbers, boundary points and
land-use symbols are INSERTs of blocks the file never defines; the receiving
system is expected to hold BEV's symbol library already (BEV, Katastralmappe
DXF, Schnittstellenbeschreibung v2.6, §1). ezdxf's audit, and its ``recover``
reader which audits, DELETE every INSERT whose block is missing. Measured on a
file shaped like BEV's: every parcel number gone, silently, and the page still
looks like a drawing. So the plain reader runs first, an empty stand-in block is
defined for every missing name, and only then does anything audit. An INSERT's
attributes are entities of their own, so the parcel numbers draw from a stand-in;
the symbols' own strokes do not, until BEV's library ships with this module.

## What a Katastralmappe tells us about itself

Recognised by its layer scheme (``GG`` parcel boundaries, ``GN`` parcel numbers,
``RL`` sheet markers). Its coordinates are metres in MGI / Austria Gauß-Krüger,
in the meridian strip the sheet marker ``MBNR`` names in its attribute tag
(``scale*meridian*…``), with the 5,000,000 of the northing dropped (§2, §3.1),
which is exactly EPSG 31254/31255/31256. A parcel number is ``GN1G``/``GNPG`` in
the Grenzkataster and ``GN1``/``GNP`` in the Grundsteuerkataster, whose
boundaries are digitised from paper and legally not binding (§3.3, p. 12).
"""

from __future__ import annotations

import logging
import os
import tempfile
from dataclasses import dataclass

import ezdxf
from ezdxf import recover
from ezdxf.document import Drawing
from ezdxf.entities import Insert

logger = logging.getLogger(__name__)

#: ``$INSUNITS`` to metres per drawing unit. 0 (unitless) is absent on purpose:
#: a drawing that names no unit has no scale, and guessing one prints a wrong
#: one with a straight face.
METRES_PER_INSUNIT: dict[int, float] = {
    1: 0.0254,  # inches
    2: 0.3048,  # feet
    4: 0.001,  # millimetres
    5: 0.01,  # centimetres
    6: 1.0,  # metres
    7: 1000.0,  # kilometres
    10: 0.9144,  # yards
    14: 0.1,  # decimetres
}

#: Meridian strip (degrees east of Ferro) to the EPSG code of its Greenwich-based
#: Gauß-Krüger zone, as BEV's spec lists them (§2).
CADASTRE_EPSG_BY_MERIDIAN: dict[int, int] = {28: 31254, 31: 31255, 34: 31256}

#: Layers only a Katastralmappe uses together.
_CADASTRE_LAYERS = frozenset({"GG", "GN"})

#: Parcel-number blocks of the Grundsteuerkataster (no ``G`` suffix).
_TAX_CADASTRE_NUMBER_BLOCKS = frozenset({"GN1", "GNP", "RN1"})

#: Parcel-number blocks of either cadastre, on the layers that name an area.
_PARCEL_NUMBER_BLOCKS = _TAX_CADASTRE_NUMBER_BLOCKS | {"GN1G", "GNPG"}


class UnreadableDrawingError(ValueError):
    """The bytes are not a DXF file ezdxf can read, even in recovery."""


@dataclass(frozen=True)
class CadastreFacts:
    """What a Katastralmappe says about where it is and what it is worth."""

    epsg: int | None
    meridian: int | None
    cadastral_communities: tuple[str, ...]
    parcel_numbers: tuple[str, ...]
    has_tax_cadastre_parcels: bool


@dataclass(frozen=True)
class DxfSource:
    """A read drawing and the facts the page is laid out from."""

    doc: Drawing
    #: ``None`` when the file names no unit: the page is then not to scale.
    metres_per_unit: float | None
    cadastre: CadastreFacts | None
    #: Block names the file used and did not define (see the module docstring).
    standin_blocks: tuple[str, ...]


def read_dxf(data: bytes) -> DxfSource:
    """Read DXF bytes, keep every INSERT, and say what the drawing is."""
    doc = _read_document(data)
    standins = define_missing_blocks(doc)
    if standins:
        logger.info("dxf: %d block(s) used but not defined, drawn as stand-ins", len(standins))
    cadastre = cadastre_facts(doc)
    return DxfSource(
        doc=doc,
        metres_per_unit=1.0 if cadastre else _metres_per_unit(doc),
        cadastre=cadastre,
        standin_blocks=standins,
    )


def _read_document(data: bytes) -> Drawing:
    """The plain reader first (it does not audit), ``recover`` for a damaged file.

    ezdxf reads from a path: it sniffs binary DXF and the text encoding there.
    """
    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as handle:
        handle.write(data)
        path = handle.name
    try:
        try:
            return ezdxf.readfile(path)
        except (ezdxf.DXFError, UnicodeDecodeError, ValueError, OSError) as plain_error:
            logger.info("dxf: plain read failed (%s), trying recovery", type(plain_error).__name__)
        try:
            doc, _auditor = recover.readfile(path)
            return doc
        except (ezdxf.DXFError, UnicodeDecodeError, ValueError, OSError) as error:
            raise UnreadableDrawingError("Not a readable DXF file") from error
    finally:
        os.unlink(path)


def define_missing_blocks(doc: Drawing) -> tuple[str, ...]:
    """Define an empty block for every INSERT name the file uses and lacks."""
    used = {entity.dxf.name for entity in doc.entitydb.values() if entity.dxftype() == "INSERT"}
    missing = sorted(name for name in used if name not in doc.blocks)
    for name in missing:
        doc.blocks.new(name=name)
    return tuple(missing)


def _metres_per_unit(doc: Drawing) -> float | None:
    try:
        code = int(doc.header.get("$INSUNITS", 0))
    except TypeError, ValueError:
        return None
    return METRES_PER_INSUNIT.get(code)


def cadastre_facts(doc: Drawing) -> CadastreFacts | None:
    """The Katastralmappe's own statements, or ``None`` for any other drawing."""
    msp = doc.modelspace()
    layers = {entity.dxf.layer.upper() for entity in msp}
    if not _CADASTRE_LAYERS <= layers:
        return None
    meridian = _sheet_meridian(doc)
    numbers: list[str] = []
    communities: set[str] = set()
    tax_cadastre = False
    for insert in msp.query("INSERT"):
        name = insert.dxf.name.upper()
        if name == "KGN":
            communities.update(_attribute_values(insert))
        if name not in _PARCEL_NUMBER_BLOCKS or not insert.attribs:
            continue
        first = insert.attribs[0]
        numbers.append(first.dxf.text.strip())
        community = first.dxf.tag.strip().split("*", 1)[0]
        if community.isdigit():
            communities.add(community)
        tax_cadastre = tax_cadastre or name in _TAX_CADASTRE_NUMBER_BLOCKS
    return CadastreFacts(
        epsg=CADASTRE_EPSG_BY_MERIDIAN.get(meridian) if meridian is not None else None,
        meridian=meridian,
        cadastral_communities=tuple(sorted(communities)),
        parcel_numbers=tuple(dict.fromkeys(number for number in numbers if number)),
        has_tax_cadastre_parcels=tax_cadastre,
    )


def _attribute_values(insert: Insert) -> list[str]:
    return [attrib.dxf.text.strip() for attrib in insert.attribs if attrib.dxf.text.strip()]


def _sheet_meridian(doc: Drawing) -> int | None:
    """The meridian strip from the first ``MBNR`` sheet marker: ``scale*meridian*…``."""
    for insert in doc.modelspace().query("INSERT"):
        if insert.dxf.name.upper() != "MBNR" or not insert.attribs:
            continue
        fields = insert.attribs[0].dxf.tag.split("*")
        if len(fields) > 1 and fields[1].strip().isdigit():
            meridian = int(fields[1].strip())
            if meridian in CADASTRE_EPSG_BY_MERIDIAN:
                return meridian
    return None
