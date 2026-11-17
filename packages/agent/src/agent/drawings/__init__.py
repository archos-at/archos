"""A DXF drawing as something to reason about, not only to look at (ADR-0152, ADR-0153).

``dxf_source`` reads the bytes without losing what they say and recognises a
Katastralmappe; ``parcels`` rebuilds its parcels from the boundary network;
``site`` turns both into a site the agent can ask about (areas, neighbours,
buildings, setbacks, what is buildable), each answer with how it was obtained.
The PDF rendition (``agent_host.drawings``) and the ``dxf_measure`` tool
(``agent.tools.drawings``) read the same model, so the page a person sees and the
numbers the agent quotes cannot disagree.
"""
