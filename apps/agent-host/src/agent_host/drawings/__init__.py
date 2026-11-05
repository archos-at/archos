"""DXF files drawn to their PDF rendition (ADR-0152).

A DXF has no viewer in a browser. Like an office file (ADR-0070) it is shown,
indexed and cited through a PDF the product makes from it, stored beside the
original as ``_render.pdf`` by the BFF. This package is the converter the BFF
calls for it. The drawing is read by ``agent.drawings`` (shared with the
``dxf_measure`` tool, so the page and the agent read one model);
``sheet`` picks a paper and a standard scale, ``dxf_pdf`` draws the page.
"""
