"""A DXF drawing as something to reason about, not only to look at (ADR-0152, ADR-0153).

``dxf_source`` reads the bytes without losing what they say and recognises a
Katastralmappe; ``parcels`` rebuilds its parcels from the boundary network;
``site`` turns both into a site the agent can ask about (areas, neighbours,
buildings, setbacks, what is buildable), each answer with how it was obtained.
The PDF rendition (``agent_host.drawings``) and the ``dxf_measure`` tool
(``agent.tools.drawings``) read the same model, so the page a person sees and the
numbers the agent quotes cannot disagree.

The ``sheet_*`` modules measure on a vector PDF sheet (ADR-0182): ``sheet_types``
are the values the reader's output becomes, ``sheet_scale`` says what scale
holds at a point and what stands behind it, ``sheet_probe`` finds the span or
the corner the engine ties a point to, ``sheet_measure`` joins the two into an
answer, and ``sheet_answers`` is that answer: a number with its interval and
provenance, or no number and why.
"""
