from __future__ import annotations

import random
from pathlib import Path

PdfLine = tuple[str, float, str]

_PAGE_TOP = 800.0
_LEFT = 50.0
_LEADING = 1.45


def _escape(text: str) -> bytes:
    raw = text.encode("cp1252")
    return raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def _content(lines: list[PdfLine]) -> bytes:
    out = bytearray()
    y = _PAGE_TOP
    for font, size, text in lines:
        y -= size * _LEADING
        out += f"BT /F{font} {size} Tf {_LEFT} {y:.1f} Td (".encode("ascii") + _escape(text) + b") Tj ET\n"
    return bytes(out)


def build_pdf(pages: list[list[PdfLine]]) -> bytes:
    count = len(pages)
    fonts = "<< /FR 3 0 R /FB 4 0 R >>"
    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        (
            "<< /Type /Pages /Kids [" + " ".join(f"{5 + 2 * i} 0 R" for i in range(count)) + f"] /Count {count} >>"
        ).encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ]
    for index, lines in enumerate(pages):
        content = _content(lines)
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font {fonts} >> "
                f"/Contents {6 + 2 * index} 0 R >>"
            ).encode()
        )
        objects.append(b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream")
    return _xref_pdf(objects)


def _xref_pdf(objects: list[bytes]) -> bytes:
    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    return bytes(out)


def body_lines(tag: str, count: int) -> list[PdfLine]:
    return [
        ("R", 10, f"Satz {tag}-{n:02d}: Die Anforderungen an Bauteile sind gemäß Tabelle einzuhalten.")
        for n in range(1, count + 1)
    ]


def footer(page: int) -> PdfLine:
    return ("R", 8, f"Brandschutzkonzept Musterstraße, Seite {page}")


def fire_safety_concept_pages() -> list[list[PdfLine]]:
    page_one = [
        ("B", 18, "Brandschutzkonzept Wohnanlage Musterstraße"),
        ("R", 10, "Projekt Wohnanlage Musterstraße 12, 1010 Wien, Fassung vom 3. März 2026."),
        ("B", 14, "1 Allgemeines"),
        *body_lines("1", 4),
        ("B", 12, "1.1 Gebäudebeschreibung"),
        *body_lines("1.1a", 30),
        footer(1),
    ]
    page_two = [
        *body_lines("1.1b", 10),
        ("B", 12, "1.2 Rechtsgrundlagen"),
        ("R", 10, "Maßgeblich ist die OIB-Richtlinie 2, Ausgabe Mai 2023, für Brandabschnitte bis"),
        ("R", 10, "1.200 m² Netto-Grundfläche je Geschoß und die Wiener Bauordnung in geltender Fassung."),
        *body_lines("1.2", 6),
        ("B", 14, "2 Brandabschnitte"),
        *body_lines("2", 5),
        footer(2),
    ]
    page_three = [
        ("B", 10, "2.1 Brandabschnittsbildende Wände"),
        *body_lines("2.1", 12),
        ("B", 10, "§ 3"),
        ("B", 10, "Fluchtwege"),
        *body_lines("3", 6),
        footer(3),
    ]
    return [page_one, page_two, page_three]


def write_pdf(path: Path, pages: list[list[PdfLine]]) -> Path:
    path.write_bytes(build_pdf(pages))
    return path



PLAN_SET_RASTER_PX: tuple[int, int] = (3000, 2200)

PLAN_SET_UNDERSIZED_PX: tuple[int, int] = (40, 40)

PLAN_SET_SMALL_RASTER_PX: tuple[int, int] = (400, 300)

_PLAN_SET_SEED = 20261018


def _noise_jpeg(width: int, height: int, seed: int) -> bytes:
    import io

    from PIL import Image

    pixels = random.Random(seed).randbytes(width * height * 3)
    buffer = io.BytesIO()
    Image.frombytes("RGB", (width, height), pixels).save(buffer, format="JPEG", quality=90)
    return buffer.getvalue()


def plan_set_page_rasters(
    *,
    raster_pages: int = 8,
    rasters_per_page: int = 2,
    raster_px: tuple[int, int] = PLAN_SET_RASTER_PX,
    small_raster_pages: int = 0,
    include_undersized_raster: bool = False,
) -> list[list[tuple[int, int]]]:
    pages = [[raster_px] * rasters_per_page for _ in range(raster_pages)]
    pages += [[PLAN_SET_SMALL_RASTER_PX] for _ in range(small_raster_pages)]
    if include_undersized_raster:
        pages.insert(0, [PLAN_SET_UNDERSIZED_PX])
    return pages


def build_plan_set_pdf(
    *,
    raster_pages: int = 8,
    rasters_per_page: int = 2,
    text_pages: int = 3,
    raster_px: tuple[int, int] = PLAN_SET_RASTER_PX,
    small_raster_pages: int = 0,
    include_undersized_raster: bool = False,
    seed: int = _PLAN_SET_SEED,
) -> bytes:
    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"PLACEHOLDER_PAGES",  # object 2, filled in below once the page numbers are known
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ]
    fonts = "<< /FR 3 0 R /FB 4 0 R >>"
    kids: list[int] = []
    raster_index = 0

    pages = plan_set_page_rasters(
        raster_pages=raster_pages,
        rasters_per_page=rasters_per_page,
        raster_px=raster_px,
        small_raster_pages=small_raster_pages,
        include_undersized_raster=include_undersized_raster,
    )
    for page_rasters in pages:
        xobjects: dict[str, int] = {}
        drawing = bytearray()
        for width, height in page_rasters:
            jpeg = _noise_jpeg(width, height, seed + raster_index)
            raster_index += 1
            name = f"Im{len(objects) + 1}"
            image_number = len(objects) + 1
            objects.append(
                (
                    f"<< /Type /XObject /Subtype /Image /Width {width} /Height {height} "
                    f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {len(jpeg)} >>\n"
                    "stream\n"
                ).encode()
                + jpeg
                + b"\nendstream"
            )
            xobjects[name] = image_number
            drawing += f"q {width} 0 0 {height} 0 40 cm /{name} Do Q\n".encode()
        content = bytes(drawing)
        content_number = len(objects) + 1
        objects.append(b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream")
        page_number = len(objects) + 1
        xobject_dict = " ".join(f"/{name} {number} 0 R" for name, number in xobjects.items())
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
                f"/Resources << /Font {fonts} /XObject << {xobject_dict} >> >> "
                f"/Contents {content_number} 0 R >>"
            ).encode()
        )
        kids.append(page_number)

    for page in range(1, text_pages + 1):
        content = _content(
            [
                ("B", 14, f"Blatt {page}: Übersichtsplan Musterstraße"),
                *body_lines(f"P{page}", 8),
                footer(page),
            ]
        )
        content_number = len(objects) + 1
        objects.append(b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream")
        page_number = len(objects) + 1
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
                f"/Resources << /Font {fonts} >> /Contents {content_number} 0 R >>"
            ).encode()
        )
        kids.append(page_number)

    objects[1] = f"<< /Type /Pages /Kids [{' '.join(f'{kid} 0 R' for kid in kids)}] /Count {len(kids)} >>".encode()
    return _xref_pdf(objects)


