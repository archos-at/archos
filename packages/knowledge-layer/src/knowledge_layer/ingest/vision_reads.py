import base64
import hashlib
import logging
from typing import Any

from . import vision_credentials
from .vision_calls import _vlm_chat_create
from .vision_calls import _vlm_client
from .vision_credentials import DEFAULT_VLM_BASE_URL
from .vision_credentials import DEFAULT_VLM_MODEL

logger = logging.getLogger(__name__)

CHART_AWARE_IMAGE_PROMPT = """Analyze this image and respond in the following format:

TYPE: [chart/graph/image]

If this is a chart or graph, extract:
- Chart type (bar, line, pie, scatter, etc.)
- Title and axis labels
- Key data points and values
- Main trends or insights

If this is a regular image (e.g. a plan, map or architectural drawing), describe its CONTENT and meaning:
- Main subject and what the image actually depicts
- Key elements and their spatial / architectural relationships
- Only textual labels that belong to the content (e.g. titles, room names, dimensions)

Do NOT include any licence, watermark or tool-stamp text (e.g. "VECTORWORKS EDUCATIONAL VERSION",
"AutoCAD", "DRAFT") in your description; ignore such overlays entirely and describe only the actual
content and its meaning, not merely what is visible.

Provide a detailed, structured response."""

PLAIN_IMAGE_PROMPT = (
    "Describe this image in detail, focusing on the CONTENT and meaning of what is depicted "
    "(the main subject, its elements, and any spatial or architectural information) rather than "
    "merely listing what is visible. Do NOT include any licence, watermark or tool-stamp text "
    '(e.g. "VECTORWORKS EDUCATIONAL VERSION", "AutoCAD", "DRAFT") in your description; ignore '
    "such overlays entirely."
)

CHART_INDICATORS = (
    "type: chart",
    "type: graph",
    "bar chart",
    "line chart",
    "pie chart",
    "scatter plot",
    "histogram",
    "chart type:",
    "this chart",
    "this graph",
    "the chart",
    "the graph",
)

DRAWING_ANALYSIS_MAX_TOKENS = 6000


def _image_message(prompt: str, image_bytes: bytes) -> list[dict[str, Any]]:
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    return [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
            ],
        }
    ]


def _caption_content_type(caption: str, *, extract_charts: bool) -> str:
    if not extract_charts:
        return "image"
    caption_lower = caption.lower()
    return "chart" if any(indicator in caption_lower for indicator in CHART_INDICATORS) else "image"


def _analyze_image_with_vlm(
    image_bytes: bytes,
    vlm_model: str = DEFAULT_VLM_MODEL,
    vlm_base_url: str = DEFAULT_VLM_BASE_URL,
    extract_charts: bool = True,
    vlm_api_key: str | None = None,
) -> tuple[str, str]:
    try:
        import openai  # noqa: F401 - availability check; the client comes from _vlm_client
    except ImportError:
        logger.warning("openai package not installed. Install with: pip install openai")
        return ("image", "[Image - captioning unavailable]")

    api_key = vlm_api_key if vlm_api_key is not None else vision_credentials._get_vlm_api_key()
    if not api_key:
        return ("image", "[Image - VLM API key not set]")

    prompt = CHART_AWARE_IMAGE_PROMPT if extract_charts else PLAIN_IMAGE_PROMPT

    try:
        messages = _image_message(prompt, image_bytes)
        client = _vlm_client(vlm_base_url, api_key)
        caption = _vlm_chat_create(
            client,
            model=vlm_model,
            messages=messages,
            max_tokens=512,
            prompt_id=f"image:charts={extract_charts}",
        )
        logger.debug(f"VLM analysis: {caption[:100]}...")
        return (_caption_content_type(caption, extract_charts=extract_charts), caption)

    except Exception as e:
        logger.error(f"VLM analysis failed: {e}")
        return ("image", f"[Image - analysis failed: {str(e)[:50]}]")


_DRAWING_FIELD_MAP = {
    "zeichnungstyp": "drawing_type",
    "massstab": "scale",
    "maßstab": "scale",
    "titel/projekt": "title",
    "geschosse/ebenen": "levels",
    "nutzung": "use",
    "räume/elemente": "elements",
    "materialien/bauweise": "materials",
    "abmessungen/koten": "dimensions",
    "räumliche beziehungen": "spatial_relations",
    "detailbeschreibung": "detail",
    "wasserzeichen": "watermark",
    "zusammenfassung": "summary",
}


