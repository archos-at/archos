from agent.core.models import ConversationState


async def turn(graph, state: ConversationState, thread_id: str | None = None) -> ConversationState:
    final = None
    async for item in graph.stream(state, thread_id=thread_id):
        final = item
    assert isinstance(final, ConversationState)
    return final