def build_drawing_sheets_pdf(sheets: int, paths_per_sheet: int, *, seed: int = 7) -> bytes:
    rng = random.Random(seed)
    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]
    kids: list[int] = []
    for sheet in range(1, sheets + 1):
        ops = bytearray(b"0.2 w\n")
        for _ in range(paths_per_sheet):
            x, y = rng.uniform(20, 1170), rng.uniform(60, 820)
            ops += f"{x:.1f} {y:.1f} m {x + rng.uniform(-40, 40):.1f} {y + rng.uniform(-40, 40):.1f} l S\n".encode()
        ops += f"BT /FR 10 Tf 900 40 Td (Plan {sheet} Grundriss EG M 1:100) Tj ET\n".encode()
        objects.append(b"<< /Length " + str(len(ops)).encode() + b" >>\nstream\n" + bytes(ops) + b"\nendstream")
        content = len(objects)
        objects.append(
            (
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1190 842] "
                f"/Resources << /Font << /FR 3 0 R >> >> /Contents {content} 0 R >>"
            ).encode()
        )
        kids.append(len(objects))
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(f'{kid} 0 R' for kid in kids)}] /Count {len(kids)} >>".encode()
    return _xref_pdf(objects)


def write_plan_set(path: Path, **kwargs: object) -> Path:
    path.write_bytes(build_plan_set_pdf(**kwargs))  # type: ignore[arg-type]
    return path


if __name__ == "__main__":  # pragma: no cover - a shell entry point, not a test path
    import argparse

    parser = argparse.ArgumentParser(description="Write a fixture PDF to a path.")
    parser.add_argument("path", type=Path)
    parser.add_argument("--plan-set", action="store_true", help="a heavy plan set, not the text report")
    parser.add_argument("--raster-pages", type=int, default=8)
    parser.add_argument("--rasters-per-page", type=int, default=2)
    parser.add_argument("--text-pages", type=int, default=3)
    parser.add_argument("--width", type=int, default=PLAN_SET_RASTER_PX[0])
    parser.add_argument("--height", type=int, default=PLAN_SET_RASTER_PX[1])
    parser.add_argument("--undersized-raster", action="store_true")
    parser.add_argument("--small-raster-pages", type=int, default=0)
    parser.add_argument("--seed", type=int, default=_PLAN_SET_SEED)
    args = parser.parse_args()
    if args.plan_set:
        target = write_plan_set(
            args.path,
            raster_pages=args.raster_pages,
            rasters_per_page=args.rasters_per_page,
            text_pages=args.text_pages,
            raster_px=(args.width, args.height),
            small_raster_pages=args.small_raster_pages,
            include_undersized_raster=args.undersized_raster,
            seed=args.seed,
        )
    else:
        target = write_pdf(args.path, fire_safety_concept_pages())
    print(f"{target} - {target.stat().st_size / 1e6:.1f} MB on disk")
