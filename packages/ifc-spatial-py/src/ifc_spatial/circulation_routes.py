from __future__ import annotations

import heapq
import math

from .circulation_records import DoorEdge
from .circulation_records import DoorGraph

_Search = tuple[dict[str, tuple[float, int]], dict[str, tuple[str, DoorEdge]]]


def _search(graph: DoorGraph, start: str, unweighted: bool = False) -> _Search:
    edges = graph.edges if unweighted else [edge for edge in graph.edges if edge.length is not None]
    adjacency: dict[str, list[tuple[str, DoorEdge]]] = {}
    for edge in edges:
        adjacency.setdefault(edge.a, []).append((edge.b, edge))
        adjacency.setdefault(edge.b, []).append((edge.a, edge))

    best: dict[str, tuple[float, int]] = {start: (0.0, 0)}
    came: dict[str, tuple[str, DoorEdge]] = {}
    queue: list[tuple[float, int, str]] = [(0.0, 0, start)]
    while queue:
        cost, hops, node = heapq.heappop(queue)
        if (cost, hops) > best.get(node, (math.inf, 0)):
            continue
        _relax(adjacency, node, cost, hops, unweighted, best, came, queue)
    return best, came


def _relax(
    adjacency: dict[str, list[tuple[str, DoorEdge]]],
    node: str,
    cost: float,
    hops: int,
    unweighted: bool,
    best: dict[str, tuple[float, int]],
    came: dict[str, tuple[str, DoorEdge]],
    queue: list[tuple[float, int, str]],
) -> None:
    for other, edge in sorted(adjacency.get(node, []), key=lambda pair: pair[0]):
        step = 1.0 if unweighted else float(edge.length or 0.0)
        candidate = (cost + step, hops + 1)
        if candidate < best.get(other, (math.inf, 0)):
            best[other] = candidate
            came[other] = (node, edge)
            heapq.heappush(queue, (candidate[0], candidate[1], other))


def _route(came: dict[str, tuple[str, DoorEdge]], start: str, goal: str) -> list[DoorEdge]:
    edges: list[DoorEdge] = []
    cursor = goal
    while cursor != start:
        previous, edge = came[cursor]
        edges.append(edge)
        cursor = previous
    edges.reverse()
    return edges


def _shortest(graph: DoorGraph, start: str, goal: str) -> tuple[list[DoorEdge], float | None] | None:
    if start == goal:
        return [], 0.0
    best, came = _search(graph, start)
    if goal in best:
        return _route(came, start, goal), best[goal][0]
    best, came = _search(graph, start, unweighted=True)
    if goal in best:
        return _route(came, start, goal), None
    return None
