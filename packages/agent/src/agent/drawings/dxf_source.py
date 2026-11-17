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

CADASTRE_EPSG_BY_MERIDIAN: dict[int, int] = {28: 31254, 31: 31255, 34: 31256}

_CADASTRE_LAYERS = frozenset({"GG", "GN"})

_TAX_CADASTRE_NUMBER_BLOCKS = frozenset({"GN1", "GNP", "RN1"})

_PARCEL_NUMBER_BLOCKS = _TAX_CADASTRE_NUMBER_BLOCKS | {"GN1G", "GNPG"}


class UnreadableDrawingError(ValueError):
    ...


@dataclass(frozen=True)
class CadastreFacts:

    epsg: int | None
    meridian: int | None
    cadastral_communities: tuple[str, ...]
    parcel_numbers: tuple[str, ...]
    has_tax_cadastre_parcels: bool


@dataclass(frozen=True)
class DxfSource:

    doc: Drawing
    metres_per_unit: float | None
    cadastre: CadastreFacts | None
    standin_blocks: tuple[str, ...]


def read_dxf(data: bytes) -> DxfSource:
    doc = _read_document(data)
    define_missing_styles(doc)
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
    used = {entity.dxf.name for entity in doc.entitydb.values() if entity.dxftype() == "INSERT"}
    missing = sorted(name for name in used if name not in doc.blocks)
    for name in missing:
        doc.blocks.new(name=name)
    return tuple(missing)


_STANDIN_LINETYPES: dict[str, list[float]] = {
    "DOT": [0.8, 0.0, -0.8],
    "UGROUND": [2.0, 1.4, -0.6],
}
_STANDIN_DASHED = [2.0, 1.4, -0.6]


def define_missing_styles(doc: Drawing) -> None:
    styles, linetypes = set(), set()
    for entity in doc.entitydb.values():
        if entity.dxf.hasattr("style"):
            styles.add(entity.dxf.style)
        if entity.dxf.hasattr("linetype"):
            linetypes.add(entity.dxf.linetype)
    for name in sorted(styles):
        if name and not doc.styles.has_entry(name):
            doc.styles.add(name, font="DejaVuSans.ttf")
    for name in sorted(linetypes):
        if name and name.upper() not in {"BYLAYER", "BYBLOCK", "CONTINUOUS"} and not doc.linetypes.has_entry(name):
            doc.linetypes.add(name, pattern=_STANDIN_LINETYPES.get(name.upper(), _STANDIN_DASHED))


def _metres_per_unit(doc: Drawing) -> float | None:
    try:
        code = int(doc.header.get("$INSUNITS", 0))
    except TypeError, ValueError:
        return None
    return METRES_PER_INSUNIT.get(code)


def cadastre_facts(doc: Drawing) -> CadastreFacts | None:
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
    for insert in doc.modelspace().query("INSERT"):
        if insert.dxf.name.upper() != "MBNR" or not insert.attribs:
            continue
        fields = insert.attribs[0].dxf.tag.split("*")
        if len(fields) > 1 and fields[1].strip().isdigit():
            meridian = int(fields[1].strip())
            if meridian in CADASTRE_EPSG_BY_MERIDIAN:
                return meridian
    return None
