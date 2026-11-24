def _looks_like_pdf(file_path: str) -> bool:
    try:
        with open(file_path, "rb") as handle:
            return handle.read(5) == b"%PDF-"
    except OSError:
        return False


def _looks_like_image(file_path: str) -> str | None:
    try:
        with open(file_path, "rb") as handle:
            header = handle.read(12)
    except OSError:
        return None
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if header.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "webp"
    return None


def _looks_like_raw_pdf_or_binary(text: str) -> bool:
    sample = text[:4096]
    if sample.lstrip().startswith("%PDF"):
        return True
    if "endobj" in sample and "xref" in sample:
        return True
    if "\x00" in sample:
        return True
    if not sample:
        return False

    control_count = sum(1 for ch in sample if ord(ch) < 32 and ch not in "\n\r\t")
    return control_count / len(sample) > 0.05