def _parse_drawing_fields(caption: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in (caption or "").splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        slug = _DRAWING_FIELD_MAP.get(key.strip().lower())
        if slug and value.strip():
            out[slug] = value.strip()
    return out


def _analyze_drawing_page_with_vlm(
    image_bytes: bytes,
    vlm_model: str = DEFAULT_VLM_MODEL,
    vlm_base_url: str = DEFAULT_VLM_BASE_URL,
    vlm_api_key: str | None = None,
    context: str | None = None,
) -> tuple[str, dict[str, Any]]:
    from knowledge_layer.ingest import visual_analysis
    from knowledge_layer.ingest import visual_domains
    from knowledge_layer.ingest import visual_prompt

    registry = visual_domains.resolve_registry()

    try:
        import openai  # noqa: F401 - availability check; the client comes from _vlm_client
    except ImportError:
        logger.warning("openai package not installed. Install with: pip install openai")
        return ("[Drawing - captioning unavailable]", {})

    api_key = vlm_api_key if vlm_api_key is not None else vision_credentials._get_vlm_api_key()
    if not api_key:
        return ("[Drawing - VLM API key not set]", {})

    try:
        messages = _image_message(visual_prompt.build_prompt(registry, context=context), image_bytes)
        client = _vlm_client(vlm_base_url, api_key)
        reply = _vlm_chat_create(
            client,
            model=vlm_model,
            messages=messages,
            max_tokens=DRAWING_ANALYSIS_MAX_TOKENS,
            prompt_id=visual_analysis.cache_prompt_type(registry),
        ).strip()
        if not reply:
            return ("[Drawing - empty VLM response]", {})
        logger.debug("Drawing VLM analysis: %s...", reply[:100])
        return _drawing_reading(reply, registry)
    except Exception as e:
        logger.error("Drawing VLM analysis failed: %s", e)
        return (f"[Drawing - analysis failed: {str(e)[:50]}]", {})


def _drawing_reading(reply: str, registry: Any) -> tuple[str, dict[str, Any]]:
    from knowledge_layer.ingest import visual_analysis
    from knowledge_layer.ingest import visual_rendering

    analysis = visual_analysis.parse_visual_analysis(reply, registry)
    if analysis is None:
        return (reply, _parse_drawing_fields(reply))
    fields: dict[str, Any] = visual_rendering.legacy_fields(analysis)
    fields["analysis"] = analysis
    return (visual_rendering.render_analysis_text(analysis), fields)


def analyze_visual(
    image_bytes: bytes,
    vlm_model: str = DEFAULT_VLM_MODEL,
    vlm_base_url: str = DEFAULT_VLM_BASE_URL,
    vlm_api_key: str | None = None,
    extract_charts: bool = True,
    context: str | None = None,
) -> tuple[str, str, dict[str, Any]]:
    from knowledge_layer.ingest import processing as _processing
    from knowledge_layer.ingest import visual_analysis
    from knowledge_layer.ingest import visual_domains

    context_key = f":ctx={hashlib.sha256(context.encode('utf-8')).hexdigest()[:16]}" if context else ""
    caption, fields = _processing._cached_vlm_call(
        image_bytes,
        visual_analysis.cache_prompt_type(visual_domains.resolve_registry()) + context_key,
        _analyze_drawing_page_with_vlm,
        image_bytes,
        vlm_model=vlm_model,
        vlm_base_url=vlm_base_url,
        vlm_api_key=vlm_api_key,
        model=vlm_model,
        **({"context": context} if context else {}),
    )
    fields = fields if isinstance(fields, dict) else {}

    if not _processing.is_failed_caption(caption):
        analysis = fields.get("analysis")
        if analysis:
            return (visual_analysis.content_type_for(analysis), caption, fields)
        if fields:
            return ("drawing", caption, fields)

    logger.info("Structured visual analysis unusable; falling back to the caption prompt")
    content_type, legacy_caption = _processing._cached_vlm_call(
        image_bytes,
        f"image:charts={extract_charts}",
        _analyze_image_with_vlm,
        image_bytes,
        vlm_model=vlm_model,
        vlm_base_url=vlm_base_url,
        vlm_api_key=vlm_api_key,
        extract_charts=extract_charts,
        model=vlm_model,
    )
    return (content_type, legacy_caption, {})
